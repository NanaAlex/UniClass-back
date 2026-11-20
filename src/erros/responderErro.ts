import { Response } from 'express';
import { ErroAplicacao } from './ErroAplicacao';

// Resposta de erro padrao dos controllers: a recusa prevista sai com o seu
// status; qualquer outra falha vai para o log e sai como 500, sem detalhes.
export function responderErro(resposta: Response, erro: unknown, log: string, mensagemInterna: string) {
    if (erro instanceof ErroAplicacao) {
      return resposta.status(erro.status).json({ error: erro.message });
    }

    console.error(log, erro);
    return resposta.status(500).json({ error: mensagemInterna });
}
