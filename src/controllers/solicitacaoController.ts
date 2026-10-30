import { Request, Response } from 'express';
import pool from '../database/connection';

export async function solicitarAlteracaoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idFormulario = Number(req.params.idFormulario);
    const { motivo } = req.body;

    if (!motivo || typeof motivo !== 'string' || motivo.trim() === '') {
      return resposta.status(400).json({ error: 'Descreva o motivo da alteração' });
    }

    if (motivo.length > 500) {
      return resposta.status(400).json({ error: 'O motivo deve ter no máximo 500 caracteres' });
    }

    try {
        const [respostas]: any = await pool.query(
          `SELECT r.id_resposta, r.status
             FROM resposta_formulario r
             JOIN formulario f ON f.id_formulario = r.id_formulario
            WHERE r.id_formulario = ?
              AND r.id_professor = ?
              AND f.status = 'ABERTO'
              AND (f.data_fim IS NULL OR f.data_fim > NOW())`,
          [idFormulario, id]
        );

        if (respostas.length === 0) {
          return resposta.status(404).json({
            error: 'Não há resposta enviada para este formulário, ou o prazo já terminou',
          });
        }

        const respostaEnviada = respostas[0];

        if (respostaEnviada.status === 'LIBERADA_PARA_ALTERACAO') {
          return resposta.status(409).json({ error: 'Sua resposta já está liberada para alteração' });
        }

        const [pendentes]: any = await pool.query(
            `SELECT id_solicitacao
               FROM solicitacao_alteracao_resposta
              WHERE id_resposta = ? AND status = 'PENDENTE'`,
            [respostaEnviada.id_resposta]
        );

        if (pendentes.length > 0) {
          return resposta.status(409).json({ error: 'Você já tem uma solicitação pendente para este formulário' });
        }

        // Registra o pedido
        const [resultado]: any = await pool.query(
          `INSERT INTO solicitacao_alteracao_resposta (id_resposta, motivo, status, data_solicitacao)
           VALUES (?, ?, 'PENDENTE', NOW())`,
          [respostaEnviada.id_resposta, motivo.trim()]
        );

        return resposta.status(201).json({
          message: 'Solicitação enviada com sucesso',
          idSolicitacao: resultado.insertId,
        });

    } catch (error) {
        console.error('Erro ao solicitar alteração:', error);
        return resposta.status(500).json({ error: 'Erro ao enviar solicitação' });
    }
}

export async function listarSolicitacoesFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const [rows]: any = await pool.query(
            `SELECT s.id_solicitacao, s.motivo, s.status, s.data_solicitacao, s.data_analise,
                    f.id_formulario, f.nome AS nome_formulario
               FROM solicitacao_alteracao_resposta s
               JOIN resposta_formulario r ON r.id_resposta = s.id_resposta
               JOIN formulario f          ON f.id_formulario = r.id_formulario
              WHERE r.id_professor = ?
              ORDER BY s.data_solicitacao DESC`,
            [id]
        );

        const solicitacoes = rows.map((linha: any) => ({
          id: linha.id_solicitacao,
          idFormulario: linha.id_formulario,
          formulario: linha.nome_formulario,
          motivo: linha.motivo,
          status: linha.status,
          dataSolicitacao: linha.data_solicitacao,
          dataAnalise: linha.data_analise,
        }));

        return resposta.json({ solicitacoes });
    } catch (error) {
        console.error('Erro ao listar solicitações:', error);
        return resposta.status(500).json({ error: 'Erro ao listar solicitações' });
    }
}

/* 
  Professor pede alteração na prévia do horário (CU-053)
*/

