import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as semestreService from '../services/semestreService';

export async function listarSemestres(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ semestres: await semestreService.listarSemestres(id) });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar semestres:', 'Erro interno ao listar os semestres');
    }
}

// CU-018
export async function criarSemestre(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const semestres = await semestreService.criarSemestre(id);
        return resposta.status(201).json({ message: 'Semestre criado', semestres });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao criar semestre:', 'Erro interno ao criar o semestre');
    }
}

// CU-018
export async function excluirSemestre(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const semestres = await semestreService.excluirSemestre(id, Number(req.params.idSemestre));
        return resposta.json({ message: 'Semestre excluído', semestres });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao excluir semestre:', 'Erro interno ao excluir o semestre');
    }
}
