import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { emTransacao } from '../database/transacao';
import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as sessaoRepository from '../repositories/sessaoRepository';
import * as tokenRecuperacaoRepository from '../repositories/tokenRecuperacaoRepository';
import * as usuarioRepository from '../repositories/usuarioRepository';
import { enviarEmail } from '../utils/email';
import { emailValido, senhaValida } from '../utils/validacoes';

/*
   Recuperacao de senha (RF 1.4, CU-003, ADR 012)
   1. POST /auth/recuperar-senha         -> gera o token e manda o link por e-mail
   2. GET  /auth/recuperar-senha/:token  -> a tela do link confere se ele ainda vale
   3. POST /auth/redefinir-senha         -> grava a senha nova e invalida o link

   Mesmas regras do convite e da sessao: o token vai so no link
   do e-mail; no banco fica apenas o hash SHA-256 dele.
*/

const VALIDADE_TOKEN_HORAS = 1;

// Mesma resposta exista o e-mail ou nao: nao revela quem tem conta
export const MENSAGEM_ENVIO = 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha';
const MENSAGEM_LINK_INVALIDO = 'Este link de recuperação é inválido ou expirou. Solicite um novo.';

const gerarHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function montarEmailRecuperacao(nome: string, link: string) {
    const assunto = 'Staggy: redefinição de senha';
    const texto =
        `Olá, ${nome}.\n\n` +
        `Recebemos um pedido para redefinir a sua senha no Staggy.\n` +
        `Para criar uma senha nova, acesse: ${link}\n\n` +
        `O link vale por ${VALIDADE_TOKEN_HORAS} hora e só pode ser usado uma vez.\n` +
        `Se não foi você, ignore este e-mail: a sua senha continua a mesma.`;
    const html =
        `<p>Olá, ${nome}.</p>` +
        `<p>Recebemos um pedido para redefinir a sua senha no Staggy.</p>` +
        `<p><a href="${link}">Criar uma senha nova</a></p>` +
        `<p>O link vale por ${VALIDADE_TOKEN_HORAS} hora e só pode ser usado uma vez.</p>` +
        `<p>Se não foi você, ignore este e-mail: a sua senha continua a mesma.</p>`;

    return { assunto, texto, html };
}

/*
   1. Pedido de recuperacao. Sem erro, a resposta e sempre a mesma (e-mail
   existente ou nao), para ninguem descobrir quais e-mails tem conta.
*/
export async function solicitarRecuperacao(emailInformado: unknown): Promise<void> {
    const email = String(emailInformado ?? '').trim().toLowerCase();

    if (!emailValido(email)) {
      throw new ErroAplicacao(400, 'Informe um e-mail válido');
    }

    const usuario = await usuarioRepository.buscarAtivoPorEmail(email);
    if (!usuario) return;

    await tokenRecuperacaoRepository.invalidarAbertosDoUsuario(usuario.id);

    const token = crypto.randomBytes(32).toString('hex');
    const idToken = await tokenRecuperacaoRepository.inserir(usuario.id, gerarHash(token), VALIDADE_TOKEN_HORAS);

    const link = `${process.env.APP_URL || 'http://localhost:3000'}/redefinir-senha/${token}`;
    const { assunto, texto, html } = montarEmailRecuperacao(usuario.nome, link);

    try {
        await enviarEmail(email, assunto, texto, html);
    } catch (erroEmail) {
        // Link que nao chegou nao pode valer
        await tokenRecuperacaoRepository.invalidar(idToken);
        console.error('Erro ao enviar e-mail de recuperação:', erroEmail);
        throw new ErroAplicacao(502, 'Não foi possível enviar o e-mail. Tente novamente.');
    }
}

// 2. A tela do link confere se ele ainda vale
export async function verificarToken(token: string): Promise<{ valido: true; email: string }> {
    const registro = await tokenRecuperacaoRepository.buscarValido(gerarHash(token));

    if (!registro) {
      throw new ErroAplicacao(400, MENSAGEM_LINK_INVALIDO);
    }
    return { valido: true, email: registro.email };
}

/*
   3. Grava a senha nova. Numa transacao: troca a senha, marca o link como usado
   e encerra todas as sessoes abertas da conta. Depois o usuario faz login de novo.
*/
export async function redefinirSenha(corpo: any): Promise<void> {
    const { token, novaSenha, confirmacaoSenha } = corpo;

    if (!token || !novaSenha || !confirmacaoSenha) {
      throw new ErroAplicacao(400, 'Preencha todos os campos');
    }
    if (novaSenha !== confirmacaoSenha) {
      throw new ErroAplicacao(400, 'A confirmação não corresponde à nova senha');
    }
    if (!senhaValida(novaSenha)) {
      throw new ErroAplicacao(400,
        'A nova senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e caractere especial');
    }

    await emTransacao(async (conexao) => {
        const registro = await tokenRecuperacaoRepository.travarValido(gerarHash(token), conexao);

        if (!registro) {
          throw new ErroAplicacao(400, MENSAGEM_LINK_INVALIDO);
        }

        const novoHash = await bcrypt.hash(novaSenha, 10);

        await usuarioRepository.atualizarSenha(registro.idUsuario, novoHash, conexao);
        await tokenRecuperacaoRepository.marcarUsado(registro.id, conexao);
        await sessaoRepository.encerrarTodasDoUsuario(registro.idUsuario, 'SENHA_ALTERADA', conexao);
    });
}
