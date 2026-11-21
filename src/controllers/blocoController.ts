import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as blocoService from '../services/blocoService';

export async function listarBlocos(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json(await blocoService.listarBlocos(id, req.params.turno));
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar blocos:', 'Erro interno ao listar os blocos');
    }
}

// CU-017
export async function criarBloco(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await blocoService.criarBloco(id, req.params.turno, req.body);
        return resposta.status(201).json({ message: 'Bloco adicionado', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao criar bloco:', 'Erro interno ao adicionar o bloco');
    }
}

export async function editarBloco(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await blocoService.editarBloco(id, Number(req.params.idBloco), req.body);
        return resposta.json({ message: 'Bloco alterado', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao editar bloco:', 'Erro interno ao alterar o bloco');
    }
}

// CU-016
export async function alterarTamanhoBlocos(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await blocoService.alterarTamanhoBlocos(id, req.params.turno, req.body?.qtdAulas);
        return resposta.json({ message: 'Quantidade de aulas dos blocos alterada em todos os turnos', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao alterar tamanho dos blocos:', 'Erro interno ao alterar a quantidade de aulas');
    }
}

// CU-017
export async function excluirBloco(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await blocoService.excluirBloco(id, Number(req.params.idBloco));
        return resposta.json({ message: 'Bloco excluído', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao excluir bloco:', 'Erro interno ao excluir o bloco');
    }
}
