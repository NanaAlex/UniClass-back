import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as turmaService from '../services/turmaService';

// CU-019
export async function adicionarTurma(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await turmaService.adicionarTurma(id, Number(req.params.idSemestre), req.body?.turno);
        return resposta.status(201).json({ message: 'Turma adicionada', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao adicionar turma:', 'Erro interno ao adicionar a turma');
    }
}

// CU-019
export async function alterarTurnoTurma(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await turmaService.alterarTurnoTurma(id, Number(req.params.idTurma), req.body?.turno);
        return resposta.json({ message: 'Turno da turma alterado', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao alterar turno da turma:', 'Erro interno ao alterar o turno da turma');
    }
}

// CU-019
export async function retirarTurma(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await turmaService.retirarTurma(id, Number(req.params.idTurma));
        return resposta.json({ message: 'Turma retirada', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao retirar turma:', 'Erro interno ao retirar a turma');
    }
}
