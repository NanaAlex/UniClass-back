import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { Consulta } from '../database/transacao';

export interface Aula {
    id: number;
    aula: number;
    inicio: string;
    fim: string;
}

// Bloco no formato devolvido ao front
export interface Bloco {
    id: number;
    ordem: number;
    qtdAulas: number;
    inicio: string;
    fim: string;
    emUso: boolean;
    aulas: Aula[];
}

// Bloco com a duracao da aula (deduzida da 1a aula), para os calculos de horario
export interface BlocoComDuracao {
    id: number;
    ordem: number;
    qtdAulas: number;
    horaInicio: string;
    horaFim: string;
    duracaoAula: number;
}

export interface BlocoDoAdmin {
    id: number;
    turno: string;
    ordem: number;
    qtdAulas: number;
}

export interface BlocoGravado {
    id: number;
    ordem: number;
    qtdAulas: number;
    horaInicio: string;
    duracaoAula: number;
    emUso: boolean;
}

export interface NovaAula {
    numero: number;
    inicio: string;
    fim: string;
}

// Configuracao do turno, com as aulas de cada bloco e se ja sao usadas em
// respostas de professores ou em horarios gerados
export async function listarPorTurno(idAdmin: number, turno: string): Promise<Bloco[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio AS bloco_inicio, b.hora_fim AS bloco_fim,
                s.id_slot, s.numero_aula, s.hora_inicio, s.hora_fim,
                (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
                 OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot)) AS slot_em_uso
           FROM bloco_aula b
           LEFT JOIN slot_aula s ON s.id_bloco = b.id_bloco
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem, s.numero_aula`,
        [idAdmin, turno]
    );

    const blocos: Bloco[] = [];

    for (const linha of rows) {
        let bloco = blocos.find((item) => item.id === linha.id_bloco);

        if (!bloco) {
            bloco = {
                id: linha.id_bloco,
                ordem: linha.ordem,
                qtdAulas: linha.qtd_aulas,
                inicio: linha.bloco_inicio,
                fim: linha.bloco_fim,
                emUso: false,
                aulas: [],
            };
            blocos.push(bloco);
        }

        if (linha.id_slot !== null) {
            bloco.aulas.push({
                id: linha.id_slot,
                aula: linha.numero_aula,
                inicio: linha.hora_inicio,
                fim: linha.hora_fim,
            });
            bloco.emUso = bloco.emUso || linha.slot_em_uso === 1;
        }
    }

    return blocos;
}

// Blocos do turno, em ordem, com a duracao da aula
export async function listarComDuracao(idAdmin: number, turno: string): Promise<BlocoComDuracao[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio, b.hora_fim,
                TIME_TO_SEC(TIMEDIFF(s.hora_fim, s.hora_inicio)) DIV 60 AS duracao_aula
           FROM bloco_aula b
           LEFT JOIN slot_aula s
             ON s.id_bloco = b.id_bloco
            AND s.numero_aula = 1
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem`,
        [idAdmin, turno]
    );

    return rows.map((linha) => ({
        id: linha.id_bloco,
        ordem: linha.ordem,
        qtdAulas: linha.qtd_aulas,
        horaInicio: linha.hora_inicio,
        horaFim: linha.hora_fim,
        duracaoAula: linha.duracao_aula,
    }));
}

// Bloco do admin; de outro admin devolve null
export async function buscarDoAdmin(idAdmin: number, idBloco: number): Promise<BlocoDoAdmin | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id_bloco, turno, ordem, qtd_aulas, hora_inicio, hora_fim
           FROM bloco_aula
          WHERE id_bloco = ?
            AND id_admin = ?`,
        [idBloco, idAdmin]
    );

    if (rows.length === 0) return null;
    return { id: rows[0].id_bloco, turno: rows[0].turno, ordem: rows[0].ordem, qtdAulas: rows[0].qtd_aulas };
}

// Alguma aula dos blocos ja usada em respostas de professores ou em horarios gerados
export async function algumEmUso(idsBlocos: number[]): Promise<boolean> {
    if (idsBlocos.length === 0) {
      return false;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT 1
           FROM slot_aula s
          WHERE s.id_bloco IN (?)
            AND (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
             OR  EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot))
          LIMIT 1`,
        [idsBlocos]
    );

    return rows.length > 0;
}

