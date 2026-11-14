import { Request, Response } from 'express';
import pool from '../database/connection';

/*
   Função interna: busca as aulas do professor no horário
   - status 'PREVIA'     -> só semestres com prévia liberada
   - status 'DEFINITIVO' -> horário oficial publicado
   Parte de aula_alocada, porque o professor pode ter aulas
   em vários semestres (cada semestre tem a sua geração)
   Com idAdmin (consulta do administrador): só os semestres
   desse admin, incluindo prévias ainda ocultas

   Campos calculados:
   - posicao: número da aula contando o turno inteiro (1, 2, 3...),
     somando as aulas dos blocos anteriores. É assim que o front
     monta as linhas da grade.
   - numero_semestre: 1º, 2º, 3º... na ordem de criação, a mesma
     regra do semestreController
*/
export async function buscarAulasDoProfessor(idProfessor: number, status: 'PREVIA' | 'DEFINITIVO', idAdmin?: number) {
    const filtroPrevia = status === 'PREVIA' && idAdmin === undefined ? 'AND s.previas_visiveis = 1' : '';
    const filtroAdmin  = idAdmin === undefined ? '' : 'AND s.id_admin = ?';
    const parametros   = idAdmin === undefined ? [idProfessor, status] : [idProfessor, status, idAdmin];

    const [aulas]: any = await pool.query(
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

    return aulas.map((aula: any) => ({
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

/*
   CU-041, RF 3.16: prévia do horário do professor
   CU-052, RF 3.13: 404 com mensagem quando não há prévia liberada
*/
export async function verPreviaHorario(req: Request, resposta: Response) {
  try {
    const { id } = resposta.locals.usuario;
    const aulas = await buscarAulasDoProfessor(id, 'PREVIA');

    if (aulas.length === 0) {
      return resposta.status(404).json({ error: 'Nenhuma prévia de horário disponível no momento' });
    }

    return resposta.json({ aulas });
  
  } catch (error) {
    console.error('Erro ao buscar prévia do horário:', error);
    return resposta.status(500).json({ error: 'Erro ao buscar prévia do horário' });
  }
}

/*
   CU-049, RF 3.12: horário definitivo do professor
*/
export async function verHorarioDefinitivo(req: Request, resposta: Response) {
  try {
    const { id } = resposta.locals.usuario;
    const aulas = await buscarAulasDoProfessor(id, 'DEFINITIVO');

    // Nenhuma aula: o horário definitivo ainda não foi publicado
    if (aulas.length === 0) {
      return resposta.status(404).json({ error: 'O horário definitivo ainda não foi publicado' });
    }

    return resposta.json({ aulas });
  
  } catch (error) {
    console.error('Erro ao buscar horário definitivo:', error);
    return resposta.status(500).json({ error: 'Erro ao buscar horário definitivo' });
  }
}

/*
   RF 2.3, RF 3.12: dias e blocos de aula de cada turno
   O front precisa dessa estrutura para desenhar a grade do
   horário (colunas = dias, linhas = aulas de cada bloco).
   Vem dos administradores com quem o professor tem vínculo
   ativo (RF 6.3: o professor não acessa as rotas /admin).

   Se o professor tiver mais de um administrador:
   - dias: junta os dias de todos
   - blocos: usa os do primeiro administrador que tiver blocos
     naquele turno (cada admin pode ter horários diferentes)
*/
export async function listarEstruturasDoProfessor(req: Request, resposta: Response) {
  try {
    const { id } = resposta.locals.usuario;

    const [dias]: any = await pool.query(
      `SELECT DISTINCT d.turno, d.dia_semana
         FROM dia_letivo d
         JOIN vinculo_professor_admin v
           ON v.id_admin = d.id_admin AND v.id_professor = ? AND v.ativo = 1
        ORDER BY FIELD(d.turno, 'MANHA', 'TARDE', 'NOITE'),
                 FIELD(d.dia_semana, 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO')`,
      [id]
    );

    const [aulas]: any = await pool.query(
      `SELECT b.id_admin, b.turno, b.ordem, sl.numero_aula,
              TIME_FORMAT(sl.hora_inicio, '%H:%i') AS inicio,
              TIME_FORMAT(sl.hora_fim, '%H:%i')    AS fim
         FROM bloco_aula b
         JOIN vinculo_professor_admin v
           ON v.id_admin = b.id_admin AND v.id_professor = ? AND v.ativo = 1
         JOIN slot_aula sl ON sl.id_bloco = b.id_bloco
        ORDER BY b.id_admin, FIELD(b.turno, 'MANHA', 'TARDE', 'NOITE'), b.ordem, sl.numero_aula`,
      [id]
    );

    const estruturas: any[] = [];

    for (const turno of ['MANHA', 'TARDE', 'NOITE']) {
      const diasDoTurno = dias.filter((d: any) => d.turno === turno).map((d: any) => d.dia_semana);

      const primeiroAdmin = aulas.find((a: any) => a.turno === turno)?.id_admin;
      const aulasDoTurno  = aulas.filter((a: any) => a.turno === turno && a.id_admin === primeiroAdmin);

      if (diasDoTurno.length === 0 || aulasDoTurno.length === 0) continue;

      // Agrupa as aulas por bloco; a posição conta o turno inteiro
      const blocos: any[] = [];
      let posicao = 0;
      for (const aula of aulasDoTurno) {
        let bloco = blocos.find((b) => b.ordem === aula.ordem);
        if (!bloco) {
          bloco = { ordem: aula.ordem, aulas: [] };
          blocos.push(bloco);
        }
        posicao += 1;
        bloco.aulas.push({ posicao, inicio: aula.inicio, fim: aula.fim });
      }

      estruturas.push({ turno, dias: diasDoTurno, blocos });
    }

    return resposta.json({ estruturas });

  } catch (error) {
    console.error('Erro ao buscar a estrutura dos turnos:', error);
    return resposta.status(500).json({ error: 'Erro ao buscar a estrutura dos turnos' });
  }
}