import { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { Consulta } from '../database/transacao';

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

export async function excluirPorSemestre(idSemestre: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query('DELETE FROM turma WHERE id_semestre = ?', [idSemestre]);
}
