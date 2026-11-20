import pool from '../database/connection';
import { Consulta } from '../database/transacao';

// Encerra todas as sessoes abertas do usuario (quem tinha a senha antiga perde o acesso)
export async function encerrarTodasDoUsuario(idUsuario: number, motivo: string, consulta: Consulta = pool): Promise<void> {
    await consulta.query(
        `UPDATE sessao
            SET encerrada_em = NOW(),
                motivo_encerramento = ?
          WHERE id_usuario = ?
            AND encerrada_em IS NULL`,
        [motivo, idUsuario]
    );
}
