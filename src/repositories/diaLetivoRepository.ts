import { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { chaveDuplicada } from '../database/transacao';

export interface DiaLetivo {
    id: number;
    diaSemana: string;
    emUso: boolean;
}

// Dias do turno, em ordem da semana, indicando se ja sao usados em respostas
// de professores (disponibilidade, preferencia) ou em horarios gerados
export async function listarPorTurno(idAdmin: number, turno: string): Promise<DiaLetivo[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT d.id_dia_letivo, d.dia_semana,
                (EXISTS (SELECT 1 FROM disponibilidade_horario x WHERE x.id_dia_letivo = d.id_dia_letivo)
                 OR EXISTS (SELECT 1 FROM preferencia_turno x WHERE x.id_dia_letivo = d.id_dia_letivo)
                 OR EXISTS (SELECT 1 FROM aula_alocada x WHERE x.id_dia_letivo = d.id_dia_letivo)) AS em_uso
           FROM dia_letivo d
          WHERE d.id_admin = ?
            AND d.turno = ?
          ORDER BY FIELD(d.dia_semana, 'SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO')`,
        [idAdmin, turno]
    );

    return rows.map((linha) => ({
        id: linha.id_dia_letivo,
        diaSemana: linha.dia_semana,
        emUso: linha.em_uso === 1,
    }));
}

// Turno do dia letivo do admin, ou null se o dia nao existe ou e de outro admin
export async function buscarTurno(idAdmin: number, idDiaLetivo: number): Promise<string | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT turno FROM dia_letivo WHERE id_dia_letivo = ? AND id_admin = ?',
        [idDiaLetivo, idAdmin]
    );
    return rows.length > 0 ? rows[0].turno : null;
}

// Chave unica (id_admin, dia_semana, turno): devolve false se o dia ja existe no turno
export async function inserir(idAdmin: number, diaSemana: string, turno: string): Promise<boolean> {
    try {
        await pool.query(
            'INSERT INTO dia_letivo (id_admin, dia_semana, turno) VALUES (?, ?, ?)',
            [idAdmin, diaSemana, turno]
        );
        return true;
    } catch (erro) {
        if (chaveDuplicada(erro)) return false;
        throw erro;
    }
}

export async function excluir(idDiaLetivo: number): Promise<void> {
    await pool.query('DELETE FROM dia_letivo WHERE id_dia_letivo = ?', [idDiaLetivo]);
}
