import { Request, Response } from 'express';
import pool from '../database/connection';

// Disciplina em uso: interesse em resposta do formulario, aula alocada ou pendencia de geracao
const EM_USO = `(EXISTS (SELECT 1 FROM interesse_materia i WHERE i.id_materia = m.id_materia)
                 OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_materia = m.id_materia)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_materia = m.id_materia))`;

// Disciplinas do admin, na ordem dos semestres e por nome; filtro opcional por semestres
async function montarMaterias(idAdmin: number, semestres: number[] | null = null) {
    const [rows]: any = await pool.query(
        `SELECT m.id_materia, m.nome, m.qtd_aulas_semana, m.qtd_professores,
                s.id_semestre, s.numero, s.nome AS nome_semestre,
                ${EM_USO} AS em_uso
           FROM materia m
           JOIN (SELECT id_semestre, nome, ROW_NUMBER() OVER (ORDER BY id_semestre) AS numero
                   FROM semestre
                  WHERE id_admin = ?) s ON s.id_semestre = m.id_semestre
          WHERE m.ativo = TRUE
            ${semestres ? 'AND m.id_semestre IN (?)' : ''}
          ORDER BY s.numero, m.nome`,
        semestres ? [idAdmin, semestres] : [idAdmin]
    );

    return rows.map((linha: any) => ({
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

// Disciplina de um semestre do admin; id invalido ou de outro admin devolve null (404)
async function buscarMateriaDoAdmin(idAdmin: number, idMateria: number) {
    if (!Number.isInteger(idMateria)) return null;

    const [rows]: any = await pool.query(
        `SELECT m.id_materia, ${EM_USO} AS em_uso
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

// Formato do cadastro e da edicao, sem banco (CU-020 A1, CU-021 A2)
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

// CU-021 e CU-022: lista, com filtro opcional ?semestres=1,3
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

// CU-020: botao "Criar" da secao de disciplinas
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

// CU-021: edita todos os campos do cadastro
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

// CU-021: botao "Deletar"
export async function excluirMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const materia = await buscarMateriaDoAdmin(id, Number(req.params.idMateria));

        if (!materia) {
          return resposta.status(404).json({ error: 'Disciplina não encontrada' });
        }

        // CU-021 A1
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
