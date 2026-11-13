import { Request, Response } from 'express';
import pool from '../database/connection';
import { MATERIA_EM_USO, montarMaterias } from '../utils/dadosAcademicos';

// Disciplina de um semestre do admin; id invalido ou de outro admin devolve null (404)
async function buscarMateriaDoAdmin(idAdmin: number, idMateria: number) {
    if (!Number.isInteger(idMateria)) return null;

    const [rows]: any = await pool.query(
        `SELECT m.id_materia, ${MATERIA_EM_USO} AS em_uso
           FROM materia m
           JOIN semestre s ON s.id_semestre = m.id_semestre
          WHERE m.id_materia = ?
            AND s.id_admin = ?`,
        [idMateria, idAdmin]
    );

    return rows.length > 0 ? rows[0] : null;
}

async function semestreDoAdmin(idAdmin: number, idSemestre: number) {
    const [rows]: any = await pool.query(
        'SELECT 1 FROM semestre WHERE id_semestre = ? AND id_admin = ?',
        [idSemestre, idAdmin]
    );

    return rows.length > 0;
}

const quantidadeValida = (valor: any) => Number.isInteger(valor) && valor >= 1 && valor <= 99;

// Formato do cadastro e da edicao

function validarCorpoMateria(corpo: any) {
    const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';
    const { qtdAulasSemana, qtdProfessores, idSemestre } = corpo ?? {};

    if (!nome) {
      return { erro: 'Informe o nome da disciplina' };
    }
    if (nome.length > 255) {
      return { erro: 'O nome da disciplina deve ter no máximo 255 caracteres' };
    }
    if (!quantidadeValida(qtdAulasSemana)) {
      return { erro: 'A quantidade de aulas por semana deve ser um número inteiro de 1 a 99' };
    }
    if (!quantidadeValida(qtdProfessores)) {
      return { erro: 'A quantidade de professores deve ser um número inteiro de 1 a 99' };
    }
    if (!Number.isInteger(idSemestre) || idSemestre < 1) {
      return { erro: 'Informe o semestre' };
    }

    return { dados: { nome, qtdAulasSemana, qtdProfessores, idSemestre } };
}

// Lista, com filtro opcional ? semestres=1,3
export async function listarMaterias(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const filtro = req.query.semestres;

    if (filtro !== undefined && (typeof filtro !== 'string' || !/^\d+(,\d+)*$/.test(filtro))) {
      return resposta.status(400).json({ error: 'Filtro de semestres inválido' });
    }

    try {
        const semestres = filtro === undefined ? null : filtro.split(',').map(Number);

        return resposta.json({ materias: await montarMaterias(id, semestres) });
    } catch (error) {
        console.error('Erro ao listar disciplinas:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar as disciplinas' });
    }
}

// Botao "Criar" da secao de disciplinas
export async function criarMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const { erro, dados } = validarCorpoMateria(req.body);

    if (!dados) {
      return resposta.status(400).json({ error: erro });
    }

    try {
        // CU-020 A2
        if (!(await semestreDoAdmin(id, dados.idSemestre))) {
          return resposta.status(400).json({ error: 'Semestre inválido' });
        }

        // Turno fica vazio: ele e da turma, nao da disciplina
        await pool.query(
            `INSERT INTO materia (id_semestre, nome, qtd_aulas_semana, qtd_professores)
             VALUES (?, ?, ?, ?)`,
            [dados.idSemestre, dados.nome, dados.qtdAulasSemana, dados.qtdProfessores]
        );

        return resposta.status(201).json({
            message: 'Disciplina cadastrada',
            materias: await montarMaterias(id),
        });
    } catch (error: any) {
        // Chave unica (id_semestre, nome)
        if (error.code === 'ER_DUP_ENTRY') {
          return resposta.status(409).json({ error: 'Já existe uma disciplina com este nome neste semestre' });
        }

        console.error('Erro ao cadastrar disciplina:', error);
        return resposta.status(500).json({ error: 'Erro interno ao cadastrar a disciplina' });
    }
}

// Edita todos os campos do cadastro
export async function editarMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const { erro, dados } = validarCorpoMateria(req.body);

    if (!dados) {
      return resposta.status(400).json({ error: erro });
    }

    try {
        const materia = await buscarMateriaDoAdmin(id, Number(req.params.idMateria));

        if (!materia) {
          return resposta.status(404).json({ error: 'Disciplina não encontrada' });
        }

        // RN-11: respostas e horarios dependem dos dados da disciplina
        if (materia.em_uso === 1) {
          return resposta.status(409).json({
            error: 'Esta disciplina já é usada em respostas de professores ou em horários e não pode ser alterada',
          });
        }

        if (!(await semestreDoAdmin(id, dados.idSemestre))) {
          return resposta.status(400).json({ error: 'Semestre inválido' });
        }

        await pool.query(
            `UPDATE materia
                SET nome = ?, qtd_aulas_semana = ?, qtd_professores = ?, id_semestre = ?
              WHERE id_materia = ?`,
            [dados.nome, dados.qtdAulasSemana, dados.qtdProfessores, dados.idSemestre, materia.id_materia]
        );

        return resposta.json({
            message: 'Disciplina atualizada',
            materias: await montarMaterias(id),
        });
    } catch (error: any) {
        if (error.code === 'ER_DUP_ENTRY') {
          return resposta.status(409).json({ error: 'Já existe uma disciplina com este nome neste semestre' });
        }

        console.error('Erro ao editar disciplina:', error);
        return resposta.status(500).json({ error: 'Erro interno ao editar a disciplina' });
    }
}

// Botao "Deletar"
export async function excluirMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const materia = await buscarMateriaDoAdmin(id, Number(req.params.idMateria));

        if (!materia) {
          return resposta.status(404).json({ error: 'Disciplina não encontrada' });
        }

        if (materia.em_uso === 1) {
          return resposta.status(409).json({
            error: 'Esta disciplina já é usada em respostas de professores ou em horários e não pode ser excluída',
          });
        }

        await pool.query('DELETE FROM materia WHERE id_materia = ?', [materia.id_materia]);

        return resposta.json({
            message: 'Disciplina excluída',
            materias: await montarMaterias(id),
        });
    } catch (error) {
        console.error('Erro ao excluir disciplina:', error);
        return resposta.status(500).json({ error: 'Erro interno ao excluir a disciplina' });
    }
}
