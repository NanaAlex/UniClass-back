import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';

// Formulario na lista do admin (tela de publicacao)
export interface FormularioDoAdmin {
    id: number;
    nome: string;
    periodoLetivo: string | null;
    status: string;
    dataInicio: string;
    dataFim: string;
    inicio: string;
    fim: string;
    encerradoManualmente: boolean;
    respostas: number;
    professores: number;
}

// Dados do formulario para as regras de abrir, encerrar e editar datas
export interface FormularioParaRegras {
    id: number;
    status: string;
    dataInicio: string;
    inicioMinuto: string;
    terminoVencido: boolean;
    maisRecente: boolean;
}

export interface ProfessorDoFormulario {
    id: number;
    nome: string;
    respondeu: boolean;
    dataEnvio: string | null;
    statusResposta: string | null;
}

// Filtro da lista de professores: CU-027 (responderam) e CU-028 (pendentes)
export const FILTROS_SITUACAO: Record<string, string> = {
    responderam: 'AND r.id_resposta IS NOT NULL',
    pendentes: 'AND r.id_resposta IS NULL',
};

// RF 2.8: abre os formularios programados que chegaram ao inicio e encerra os
// abertos que passaram do termino (horario do MySQL, RNF 9)
export async function atualizarStatusPelaData(): Promise<void> {
    await pool.query(
        `UPDATE formulario
            SET status = 'ABERTO'
          WHERE status = 'NAO_INICIADO'
            AND data_inicio <= NOW()`
    );
    await pool.query(
        `UPDATE formulario
            SET status = 'ENCERRADO'
          WHERE status = 'ABERTO'
            AND data_fim < NOW()`
    );
}

// Formularios do admin, do mais recente ao mais antigo, com o total de respostas
// e de professores vinculados
export async function listarDoAdmin(idAdmin: number): Promise<FormularioDoAdmin[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT f.id_formulario, f.nome, f.periodo_letivo, f.status, f.encerrado_manualmente,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d') AS data_inicio,
                DATE_FORMAT(f.data_fim, '%Y-%m-%d') AS data_fim,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%dT%H:%i') AS inicio,
                DATE_FORMAT(f.data_fim, '%Y-%m-%dT%H:%i') AS fim,
                (SELECT COUNT(*) FROM resposta_formulario r
                  WHERE r.id_formulario = f.id_formulario) AS respostas,
                (SELECT COUNT(*) FROM vinculo_professor_admin v
                  WHERE v.id_admin = f.id_admin AND v.ativo = TRUE) AS professores
           FROM formulario f
          WHERE f.id_admin = ?
          ORDER BY f.id_formulario DESC`,
        [idAdmin]
    );

    return rows.map((linha) => ({
        id: linha.id_formulario,
        nome: linha.nome,
        periodoLetivo: linha.periodo_letivo,
        status: linha.status,
        // So o dia (task 07.3) e o instante com a hora (task 08.02), em Brasilia
        dataInicio: linha.data_inicio,
        dataFim: linha.data_fim,
        inicio: linha.inicio,
        fim: linha.fim,
        // Encerrado na mao (CU-025) ou pela data (RF 2.8): a tela so prorroga o segundo
        encerradoManualmente: linha.encerrado_manualmente === 1,
        respostas: Number(linha.respostas),
        professores: Number(linha.professores),
    }));
}

// Formulario do admin; de outro admin devolve null
export async function buscarDoAdmin(idAdmin: number, idFormulario: number): Promise<FormularioParaRegras | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT f.id_formulario, f.status,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d') AS data_inicio,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d %H:%i') AS inicio_minuto,
                f.data_fim < NOW() AS termino_vencido,
                f.id_formulario = (SELECT MAX(id_formulario) FROM formulario
                                    WHERE id_admin = f.id_admin) AS mais_recente
           FROM formulario f
          WHERE f.id_formulario = ?
            AND f.id_admin = ?`,
        [idFormulario, idAdmin]
    );

    if (rows.length === 0) return null;
    const linha = rows[0];
    return {
        id: linha.id_formulario,
        status: linha.status,
        dataInicio: linha.data_inicio,
        inicioMinuto: linha.inicio_minuto,
        terminoVencido: linha.termino_vencido === 1,
        maisRecente: linha.mais_recente === 1,
    };
}

