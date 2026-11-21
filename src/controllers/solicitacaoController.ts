import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as solicitacaoService from '../services/solicitacaoService';

export async function solicitarAlteracaoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const idSolicitacao = await solicitacaoService.solicitarAlteracaoFormulario(
            id, Number(req.params.idFormulario), req.body?.motivo);
        return resposta.status(201).json({ message: 'Solicitação enviada com sucesso', idSolicitacao });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao solicitar alteração:', 'Erro ao enviar solicitação');
    }
}

export async function listarSolicitacoesFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ solicitacoes: await solicitacaoService.listarSolicitacoesFormulario(id) });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar solicitações:', 'Erro ao listar solicitações');
    }
}

// CU-053
export async function solicitarAlteracaoHorario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const idSolicitacao = await solicitacaoService.solicitarAlteracaoHorario(id, req.body);
        return resposta.status(201).json({ message: 'Solicitação enviada com sucesso', idSolicitacao });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao solicitar alteração do horário:', 'Erro ao solicitar alteração do horário');
    }
}

// CU-054
export async function listarSolicitacoesHorario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ solicitacoes: await solicitacaoService.listarSolicitacoesHorario(id) });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar solicitações do horário:', 'Erro ao listar solicitações do horário');
    }
}
