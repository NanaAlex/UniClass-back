import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';

/*
   Tokens de recuperacao de senha (RF 1.4, ADR 012). No banco fica so o hash
   SHA-256 do token; o token vai apenas no link do e-mail.
   Token valido: nao usado, nao invalidado, dentro do prazo e de uma conta ativa.
*/
const TOKEN_VALIDO = `t.token_hash = ?
            AND t.data_utilizacao IS NULL
            AND t.data_invalidacao IS NULL
            AND t.data_expiracao > NOW()
            AND u.ativo = TRUE`;

// Um pedido novo invalida os links anteriores ainda abertos
export async function invalidarAbertosDoUsuario(idUsuario: number): Promise<void> {
    await pool.query(
        `UPDATE token_recuperacao_senha
            SET data_invalidacao = NOW()
          WHERE id_usuario = ?
            AND data_utilizacao IS NULL
            AND data_invalidacao IS NULL`,
        [idUsuario]
    );
}

export async function inserir(idUsuario: number, tokenHash: string, validadeHoras: number): Promise<number> {
    const [resultado] = await pool.query<ResultSetHeader>(
        `INSERT INTO token_recuperacao_senha (id_usuario, token_hash, data_criacao, data_expiracao)
         VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
        [idUsuario, tokenHash, validadeHoras]
    );
    return resultado.insertId;
}

export async function invalidar(idToken: number): Promise<void> {
    await pool.query('UPDATE token_recuperacao_senha SET data_invalidacao = NOW() WHERE id_token = ?', [idToken]);
}

export async function buscarValido(tokenHash: string): Promise<{ id: number; idUsuario: number; email: string } | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id_token, t.id_usuario, u.email
           FROM token_recuperacao_senha t
           JOIN usuario u ON u.id_usuario = t.id_usuario
          WHERE ${TOKEN_VALIDO}`,
        [tokenHash]
    );
    return rows.length > 0 ? { id: rows[0].id_token, idUsuario: rows[0].id_usuario, email: rows[0].email } : null;
}

// Mesmo filtro, travando o token ate o fim da transacao (dois envios do mesmo link)
export async function travarValido(tokenHash: string, conexao: PoolConnection): Promise<{ id: number; idUsuario: number } | null> {
    const [rows] = await conexao.query<RowDataPacket[]>(
        `SELECT t.id_token, t.id_usuario
           FROM token_recuperacao_senha t
           JOIN usuario u ON u.id_usuario = t.id_usuario
          WHERE ${TOKEN_VALIDO}
          FOR UPDATE`,
        [tokenHash]
    );
    return rows.length > 0 ? { id: rows[0].id_token, idUsuario: rows[0].id_usuario } : null;
}

export async function marcarUsado(idToken: number, conexao: PoolConnection): Promise<void> {
    await conexao.query('UPDATE token_recuperacao_senha SET data_utilizacao = NOW() WHERE id_token = ?', [idToken]);
}
