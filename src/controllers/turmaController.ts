import { Request, Response } from 'express';
import pool from '../database/connection';
import { TURNOS } from '../utils/validacoes';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Turmas do semestre em ordem alfabetica, indicando se ja sao usadas
async function montarTurmas(idSemestre: number) {
    const [rows]: any = await pool.query(
        `SELECT t.id_turma, t.nome, t.turno,
                (EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma)) AS em_uso
           FROM turma t
          WHERE t.id_semestre = ?
          ORDER BY t.nome`,
        [idSemestre]
    );

    return rows.map((linha: any) => ({
        id: linha.id_turma,
        nome: linha.nome,
        turno: linha.turno,
        emUso: linha.em_uso === 1,
    }));
}

// Turma de um semestre do admin; id invalido ou de outro admin devolve null (404)
async function buscarTurmaDoAdmin(idAdmin: number, idTurma: number) {
    if (!Number.isInteger(idTurma)) return null;

    const [rows]: any = await pool.query(
        `SELECT t.id_turma, t.id_semestre,
                (EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma)) AS em_uso
           FROM turma t
           JOIN semestre s ON s.id_semestre = t.id_semestre
          WHERE t.id_turma = ?
            AND s.id_admin = ?`,
        [idTurma, idAdmin]
    );

    return rows.length > 0 ? rows[0] : null;
}

// Turno do corpo em maiusculas, ou null se invalido
function lerTurno(valor: any): string | null {
    const turno = typeof valor === 'string' ? valor.toUpperCase() : null;
    return turno && TURNOS.includes(turno) ? turno : null;
}

// CU-019: o "+" do cartao adiciona a turma com a primeira letra livre
export async function adicionarTurma(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idSemestre = Number(req.params.idSemestre);
    const turno = req.body?.turno === undefined ? 'MANHA' : lerTurno(req.body.turno);

    if (!turno) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }

    try {
        const [semestres]: any = await pool.query(
            'SELECT id_semestre FROM semestre WHERE id_semestre = ? AND id_admin = ?',
            [Number.isInteger(idSemestre) ? idSemestre : 0, id]
        );

        // CU-019 A1
        if (semestres.length === 0) {
          return resposta.status(404).json({ error: 'Semestre não encontrado' });
        }

        const [usadas]: any = await pool.query('SELECT nome FROM turma WHERE id_semestre = ?', [idSemestre]);
        const nome = LETRAS.find((letra) => !usadas.some((turma: any) => turma.nome === letra));

        if (!nome) {
          return resposta.status(409).json({ error: 'O semestre já tem 26 turmas (A a Z)' });
        }

        await pool.query(
            'INSERT INTO turma (id_semestre, nome, turno) VALUES (?, ?, ?)',
            [idSemestre, nome, turno]
        );

        return resposta.status(201).json({
            message: 'Turma adicionada',
            idSemestre,
            turmas: await montarTurmas(idSemestre),
        });
    } catch (error: any) {
        // Chave unica (id_semestre, nome): dois cliques ao mesmo tempo
        if (error.code === 'ER_DUP_ENTRY') {
          return resposta.status(409).json({ error: 'Esta turma acabou de ser criada; atualize a lista' });
        }

        console.error('Erro ao adicionar turma:', error);
        return resposta.status(500).json({ error: 'Erro interno ao adicionar a turma' });
    }
}

// CU-019: seletor de turno da turma
export async function alterarTurnoTurma(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const turno = lerTurno(req.body?.turno);

    if (!turno) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }

    try {
        const turma = await buscarTurmaDoAdmin(id, Number(req.params.idTurma));

        if (!turma) {
          return resposta.status(404).json({ error: 'Turma não encontrada' });
        }

        // CU-019 A2: a grade gerada depende do turno da turma
        if (turma.em_uso === 1) {
          return resposta.status(409).json({ error: 'Esta turma é usada em horários gerados e não pode mudar de turno' });
        }

        await pool.query('UPDATE turma SET turno = ? WHERE id_turma = ?', [turno, turma.id_turma]);

        return resposta.json({
            message: 'Turno da turma alterado',
            idSemestre: turma.id_semestre,
            turmas: await montarTurmas(turma.id_semestre),
        });
    } catch (error) {
        console.error('Erro ao alterar turno da turma:', error);
        return resposta.status(500).json({ error: 'Erro interno ao alterar o turno da turma' });
    }
}

// CU-019: retira a turma sem renomear as outras
export async function retirarTurma(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const turma = await buscarTurmaDoAdmin(id, Number(req.params.idTurma));

        if (!turma) {
          return resposta.status(404).json({ error: 'Turma não encontrada' });
        }

        // CU-019 A2
        if (turma.em_uso === 1) {
          return resposta.status(409).json({ error: 'Esta turma é usada em horários gerados e não pode ser retirada' });
        }

        await pool.query('DELETE FROM turma WHERE id_turma = ?', [turma.id_turma]);

        return resposta.json({
            message: 'Turma retirada',
            idSemestre: turma.id_semestre,
            turmas: await montarTurmas(turma.id_semestre),
        });
    } catch (error) {
        console.error('Erro ao retirar turma:', error);
        return resposta.status(500).json({ error: 'Erro interno ao retirar a turma' });
    }
}
