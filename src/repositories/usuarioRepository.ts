import { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { Consulta } from '../database/transacao';

// Conta ativa com o e-mail informado (RF 1.6: conta desativada nao entra nem recupera senha)
export async function buscarAtivoPorEmail(email: string): Promise<{ id: number; nome: string } | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id_usuario, nome FROM usuario WHERE email = ? AND ativo = TRUE',
        [email]
    );
    return rows.length > 0 ? { id: rows[0].id_usuario, nome: rows[0].nome } : null;
}

export async function atualizarSenha(idUsuario: number, senhaHash: string, consulta: Consulta = pool): Promise<void> {
    await consulta.query('UPDATE usuario SET senha_hash = ? WHERE id_usuario = ?', [senhaHash, idUsuario]);
}
