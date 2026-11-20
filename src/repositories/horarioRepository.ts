import { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';

export type StatusGeracao = 'PREVIA' | 'DEFINITIVO';

export interface AulaDoProfessor {
    idAula: number;
    idGeracao: number;
    versao: number;
    geradaEm: Date;
    semestre: string;
    numeroSemestre: number;
    periodoLetivo: string | null;
    idTurma: number;
    turma: string;
    idMateria: number;
    materia: string;
    aulasPorSemana: number;
    qtdProfessores: number;
    dia: string;
    turno: string;
    bloco: number;
    aula: number;
    posicao: number;
    inicio: string;
    fim: string;
    bloqueada: boolean;
}

/*
   Aulas do professor no horario
   - status 'PREVIA'     -> so semestres com previa liberada
   - status 'DEFINITIVO' -> horario oficial publicado
   Parte de aula_alocada, porque o professor pode ter aulas
   em varios semestres (cada semestre tem a sua geracao)
   Com idAdmin (consulta do administrador): so os semestres
   desse admin, incluindo previas ainda ocultas

   Campos calculados:
   - posicao: numero da aula contando o turno inteiro (1, 2, 3...),
     somando as aulas dos blocos anteriores. E assim que o front
     monta as linhas da grade.
   - numero_semestre: 1o, 2o, 3o... na ordem de criacao, a mesma
     regra do semestreService
*/
export async function listarAulasDoProfessor(idProfessor: number, status: StatusGeracao, idAdmin?: number): Promise<AulaDoProfessor[]> {
    const filtroPrevia = status === 'PREVIA' && idAdmin === undefined ? 'AND s.previas_visiveis = 1' : '';
    const filtroAdmin  = idAdmin === undefined ? '' : 'AND s.id_admin = ?';
    const parametros   = idAdmin === undefined ? [idProfessor, status] : [idProfessor, status, idAdmin];

    const [aulas] = await pool.query<RowDataPacket[]>(
      `SELECT a.id_aula, a.bloqueada, g.id_geracao, g.numero_versao, g.criada_em,
              s.nome AS semestre, s.periodo_letivo,
              (SELECT COUNT(*) FROM semestre s2
                WHERE s2.id_admin = s.id_admin AND s2.id_semestre <= s.id_semestre) AS numero_semestre,
              t.id_turma, t.nome AS turma,
              m.id_materia, m.nome AS materia, m.qtd_aulas_semana, m.qtd_professores,
              d.dia_semana, d.turno, b.ordem AS bloco, sl.numero_aula,
              (SELECT COALESCE(SUM(b2.qtd_aulas), 0) FROM bloco_aula b2
                WHERE b2.id_admin = b.id_admin AND b2.turno = b.turno AND b2.ordem < b.ordem)
                + sl.numero_aula AS posicao,
              TIME_FORMAT(sl.hora_inicio, '%H:%i') AS inicio,
              TIME_FORMAT(sl.hora_fim, '%H:%i')    AS fim
         FROM aula_alocada a
         JOIN geracao_horario g ON g.id_geracao    = a.id_geracao
         JOIN semestre s        ON s.id_semestre   = g.id_semestre
         JOIN turma t           ON t.id_turma      = a.id_turma
         JOIN materia m         ON m.id_materia    = a.id_materia
         JOIN dia_letivo d      ON d.id_dia_letivo = a.id_dia_letivo
         JOIN slot_aula sl      ON sl.id_slot      = a.id_slot
         JOIN bloco_aula b      ON b.id_bloco      = sl.id_bloco
        WHERE a.id_professor = ?
          AND g.status = ?
          AND s.ativo = 1
          ${filtroPrevia}
          ${filtroAdmin}
        ORDER BY FIELD(d.dia_semana, 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'),
                 b.ordem, sl.numero_aula`,
      parametros
    );

    return aulas.map((aula) => ({
      idAula:          aula.id_aula,
      idGeracao:       aula.id_geracao,
      versao:          aula.numero_versao,
      geradaEm:        aula.criada_em,
      semestre:        aula.semestre,
      numeroSemestre:  Number(aula.numero_semestre),
      periodoLetivo:   aula.periodo_letivo,
      idTurma:         aula.id_turma,
      turma:           aula.turma,
      idMateria:       aula.id_materia,
      materia:         aula.materia,
      aulasPorSemana:  aula.qtd_aulas_semana,
      qtdProfessores:  aula.qtd_professores,
      dia:             aula.dia_semana,
      turno:           aula.turno,
      bloco:           aula.bloco,
      aula:            aula.numero_aula,
      posicao:         Number(aula.posicao),
      inicio:          aula.inicio,
      fim:             aula.fim,
      bloqueada:       aula.bloqueada === 1,
    }));
}

// Dias letivos (sem repetir) dos administradores com quem o professor tem vinculo ativo
export async function listarDiasDosAdminsDoProfessor(idProfessor: number): Promise<{ turno: string; diaSemana: string }[]> {
    const [dias] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT d.turno, d.dia_semana
         FROM dia_letivo d
         JOIN vinculo_professor_admin v
           ON v.id_admin = d.id_admin AND v.id_professor = ? AND v.ativo = 1
        ORDER BY FIELD(d.turno, 'MANHA', 'TARDE', 'NOITE'),
                 FIELD(d.dia_semana, 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO')`,
      [idProfessor]
    );
    return dias.map((linha) => ({ turno: linha.turno, diaSemana: linha.dia_semana }));
}

export interface AulaDeBloco {
    idAdmin: number;
    turno: string;
    ordem: number;
    numeroAula: number;
    inicio: string;
    fim: string;
}

// Aulas dos blocos de cada admin do professor, por admin, turno, bloco e aula
export async function listarAulasDosBlocosDosAdmins(idProfessor: number): Promise<AulaDeBloco[]> {
    const [aulas] = await pool.query<RowDataPacket[]>(
      `SELECT b.id_admin, b.turno, b.ordem, sl.numero_aula,
              TIME_FORMAT(sl.hora_inicio, '%H:%i') AS inicio,
              TIME_FORMAT(sl.hora_fim, '%H:%i')    AS fim
         FROM bloco_aula b
         JOIN vinculo_professor_admin v
           ON v.id_admin = b.id_admin AND v.id_professor = ? AND v.ativo = 1
         JOIN slot_aula sl ON sl.id_bloco = b.id_bloco
        ORDER BY b.id_admin, FIELD(b.turno, 'MANHA', 'TARDE', 'NOITE'), b.ordem, sl.numero_aula`,
      [idProfessor]
    );
    return aulas.map((linha) => ({
        idAdmin: linha.id_admin,
        turno: linha.turno,
        ordem: linha.ordem,
        numeroAula: linha.numero_aula,
        inicio: linha.inicio,
        fim: linha.fim,
    }));
}
