import { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { Consulta, chaveDuplicada } from '../database/transacao';

export interface Turma {
    id: number;
    nome: string;
    turno: string;
    emUso: boolean;
}

export interface TurmaDoSemestre extends Turma {
    idSemestre: number;
}

// Turma usada em horario gerado: aula alocada ou pendencia de geracao (alias t)
export const TURMA_EM_USO = `(EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma))`;

const paraTurma = (linha: RowDataPacket): Turma => ({
    id: linha.id_turma,
    nome: linha.nome,
    turno: linha.turno,
    emUso: linha.em_uso === 1,
});

const paraTurmaDoSemestre = (linha: RowDataPacket): TurmaDoSemestre => ({
    ...paraTurma(linha),
    idSemestre: linha.id_semestre,
});

// Turmas do semestre em ordem alfabetica
export async function listarPorSemestre(idSemestre: number): Promise<Turma[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id_turma, t.nome, t.turno, ${TURMA_EM_USO} AS em_uso
           FROM turma t
          WHERE t.id_semestre = ?
          ORDER BY t.nome`,
        [idSemestre]
    );

    return rows.map(paraTurma);
}

// Turmas de todos os semestres do admin numa consulta so (CU-019)
export async function listarPorAdmin(idAdmin: number): Promise<TurmaDoSemestre[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id_turma, t.id_semestre, t.nome, t.turno, ${TURMA_EM_USO} AS em_uso
           FROM turma t
           JOIN semestre s ON s.id_semestre = t.id_semestre
          WHERE s.id_admin = ?
          ORDER BY t.nome`,
        [idAdmin]
    );

    return rows.map(paraTurmaDoSemestre);
}

// Turma de um semestre do admin; de outro admin devolve null
export async function buscarDoAdmin(idAdmin: number, idTurma: number): Promise<TurmaDoSemestre | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id_turma, t.id_semestre, t.nome, t.turno, ${TURMA_EM_USO} AS em_uso
           FROM turma t
           JOIN semestre s ON s.id_semestre = t.id_semestre
          WHERE t.id_turma = ?
            AND s.id_admin = ?`,
        [idTurma, idAdmin]
    );

    return rows.length > 0 ? paraTurmaDoSemestre(rows[0]) : null;
}

export async function listarNomes(idSemestre: number): Promise<string[]> {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT nome FROM turma WHERE id_semestre = ?', [idSemestre]);
    return rows.map((linha) => linha.nome);
}

// Chave unica (id_semestre, nome): devolve false se o nome ja existe no semestre
export async function inserir(idSemestre: number, nome: string, turno: string): Promise<boolean> {
    try {
        await pool.query('INSERT INTO turma (id_semestre, nome, turno) VALUES (?, ?, ?)', [idSemestre, nome, turno]);
        return true;
    } catch (erro) {
        if (chaveDuplicada(erro)) return false;
        throw erro;
    }
}

export async function alterarTurno(idTurma: number, turno: string): Promise<void> {
    await pool.query('UPDATE turma SET turno = ? WHERE id_turma = ?', [turno, idTurma]);
}

export async function excluir(idTurma: number): Promise<void> {
    await pool.query('DELETE FROM turma WHERE id_turma = ?', [idTurma]);
}

export async function excluirPorSemestre(idSemestre: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query('DELETE FROM turma WHERE id_semestre = ?', [idSemestre]);
}
