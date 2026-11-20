import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as diaLetivoService from '../services/diaLetivoService';

export async function listarDias(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json(await diaLetivoService.listarDias(id, req.params.turno));
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar dias letivos:', 'Erro interno ao listar os dias letivos');
    }
}

// CU-015
export async function adicionarDia(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await diaLetivoService.adicionarDia(id, req.params.turno, req.body?.diaSemana);
        return resposta.status(201).json({ message: 'Dia letivo adicionado', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao adicionar dia letivo:', 'Erro interno ao adicionar o dia letivo');
    }
}

// CU-015
export async function excluirDia(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const resultado = await diaLetivoService.excluirDia(id, Number(req.params.idDiaLetivo));
        return resposta.json({ message: 'Dia letivo excluído', ...resultado });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao excluir dia letivo:', 'Erro interno ao excluir o dia letivo');
    }
}
