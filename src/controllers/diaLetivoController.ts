import { Request, Response } from 'express';
import pool from '../database/connection';
import { TURNOS } from '../utils/validacoes';

// Domingo fica de fora: nao ha aula aos domingos
const DIAS_SEMANA = ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

// Dias do turno, em ordem da semana, indicando se ja sao usados
async function montarDiasDoTurno(idAdmin: number, turno: string) {
    const [rows]: any = await pool.query(
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

    return rows.map((linha: any) => ({
        id: linha.id_dia_letivo,
        diaSemana: linha.dia_semana,
        emUso: linha.em_uso === 1,
    }));
}

export async function listarDias(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const turno = String(req.params.turno).toUpperCase();

    if (!TURNOS.includes(turno)) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }

    try {
        const dias = await montarDiasDoTurno(id, turno);

        return resposta.json({ turno, dias });
    } catch (error) {
        console.error('Erro ao listar dias letivos:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar os dias letivos' });
    }
}

// CU-015: adiciona um dia letivo ao turno (coluna "+" da tela)
export async function adicionarDia(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const turno = String(req.params.turno).toUpperCase();
    const diaSemana = typeof req.body.diaSemana === 'string' ? req.body.diaSemana.toUpperCase() : null;

    if (!TURNOS.includes(turno)) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }
    if (!diaSemana || !DIAS_SEMANA.includes(diaSemana)) {
      return resposta.status(400).json({ error: 'Dia inválido; use de SEGUNDA a SABADO' });
    }

    try {
        await pool.query(
            'INSERT INTO dia_letivo (id_admin, dia_semana, turno) VALUES (?, ?, ?)',
            [id, diaSemana, turno]
        );

        return resposta.status(201).json({
            message: 'Dia letivo adicionado',
            turno,
            dias: await montarDiasDoTurno(id, turno),
        });
    } catch (error: any) {
        // Chave unica (id_admin, dia_semana, turno)
        if (error.code === 'ER_DUP_ENTRY') {
          return resposta.status(409).json({ error: 'Este dia já está cadastrado neste turno' });
        }

        console.error('Erro ao adicionar dia letivo:', error);
        return resposta.status(500).json({ error: 'Erro interno ao adicionar o dia letivo' });
    }
}

// CU-015: remove um dia letivo do turno
export async function excluirDia(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idDiaLetivo = Number(req.params.idDiaLetivo);

    if (!Number.isInteger(idDiaLetivo)) {
      return resposta.status(404).json({ error: 'Dia letivo não encontrado' });
    }

    try {
        const [dias]: any = await pool.query(
            'SELECT turno FROM dia_letivo WHERE id_dia_letivo = ? AND id_admin = ?',
            [idDiaLetivo, id]
        );

        if (dias.length === 0) {
          return resposta.status(404).json({ error: 'Dia letivo não encontrado' });
        }

        const { turno } = dias[0];
        const diaEmUso = (await montarDiasDoTurno(id, turno))
            .some((dia: any) => dia.id === idDiaLetivo && dia.emUso);

        if (diaEmUso) {
          return resposta.status(409).json({
            error: 'Este dia já é usado em respostas de professores ou em horários gerados e não pode ser excluído',
          });
        }

        await pool.query('DELETE FROM dia_letivo WHERE id_dia_letivo = ?', [idDiaLetivo]);

        return resposta.json({
            message: 'Dia letivo excluído',
            turno,
            dias: await montarDiasDoTurno(id, turno),
        });
    } catch (error) {
        console.error('Erro ao excluir dia letivo:', error);
        return resposta.status(500).json({ error: 'Erro interno ao excluir o dia letivo' });
    }
}
