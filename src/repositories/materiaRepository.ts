import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { Consulta } from '../database/transacao';

export interface Materia {
    id: number;
    nome: string;
    qtdAulasSemana: number;
    qtdProfessores: number;
    semestre: { id: number; numero: number; nome: string };
    emUso: boolean;
}

export interface DadosMateria {
    idSemestre: number;
    nome: string;
    qtdAulasSemana: number;
    qtdProfessores: number;
}

export interface MateriaGravada extends DadosMateria {
    id: number;
    emUso: boolean;
}

// Disciplina em uso: interesse em resposta do formulario, aula alocada ou pendencia de geracao (alias m)
export const MATERIA_EM_USO = `(EXISTS (SELECT 1 FROM interesse_materia i WHERE i.id_materia = m.id_materia)
                 OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_materia = m.id_materia)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_materia = m.id_materia))`;

// Disciplinas do admin, na ordem dos semestres e por nome; filtro opcional por semestres
export async function listarPorAdmin(idAdmin: number, semestres: number[] | null = null): Promise<Materia[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT m.id_materia, m.nome, m.qtd_aulas_semana, m.qtd_professores,
                s.id_semestre, s.numero, s.nome AS nome_semestre,
                ${MATERIA_EM_USO} AS em_uso
           FROM materia m
           JOIN (SELECT id_semestre, nome, ROW_NUMBER() OVER (ORDER BY id_semestre) AS numero
                   FROM semestre
                  WHERE id_admin = ?) s ON s.id_semestre = m.id_semestre
          WHERE m.ativo = TRUE
            ${semestres ? 'AND m.id_semestre IN (?)' : ''}
          ORDER BY s.numero, m.nome`,
        semestres ? [idAdmin, semestres] : [idAdmin]
    );

    return rows.map((linha) => ({
        id: linha.id_materia,
        nome: linha.nome,
        qtdAulasSemana: linha.qtd_aulas_semana,
        qtdProfessores: linha.qtd_professores,
        semestre: {
            id: linha.id_semestre,
            numero: Number(linha.numero),
            nome: linha.nome_semestre,
        },
        emUso: linha.em_uso === 1,
    }));
}

// Disciplina de um semestre do admin; de outro admin devolve null
export async function buscarDoAdmin(idAdmin: number, idMateria: number): Promise<{ id: number; emUso: boolean } | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT m.id_materia, ${MATERIA_EM_USO} AS em_uso
           FROM materia m
           JOIN semestre s ON s.id_semestre = m.id_semestre
          WHERE m.id_materia = ?
            AND s.id_admin = ?`,
        [idMateria, idAdmin]
    );

    return rows.length > 0 ? { id: rows[0].id_materia, emUso: rows[0].em_uso === 1 } : null;
}

// Disciplinas ativas do admin, para a gravacao da aba Dados (sem ordem definida)
export async function listarParaSincronizar(idAdmin: number, consulta: Consulta = pool): Promise<MateriaGravada[]> {
    const [rows] = await consulta.query<RowDataPacket[]>(
        `SELECT m.id_materia, m.id_semestre, m.nome, m.qtd_aulas_semana, m.qtd_professores, ${MATERIA_EM_USO} AS em_uso
           FROM materia m
           JOIN semestre s ON s.id_semestre = m.id_semestre
          WHERE s.id_admin = ?
            AND m.ativo = TRUE`,
        [idAdmin]
    );

    return rows.map((linha) => ({
        id: linha.id_materia,
        idSemestre: linha.id_semestre,
        nome: linha.nome,
        qtdAulasSemana: linha.qtd_aulas_semana,
        qtdProfessores: linha.qtd_professores,
        emUso: linha.em_uso === 1,
    }));
}

// Turno fica vazio: ele e da turma, nao da disciplina. Chave unica (id_semestre, nome)
export async function inserir(dados: DadosMateria, consulta: Consulta = pool): Promise<number> {
    const [resultado] = await consulta.query<ResultSetHeader>(
        `INSERT INTO materia (id_semestre, nome, qtd_aulas_semana, qtd_professores)
         VALUES (?, ?, ?, ?)`,
        [dados.idSemestre, dados.nome, dados.qtdAulasSemana, dados.qtdProfessores]
    );
    return resultado.insertId;
}

export async function atualizar(idMateria: number, dados: DadosMateria, consulta: Consulta = pool): Promise<void> {
    await consulta.query(
        `UPDATE materia
            SET nome = ?, qtd_aulas_semana = ?, qtd_professores = ?, id_semestre = ?
          WHERE id_materia = ?`,
        [dados.nome, dados.qtdAulasSemana, dados.qtdProfessores, dados.idSemestre, idMateria]
    );
}

export async function excluir(idMateria: number, consulta: Consulta = pool): Promise<void> {
    await consulta.query('DELETE FROM materia WHERE id_materia = ?', [idMateria]);
}
