import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as dadosService from '../services/dadosService';

// Tela "Dados do curso": carrega as tres abas numa requisicao
export async function lerDados(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json(await dadosService.montarDados(id));
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao ler os dados do curso:', 'Erro interno ao carregar os dados do curso');
    }
}

// Botao "Salvar dados": grava a aba inteira, tudo ou nada (D1 da spec 08.02)
export async function salvarDados(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json({ message: 'Dados salvos', ...(await dadosService.salvarDados(id, req.body)) });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao salvar os dados do curso:', 'Erro interno ao salvar os dados do curso');
    }
}
