import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';

export interface SolicitacaoDeResposta {
    id: number;
    idFormulario: number;
    formulario: string;
    motivo: string;
    status: string;
    dataSolicitacao: Date;
    dataAnalise: Date | null;
}

export interface SolicitacaoDeHorario {
    id: number;
    idGeracao: number;
    versao: number;
    semestre: string;
    aula: {
        idAula: number;
        materia: string;
        turma: string;
        dia: string;
        aula: number;
        posicao: number;
    } | null;
    motivo: string;
    status: string;
    dataEnvio: Date;
}

// ---- Alteracao da resposta do formulario

// Resposta do professor a um formulario aberto e ainda no prazo
export async function buscarRespostaNoPrazo(idFormulario: number, idProfessor: number): Promise<{ id: number; status: string } | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id_resposta, r.status
         FROM resposta_formulario r
         JOIN formulario f ON f.id_formulario = r.id_formulario
        WHERE r.id_formulario = ?
          AND r.id_professor = ?
          AND f.status = 'ABERTO'
          AND (f.data_fim IS NULL OR f.data_fim > NOW())`,
      [idFormulario, idProfessor]
    );
    return rows.length > 0 ? { id: rows[0].id_resposta, status: rows[0].status } : null;
}

export async function existePendenteDaResposta(idResposta: number): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id_solicitacao
           FROM solicitacao_alteracao_resposta
          WHERE id_resposta = ? AND status = 'PENDENTE'`,
        [idResposta]
    );
    return rows.length > 0;
}

export async function inserirDeResposta(idResposta: number, motivo: string): Promise<number> {
    const [resultado] = await pool.query<ResultSetHeader>(
      `INSERT INTO solicitacao_alteracao_resposta (id_resposta, motivo, status, data_solicitacao)
       VALUES (?, ?, 'PENDENTE', NOW())`,
      [idResposta, motivo]
    );
    return resultado.insertId;
}

export async function listarDeRespostaDoProfessor(idProfessor: number): Promise<SolicitacaoDeResposta[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT s.id_solicitacao, s.motivo, s.status, s.data_solicitacao, s.data_analise,
                f.id_formulario, f.nome AS nome_formulario
           FROM solicitacao_alteracao_resposta s
           JOIN resposta_formulario r ON r.id_resposta = s.id_resposta
           JOIN formulario f          ON f.id_formulario = r.id_formulario
          WHERE r.id_professor = ?
          ORDER BY s.data_solicitacao DESC`,
        [idProfessor]
    );

    return rows.map((linha) => ({
        id: linha.id_solicitacao,
        idFormulario: linha.id_formulario,
        formulario: linha.nome_formulario,
        motivo: linha.motivo,
        status: linha.status,
        dataSolicitacao: linha.data_solicitacao,
        dataAnalise: linha.data_analise,
    }));
}

// ---- Alteracao da previa do horario (CU-053, CU-054)

// Previa liberada aos professores, de um semestre ativo de um admin ao qual o professor esta vinculado
export async function previaLiberadaAoProfessor(idGeracao: number, idProfessor: number): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id_geracao
         FROM geracao_horario g
         JOIN semestre s                ON s.id_semestre = g.id_semestre
         JOIN vinculo_professor_admin v ON v.id_admin    = s.id_admin
        WHERE g.id_geracao = ?
          AND g.status = 'PREVIA'
          AND s.ativo = 1
          AND s.previas_visiveis = 1
          AND v.id_professor = ?
          AND v.ativo = 1`,
      [idGeracao, idProfessor]
    );
    return rows.length > 0;
}

export async function aulaDoProfessorNaGeracao(idAula: number, idGeracao: number, idProfessor: number): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id_aula FROM aula_alocada WHERE id_aula = ? AND id_geracao = ? AND id_professor = ?',
      [idAula, idGeracao, idProfessor]
    );
    return rows.length > 0;
}

// Pedido pendente igual: mesma geracao e mesma aula (ou os dois sem aula)
export async function existePendenteDeHorario(idProfessor: number, idGeracao: number, idAula: number | null): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id_solicitacao
         FROM solicitacao_alteracao_horario
        WHERE id_professor = ? AND id_geracao = ? AND id_aula <=> ? AND status = 'PENDENTE'`,
      [idProfessor, idGeracao, idAula]
    );
    return rows.length > 0;
}

export async function inserirDeHorario(idProfessor: number, idGeracao: number, idAula: number | null, motivo: string): Promise<number> {
    const [resultado] = await pool.query<ResultSetHeader>(
      `INSERT INTO solicitacao_alteracao_horario (id_professor, id_geracao, id_aula, motivo, data_envio, status)
       VALUES (?, ?, ?, ?, NOW(), 'PENDENTE')`,
      [idProfessor, idGeracao, idAula, motivo]
    );
    return resultado.insertId;
}

// LEFT JOIN porque o pedido pode nao ter aula
export async function listarDeHorarioDoProfessor(idProfessor: number): Promise<SolicitacaoDeHorario[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT sh.id_solicitacao, sh.id_geracao, g.numero_versao, s.nome AS semestre,
              sh.id_aula, m.nome AS materia, t.nome AS turma, d.dia_semana, sl.numero_aula,
              (SELECT COALESCE(SUM(b2.qtd_aulas), 0) FROM bloco_aula b2
                WHERE b2.id_admin = b.id_admin AND b2.turno = b.turno AND b2.ordem < b.ordem)
                + sl.numero_aula AS posicao,
              sh.motivo, sh.status, sh.data_envio
         FROM solicitacao_alteracao_horario sh
         JOIN geracao_horario g   ON g.id_geracao     = sh.id_geracao
         JOIN semestre s          ON s.id_semestre    = g.id_semestre
         LEFT JOIN aula_alocada a ON a.id_aula        = sh.id_aula
         LEFT JOIN materia m      ON m.id_materia     = a.id_materia
         LEFT JOIN turma t        ON t.id_turma       = a.id_turma
         LEFT JOIN dia_letivo d   ON d.id_dia_letivo  = a.id_dia_letivo
         LEFT JOIN slot_aula sl   ON sl.id_slot       = a.id_slot
         LEFT JOIN bloco_aula b   ON b.id_bloco       = sl.id_bloco
        WHERE sh.id_professor = ?
        ORDER BY sh.data_envio DESC`,
      [idProfessor]
    );

    return linhas.map((linha) => ({
      id:        linha.id_solicitacao,
      idGeracao: linha.id_geracao,
      versao:    linha.numero_versao,
      semestre:  linha.semestre,
      aula: linha.id_aula === null ? null : {
        idAula:  linha.id_aula,
        materia: linha.materia,
        turma:   linha.turma,
        dia:     linha.dia_semana,
        aula:    linha.numero_aula,
        posicao: Number(linha.posicao), // aula contando o turno inteiro, como na grade
      },
      motivo:    linha.motivo,
      status:    linha.status,
      dataEnvio: linha.data_envio,
    }));
}