export async function solicitarAlteracaoHorario(req: Request, resposta: Response) {
  try {
    const { id } = resposta.locals.usuario;
    const { idGeracao, idAula, motivo } = req.body;

    if (typeof motivo !== 'string' || motivo.trim() === '') {
      return resposta.status(400).json({ error: 'Informe o motivo da solicitação' });
    }
    if (motivo.trim().length > 500) {
      return resposta.status(400).json({ error: 'O motivo pode ter no máximo 500 caracteres' });
    }
    if (!Number.isInteger(idGeracao)) {
      return resposta.status(400).json({ error: 'Informe o horário (idGeracao) da solicitação' });
    }
    if (idAula !== undefined && idAula !== null && !Number.isInteger(idAula)) {
      return resposta.status(400).json({ error: 'A aula informada é inválida' });
    }

    const aulaInformada = Number.isInteger(idAula) ? idAula : null;

    const [geracoes]: any = await pool.query(
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
      [idGeracao, id]
    );

    if (geracoes.length === 0) {
      return resposta.status(404).json({ error: 'Prévia de horário não encontrada ou não liberada' });
    }


    if (aulaInformada !== null) {
      const [aulas]: any = await pool.query(
        'SELECT id_aula FROM aula_alocada WHERE id_aula = ? AND id_geracao = ? AND id_professor = ?',
        [aulaInformada, idGeracao, id]
      );
      if (aulas.length === 0) {
        return resposta.status(400).json({ error: 'A aula informada não pertence ao seu horário nesta prévia' });
      }
    }

    const [pendentes]: any = await pool.query(
      `SELECT id_solicitacao
         FROM solicitacao_alteracao_horario
        WHERE id_professor = ? AND id_geracao = ? AND id_aula <=> ? AND status = 'PENDENTE'`,
      [id, idGeracao, aulaInformada]
    );
    if (pendentes.length > 0) {
      return resposta.status(409).json({ error: 'Você já tem uma solicitação pendente para esta aula' });
    }

    const [resultado]: any = await pool.query(
      `INSERT INTO solicitacao_alteracao_horario (id_professor, id_geracao, id_aula, motivo, data_envio, status)
       VALUES (?, ?, ?, ?, NOW(), 'PENDENTE')`,
      [id, idGeracao, aulaInformada, motivo.trim()]
    );

    return resposta.status(201).json({
      message: 'Solicitação enviada com sucesso',
      idSolicitacao: resultado.insertId,
    });
  } catch (error) {
    console.error('Erro ao solicitar alteração do horário:', error);
    return resposta.status(500).json({ error: 'Erro ao solicitar alteração do horário' });
  }
}

/*
   Lista os pedidos de alteração do horário do professor
   (CU-054). LEFT JOIN porque o pedido pode não ter aula 
*/

export async function listarSolicitacoesHorario(req: Request, resposta: Response) {
  try {
    const { id } = resposta.locals.usuario;

    const [linhas]: any = await pool.query(
      `SELECT sh.id_solicitacao, sh.id_geracao, g.numero_versao, s.nome AS semestre,
              sh.id_aula, m.nome AS materia, d.dia_semana, sl.numero_aula,
              sh.motivo, sh.status, sh.data_envio
         FROM solicitacao_alteracao_horario sh
         JOIN geracao_horario g   ON g.id_geracao     = sh.id_geracao
         JOIN semestre s          ON s.id_semestre    = g.id_semestre
         LEFT JOIN aula_alocada a ON a.id_aula        = sh.id_aula
         LEFT JOIN materia m      ON m.id_materia     = a.id_materia
         LEFT JOIN dia_letivo d   ON d.id_dia_letivo  = a.id_dia_letivo
         LEFT JOIN slot_aula sl   ON sl.id_slot       = a.id_slot
        WHERE sh.id_professor = ?
        ORDER BY sh.data_envio DESC`,
      [id]
    );

    const solicitacoes = linhas.map((linha: any) => ({
      id:        linha.id_solicitacao,
      idGeracao: linha.id_geracao,
      versao:    linha.numero_versao,
      semestre:  linha.semestre,
      aula: linha.id_aula === null ? null : {
        idAula:  linha.id_aula,
        materia: linha.materia,
        dia:     linha.dia_semana,
        aula:    linha.numero_aula,
      },
      motivo:    linha.motivo,
      status:    linha.status,
      dataEnvio: linha.data_envio,
    }));

    return resposta.json({ solicitacoes });
  } catch (error) {
    console.error('Erro ao listar solicitações do horário:', error);
    return resposta.status(500).json({ error: 'Erro ao listar solicitações do horário' });
  }
}