// Quantidades de aulas por bloco usadas pelos turnos do admin, menos o turno informado
export async function tamanhosDosOutrosTurnos(idAdmin: number, turno: string): Promise<number[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT DISTINCT qtd_aulas FROM bloco_aula WHERE id_admin = ? AND turno <> ?',
        [idAdmin, turno]
    );
    return rows.map((linha) => linha.qtd_aulas);
}

// Quantidade de aulas por bloco de cada turno do admin
export async function tamanhosPorTurno(idAdmin: number, consulta: Consulta = pool): Promise<{ turno: string; qtdAulas: number }[]> {
    const [rows] = await consulta.query<RowDataPacket[]>(
        'SELECT DISTINCT turno, qtd_aulas FROM bloco_aula WHERE id_admin = ?',
        [idAdmin]
    );
    return rows.map((linha) => ({ turno: linha.turno, qtdAulas: linha.qtd_aulas }));
}

// Blocos do turno em ordem, para a gravacao da aba Dados
export async function listarParaSincronizar(idAdmin: number, turno: string, consulta: Consulta = pool): Promise<BlocoGravado[]> {
    const [rows] = await consulta.query<RowDataPacket[]>(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio,
                (SELECT TIME_TO_SEC(TIMEDIFF(s.hora_fim, s.hora_inicio)) DIV 60
                   FROM slot_aula s WHERE s.id_bloco = b.id_bloco AND s.numero_aula = 1) AS duracao_aula,
                EXISTS (SELECT 1 FROM slot_aula s
                         WHERE s.id_bloco = b.id_bloco
                           AND (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
                                OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot))) AS em_uso
           FROM bloco_aula b
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem`,
        [idAdmin, turno]
    );

    return rows.map((linha) => ({
        id: linha.id_bloco,
        ordem: linha.ordem,
        qtdAulas: linha.qtd_aulas,
        horaInicio: linha.hora_inicio,
        duracaoAula: linha.duracao_aula,
        emUso: linha.em_uso === 1,
    }));
}

export async function inserir(
    idAdmin: number, turno: string, ordem: number, qtdAulas: number, horaInicio: string, horaFim: string,
    consulta: Consulta = pool,
): Promise<number> {
    const [resultado] = await consulta.query<ResultSetHeader>(
        `INSERT INTO bloco_aula (id_admin, turno, ordem, qtd_aulas, hora_inicio, hora_fim)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [idAdmin, turno, ordem, qtdAulas, horaInicio, horaFim]
    );
    return resultado.insertId;
}

export async function atualizarHorario(
    idBloco: number, qtdAulas: number, horaInicio: string, horaFim: string, consulta: Consulta = pool,
): Promise<void> {
    await consulta.query(
        'UPDATE bloco_aula SET qtd_aulas = ?, hora_inicio = ?, hora_fim = ? WHERE id_bloco = ?',
        [qtdAulas, horaInicio, horaFim, idBloco]
    );
}

export async function inserirAulas(idBloco: number, aulas: NovaAula[], consulta: Consulta = pool): Promise<void> {
    await consulta.query(
        'INSERT INTO slot_aula (id_bloco, numero_aula, hora_inicio, hora_fim) VALUES ?',
        [aulas.map((aula) => [idBloco, aula.numero, aula.inicio, aula.fim])]
    );
}

export async function excluirAulas(idBloco: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query('DELETE FROM slot_aula WHERE id_bloco = ?', [idBloco]);
}

export async function excluir(idBloco: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query('DELETE FROM bloco_aula WHERE id_bloco = ?', [idBloco]);
}

// Puxa uma posicao os blocos depois da ordem informada.
// ORDER BY evita colisao na chave unica (id_admin, turno, ordem)
export async function reordenarApos(idAdmin: number, turno: string, ordem: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query(
        `UPDATE bloco_aula SET ordem = ordem - 1
          WHERE id_admin = ? AND turno = ? AND ordem > ?
          ORDER BY ordem`,
        [idAdmin, turno, ordem]
    );
}
