import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as publicacaoService from '../services/publicacaoService';

// CU-026
export async function listarFormulariosDoAdmin(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ formularios: await publicacaoService.listarFormularios(id) });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar formulários:', 'Erro interno ao listar os formulários');
    }
}

// CU-023 e CU-024
export async function lancarFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const formularios = await publicacaoService.lancarFormulario(id, req.body);
        return resposta.status(201).json({
            message: formularios[0].status === 'ABERTO' ? 'Formulário lançado e aberto para respostas' : 'Formulário programado',
            formularios,
        });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao lançar formulário:', 'Erro interno ao lançar o formulário');
    }
}

// CU-024
export async function editarDatasFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const formularios = await publicacaoService.editarDatas(id, Number(req.params.idFormulario), req.body);
        return resposta.json({ message: 'Datas do formulário atualizadas', formularios });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao editar datas do formulário:', 'Erro interno ao editar as datas do formulário');
    }
}

// CU-023
export async function abrirFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const { reaberto, formularios } = await publicacaoService.abrirFormulario(id, Number(req.params.idFormulario));
        return resposta.json({ message: reaberto ? 'Formulário reaberto' : 'Formulário aberto', formularios });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao abrir formulário:', 'Erro interno ao abrir o formulário');
    }
}

// CU-025
export async function encerrarFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const formularios = await publicacaoService.encerrarFormulario(id, Number(req.params.idFormulario));
        return resposta.json({ message: 'Formulário encerrado', formularios });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao encerrar formulário:', 'Erro interno ao encerrar o formulário');
    }
}

// CU-027 e CU-028
export async function listarProfessoresDoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json(await publicacaoService.listarProfessores(id, Number(req.params.idFormulario), req.query.situacao));
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao listar professores do formulário:', 'Erro interno ao listar os professores do formulário');
    }
}
