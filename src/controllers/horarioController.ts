import { Request, Response } from 'express';
import pool from '../database/connection';

/* 
   Função interna: busca as aulas do professor no horário
   - status 'PREVIA'     -> só semestres com prévia liberada
   - status 'DEFINITIVO' -> horário oficial publicado
   Parte de aula_alocada, porque o professor pode ter aulas
   em vários semestres (cada semestre tem a sua geração)
*/
async function buscarAulasDoProfessor(idProfessor: number, status: 'PREVIA' | 'DEFINITIVO') {
    const filtroPrevia = status === 'PREVIA' ? 'AND s.previas_visiveis = 1' : '';

    const [aulas]: any = await pool.query(
      `SELECT a.id_aula, g.numero_versao, s.nome AS semestre, s.periodo_letivo,
              t.nome AS turma, m.nome AS materia,
              d.dia_semana, d.turno, b.ordem AS bloco, sl.numero_aula,
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
        ORDER BY FIELD(d.dia_semana, 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'),
                 b.ordem, sl.numero_aula`,
      [idProfessor, status]
    );

    return aulas.map((aula: any) => ({
      idAula:        aula.id_aula,
      versao:        aula.numero_versao,
      semestre:      aula.semestre,
      periodoLetivo: aula.periodo_letivo,
      turma:         aula.turma,
      materia:       aula.materia,
      dia:           aula.dia_semana,
      turno:         aula.turno,
      bloco:         aula.bloco,
      aula:          aula.numero_aula,
      inicio:        aula.inicio,
      fim:           aula.fim,
    }));
}

export async function verPreviaHorario(req: Request, resposta: Response) {
    try {
        const { id } = resposta.locals.usuario;
        const aulas = await buscarAulasDoProfessor(id, 'PREVIA');

    // Nenhuma aula: a prévia não existe ou ainda não foi liberada
    if (aulas.length === 0) {
      return resposta.status(404).json({ error: 'Nenhuma prévia de horário disponível no momento' });
    }

    return resposta.json({ aulas });

    } catch (error) {
        console.error('Erro ao buscar prévia do horário:', error);
        return resposta.status(500).json({ error: 'Erro ao buscar prévia do horário' });
    }
}

export async function verHorarioDefinitivo(req: Request, resposta: Response) {
  try {
    const { id } = resposta.locals.usuario;
    const aulas = await buscarAulasDoProfessor(id, 'DEFINITIVO');

    if (aulas.length === 0) {
      return resposta.status(404).json({ error: 'O horário definitivo ainda não foi publicado' });
    }

    return resposta.json({ aulas });
  } catch (error) {
    console.error('Erro ao buscar horário definitivo:', error);
    return resposta.status(500).json({ error: 'Erro ao buscar horário definitivo' });
  }
}