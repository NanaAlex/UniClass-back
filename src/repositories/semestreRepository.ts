import { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { Consulta } from '../database/transacao';
import { MATERIA_EM_USO } from '../utils/dadosAcademicos';
import { TURMA_EM_USO } from './turmaRepository';

export interface SemestreGravado {
    id: number;
    nome: string;
    periodoLetivo: string | null;
    emUso: boolean;
    exclusaoBloqueada: boolean;
}

// Semestres do admin em ordem de criacao
export async function listarPorAdmin(idAdmin: number): Promise<SemestreGravado[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT s.id_semestre, s.nome, s.periodo_letivo,
                (EXISTS (SELECT 1 FROM materia m WHERE m.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM formulario f WHERE f.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM geracao_horario g WHERE g.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM turma t
                             WHERE t.id_semestre = s.id_semestre
                               AND ${TURMA_EM_USO})) AS em_uso,
                -- Regra do PUT /admin/dados, que antes apaga as disciplinas e turmas livres:
                -- so trava o que continua preso ao semestre
                (EXISTS (SELECT 1 FROM formulario f WHERE f.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM geracao_horario g WHERE g.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM materia m WHERE m.id_semestre = s.id_semestre AND ${MATERIA_EM_USO})
                 OR EXISTS (SELECT 1 FROM turma t
                             WHERE t.id_semestre = s.id_semestre
                               AND ${TURMA_EM_USO})) AS exclusao_bloqueada
           FROM semestre s
          WHERE s.id_admin = ?
          ORDER BY s.id_semestre`,
        [idAdmin]
    );

    return rows.map((linha) => ({
        id: linha.id_semestre,
        nome: linha.nome,
        periodoLetivo: linha.periodo_letivo,
        emUso: linha.em_uso === 1,
        exclusaoBloqueada: linha.exclusao_bloqueada === 1,
    }));
}

export async function contarPorAdmin(idAdmin: number): Promise<number> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM semestre WHERE id_admin = ?',
        [idAdmin]
    );
    return rows[0].total;
}

export async function existeDoAdmin(idAdmin: number, idSemestre: number): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id_semestre FROM semestre WHERE id_semestre = ? AND id_admin = ?',
        [idSemestre, idAdmin]
    );
    return rows.length > 0;
}

export async function inserir(idAdmin: number, nome: string): Promise<void> {
    await pool.query('INSERT INTO semestre (id_admin, nome) VALUES (?, ?)', [idAdmin, nome]);
}

export async function excluir(idSemestre: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query('DELETE FROM semestre WHERE id_semestre = ?', [idSemestre]);
}
