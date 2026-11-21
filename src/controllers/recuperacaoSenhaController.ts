import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as recuperacaoSenhaService from '../services/recuperacaoSenhaService';

// RF 1.4, CU-003: pedido de recuperacao (resposta igual exista o e-mail ou nao)
export async function solicitarRecuperacaoSenha(req: Request, resposta: Response) {
    try {
        await recuperacaoSenhaService.solicitarRecuperacao(req.body.email);
        return resposta.json({ message: recuperacaoSenhaService.MENSAGEM_ENVIO });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao solicitar recuperação de senha:', 'Erro ao solicitar recuperação de senha');
    }
}

export async function verificarTokenRecuperacao(req: Request, resposta: Response) {
    try {
        return resposta.json(await recuperacaoSenhaService.verificarToken(req.params.token));
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao verificar link de recuperação:', 'Erro ao verificar link de recuperação');
    }
}

export async function redefinirSenha(req: Request, resposta: Response) {
    try {
        await recuperacaoSenhaService.redefinirSenha(req.body);
        return resposta.json({ message: 'Senha redefinida com sucesso. Faça login com a nova senha.' });
    } catch (erro) {
        return responderErro(resposta, erro, 'Erro ao redefinir senha:', 'Erro ao redefinir senha');
    }
}
