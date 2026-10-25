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