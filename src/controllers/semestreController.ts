import { Request, Response } from 'express';
import pool from '../database/connection';

// Semestres do admin em ordem de criacao (numero = posicao)
async function montarSemestres(idAdmin: number) {
    const [rows]: any = await pool.query(
        `SELECT s.id_semestre, s.nome, s.periodo_letivo,
                (EXISTS (SELECT 1 FROM materia m WHERE m.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM formulario f WHERE f.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM geracao_horario g WHERE g.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM turma t
                             WHERE t.id_semestre = s.id_semestre
                               AND (EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                                    OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma)))) AS em_uso
           FROM semestre s
          WHERE s.id_admin = ?
          ORDER BY s.id_semestre`,
        [idAdmin]
    );

    return rows.map((linha: any, i: number) => ({
        id: linha.id_semestre,
        numero: i + 1,
        nome: linha.nome,
        periodoLetivo: linha.periodo_letivo,
        emUso: linha.em_uso === 1,
    }));
}

export async function listarSemestres(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ semestres: await montarSemestres(id) });
    } catch (error) {
        console.error('Erro ao listar semestres:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar os semestres' });
    }
}

// CU-018: o "+" cria o proximo semestre da sequencia (1o, 2o, 3o...)
export async function criarSemestre(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const [contagem]: any = await pool.query(
            'SELECT COUNT(*) AS total FROM semestre WHERE id_admin = ?',
            [id]
        );
        const numero = contagem[0].total + 1;

        await pool.query(
            'INSERT INTO semestre (id_admin, nome) VALUES (?, ?)',
            [id, `${numero}º Semestre`]
        );

        return resposta.status(201).json({
            message: 'Semestre criado',
            semestres: await montarSemestres(id),
        });
    } catch (error) {
        console.error('Erro ao criar semestre:', error);
        return resposta.status(500).json({ error: 'Erro interno ao criar o semestre' });
    }
}

// CU-018: exclui o ultimo semestre, junto com as turmas dele
export async function excluirSemestre(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idSemestre = Number(req.params.idSemestre);

    try {
        const semestres = await montarSemestres(id);
        const semestre = semestres.find((item: any) => item.id === idSemestre);

        if (!semestre) {
          return resposta.status(404).json({ error: 'Semestre não encontrado' });
        }

        // Excluir do meio renumeraria semestres que ja tem materias e formularios
        if (semestre.numero !== semestres.length) {
          return resposta.status(409).json({ error: 'Apenas o último semestre pode ser excluído' });
        }

        // CU-018 A2: dependencias impedem a exclusao
        if (semestre.emUso) {
          return resposta.status(409).json({
            error: 'Este semestre possui matérias, formulários, horários ou turmas em uso e não pode ser excluído',
          });
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();
            await conexao.query('DELETE FROM turma WHERE id_semestre = ?', [idSemestre]);
            await conexao.query('DELETE FROM semestre WHERE id_semestre = ?', [idSemestre]);
            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({
            message: 'Semestre excluído',
            semestres: await montarSemestres(id),
        });
    } catch (error) {
        console.error('Erro ao excluir semestre:', error);
        return resposta.status(500).json({ error: 'Erro interno ao excluir o semestre' });
    }
}
