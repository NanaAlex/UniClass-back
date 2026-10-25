import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../database/connection';

export async function verificarSessao(req: Request, resposta: Response, proximo: NextFunction) {

    const cabecalho = req.headers.authorization;

    if (!cabecalho || !cabecalho.startsWith('Bearer ')) {
      return resposta.status(401).json({ error: 'Sessão não informada' });
    }

    const token     = cabecalho.replace('Bearer ', '');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    try {
    const [rows]: any = await pool.query(
        `SELECT s.id_sessao, u.id_usuario, u.tipo_usuario, u.ativo
           FROM sessao s
           JOIN usuario u ON u.id_usuario = s.id_usuario
          WHERE s.token_hash = ?
            AND s.encerrada_em IS NULL
            AND s.expira_em > NOW()`,
        [tokenHash]
    );

    if (rows.length === 0) {
      return resposta.status(401).json({ error: 'Sessão inválida ou expirada' });
    }

    const sessao = rows[0];

    if (!sessao.ativo) {
      return resposta.status(403).json({ error: 'Conta desativada' });
    }

    await pool.query(
      `UPDATE sessao
          SET ultimo_acesso = NOW(),
              expira_em = DATE_ADD(NOW(), INTERVAL 1 HOUR)
        WHERE id_sessao = ?`,
      [sessao.id_sessao]
    );

    resposta.locals.usuario = {
      id: sessao.id_usuario,
      tipoUsuario: sessao.tipo_usuario,
      idSessao: sessao.id_sessao,
    };

    return proximo();

    } catch (error) {
      return resposta.status(500).json({ error: 'Erro ao verificar sessão' });
    }
}

export function somenteProfessor(req: Request, resposta: Response, proximo: NextFunction) {
  const { tipoUsuario } = resposta.locals.usuario;

  if (tipoUsuario !== 'PROFESSOR') {
    return resposta.status(403).json({ error: 'Acesso permitido apenas para professores' });
  }

  return proximo();
}