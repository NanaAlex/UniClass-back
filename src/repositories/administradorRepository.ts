import { PoolConnection } from 'mysql2/promise';

// Trava a linha do admin ate o fim da transacao: duas gravacoes do mesmo admin
// ao mesmo tempo (dois cliques em "Salvar" ou em "Lancar") nao se misturam
export async function travar(idAdmin: number, conexao: PoolConnection): Promise<void> {
    await conexao.query('SELECT id_usuario FROM administrador WHERE id_usuario = ? FOR UPDATE', [idAdmin]);
}