// O que o lancamento precisa: nenhum formulario ativo, dia com bloco e disciplina
export async function estadoParaLancamento(idAdmin: number, conexao: PoolConnection) {
    const [[estado]] = await conexao.query<RowDataPacket[]>(
        `SELECT EXISTS (SELECT 1 FROM formulario
                         WHERE id_admin = ? AND status IN ('NAO_INICIADO', 'ABERTO')) AS tem_ativo,
                EXISTS (SELECT 1 FROM dia_letivo d
                          JOIN bloco_aula b ON b.id_admin = d.id_admin AND b.turno = d.turno
                         WHERE d.id_admin = ?) AS tem_grade,
                EXISTS (SELECT 1 FROM materia m
                          JOIN semestre s ON s.id_semestre = m.id_semestre
                         WHERE s.id_admin = ? AND m.ativo = TRUE) AS tem_materia`,
        [idAdmin, idAdmin, idAdmin]
    );

    return {
        temAtivo: estado.tem_ativo === 1,
        temGrade: estado.tem_grade === 1,
        temMateria: estado.tem_materia === 1,
    };
}

// Sem id_semestre o formulario alcanca todos os semestres do admin
// (semestre.id_admin) e as disciplinas de cada um. Inicio ja passado abre na hora
export async function inserir(
    idAdmin: number, nome: string, periodoLetivo: string | null, inicio: string, fim: string, conexao: PoolConnection,
): Promise<void> {
    await conexao.query(
        `INSERT INTO formulario (id_admin, nome, periodo_letivo, data_inicio, data_fim, status)
         VALUES (?, ?, ?, ?, ?, IF(? <= NOW(), 'ABERTO', 'NAO_INICIADO'))`,
        [idAdmin, nome, periodoLetivo, inicio, fim, inicio]
    );
}

export async function atualizarDatas(idFormulario: number, inicio: string, fim: string): Promise<void> {
    await pool.query(
        'UPDATE formulario SET data_inicio = ?, data_fim = ? WHERE id_formulario = ?',
        [inicio, fim, idFormulario]
    );
}

export async function atualizarTermino(idFormulario: number, fim: string): Promise<void> {
    await pool.query('UPDATE formulario SET data_fim = ? WHERE id_formulario = ?', [fim, idFormulario]);
}

// Programado aberto agora: o inicio passa a ser este minuto
export async function abrirAgora(idFormulario: number): Promise<void> {
    await pool.query(
        `UPDATE formulario
            SET status = 'ABERTO', data_inicio = DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:00'), iniciado_manualmente = TRUE
          WHERE id_formulario = ?`,
        [idFormulario]
    );
}

export async function reabrir(idFormulario: number): Promise<void> {
    await pool.query(
        `UPDATE formulario
            SET status = 'ABERTO', iniciado_manualmente = TRUE, encerrado_manualmente = FALSE
          WHERE id_formulario = ?`,
        [idFormulario]
    );
}

export async function encerrar(idFormulario: number): Promise<void> {
    await pool.query(
        `UPDATE formulario
            SET status = 'ENCERRADO', encerrado_manualmente = TRUE
          WHERE id_formulario = ?`,
        [idFormulario]
    );
}

// Vinculados ao admin, mais quem respondeu e depois foi desvinculado
export async function listarProfessores(
    idAdmin: number, idFormulario: number, situacao?: string,
): Promise<ProfessorDoFormulario[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT u.id_usuario, u.nome, r.status AS status_resposta,
                DATE_FORMAT(r.data_envio, '%Y-%m-%dT%H:%i:%s') AS data_envio
           FROM (SELECT v.id_professor
                   FROM vinculo_professor_admin v
                  WHERE v.id_admin = ? AND v.ativo = TRUE
                 UNION
                 SELECT rf.id_professor
                   FROM resposta_formulario rf
                  WHERE rf.id_formulario = ?) p
           JOIN usuario u ON u.id_usuario = p.id_professor
           LEFT JOIN resposta_formulario r
             ON r.id_formulario = ? AND r.id_professor = p.id_professor
          WHERE TRUE ${situacao ? FILTROS_SITUACAO[situacao] : ''}
          ORDER BY u.nome`,
        [idAdmin, idFormulario, idFormulario]
    );

    return rows.map((linha) => ({
        id: linha.id_usuario,
        nome: linha.nome,
        respondeu: linha.status_resposta !== null,
        dataEnvio: linha.data_envio,
        statusResposta: linha.status_resposta,
    }));
}
