import { Pool, PoolConnection } from 'mysql2/promise';
import pool from './connection';

// O que os repositories recebem para consultar: o pool (padrao) ou a conexao
// de uma transacao aberta pelo service
export type Consulta = Pool | PoolConnection;

// Executa o trabalho numa transacao: confirma se terminar, desfaz se falhar
export async function emTransacao<T>(trabalho: (conexao: PoolConnection) => Promise<T>): Promise<T> {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();
        const resultado = await trabalho(conexao);
        await conexao.commit();
        return resultado;
    } catch (erro) {
        await conexao.rollback();
        throw erro;
    } finally {
        conexao.release();
    }
}

// Violacao de chave unica do MySQL
export function chaveDuplicada(erro: any): boolean {
    return erro?.code === 'ER_DUP_ENTRY';
}
