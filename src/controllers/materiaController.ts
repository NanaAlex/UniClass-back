import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as materiaService from '../services/materiaService';

// CU-020: lista, com filtro opcional ?semestres=1,3
export async function listarMaterias(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ materias: await materiaService.listarMaterias(id, req.query.semestres) });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar disciplinas:', 'Erro interno ao listar as disciplinas');
    }
}

// CU-020
export async function criarMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const materias = await materiaService.criarMateria(id, req.body);
        return resposta.status(201).json({ message: 'Disciplina cadastrada', materias });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao cadastrar disciplina:', 'Erro interno ao cadastrar a disciplina');
    }
}

// CU-020
export async function editarMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const materias = await materiaService.editarMateria(id, Number(req.params.idMateria), req.body);
        return resposta.json({ message: 'Disciplina atualizada', materias });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao editar disciplina:', 'Erro interno ao editar a disciplina');
    }
}

// CU-020
export async function excluirMateria(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const materias = await materiaService.excluirMateria(id, Number(req.params.idMateria));
        return resposta.json({ message: 'Disciplina excluída', materias });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao excluir disciplina:', 'Erro interno ao excluir a disciplina');
    }
}
