import { Request, Response } from 'express';
import bcrypt                from 'bcryptjs';
import crypto                from 'crypto';
import pool                  from '../database/connection';
import { enviarEmail }       from '../utils/email';
import { emailValido, senhaValida } from '../utils/validacoes';

/*
   Recuperação de senha (RF 1.4, CU-003, ADR 012)
   1. POST /auth/recuperar-senha         -> gera o token e manda o link por e-mail
   2. GET  /auth/recuperar-senha/:token  -> a tela do link confere se ele ainda vale
   3. POST /auth/redefinir-senha         -> grava a senha nova e invalida o link

   Mesmas regras do convite e da sessão: o token vai só no link
   do e-mail; no banco fica apenas o hash SHA-256 dele.
*/

const VALIDADE_TOKEN_HORAS = 1;

// Mesma resposta exista o e-mail ou não: não revela quem tem conta
const MENSAGEM_ENVIO = 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha';
const MENSAGEM_LINK_INVALIDO = 'Este link de recuperação é inválido ou expirou. Solicite um novo.';

const gerarHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/*
   Token válido: não usado, não invalidado, dentro do prazo e de
   uma conta ativa (RF 1.6: conta desativada não recupera senha)
*/
async function buscarTokenValido(token: string) {
    const [rows]: any = await pool.query(
        `SELECT t.id_token, t.id_usuario, u.email
           FROM token_recuperacao_senha t
           JOIN usuario u ON u.id_usuario = t.id_usuario
          WHERE t.token_hash = ?
            AND t.data_utilizacao IS NULL
            AND t.data_invalidacao IS NULL
            AND t.data_expiracao > NOW()
            AND u.ativo = TRUE`,
        [gerarHash(token)]
    );

    return rows.length > 0 ? rows[0] : null;
}

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
   1. Pedido de recuperação
   Responde sempre 200 com a mesma mensagem (e-mail existente ou
   não), para ninguém descobrir quais e-mails têm conta.
*/
export async function solicitarRecuperacaoSenha(req: Request, resposta: Response) {
    const email = String(req.body.email ?? '').trim().toLowerCase();

    if (!emailValido(email)) {
        return resposta.status(400).json({ error: 'Informe um e-mail válido' });
    }

    try {
        const [usuarios]: any = await pool.query(
            'SELECT id_usuario, nome FROM usuario WHERE email = ? AND ativo = TRUE',
            [email]
        );

        if (usuarios.length === 0) {
            return resposta.json({ message: MENSAGEM_ENVIO });
        }

        const usuario = usuarios[0];

        await pool.query(
            `UPDATE token_recuperacao_senha
                SET data_invalidacao = NOW()
              WHERE id_usuario = ?
                AND data_utilizacao IS NULL
                AND data_invalidacao IS NULL`,
            [usuario.id_usuario]
        );

        const token = crypto.randomBytes(32).toString('hex');

        const [resultado]: any = await pool.query(
            `INSERT INTO token_recuperacao_senha (id_usuario, token_hash, data_criacao, data_expiracao)
             VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
            [usuario.id_usuario, gerarHash(token), VALIDADE_TOKEN_HORAS]
        );

        const link = `${process.env.APP_URL || 'http://localhost:3000'}/redefinir-senha/${token}`;
        const { assunto, texto, html } = montarEmailRecuperacao(usuario.nome, link);

        try {
            await enviarEmail(email, assunto, texto, html);
        } catch (erroEmail) {
            await pool.query(
                'UPDATE token_recuperacao_senha SET data_invalidacao = NOW() WHERE id_token = ?',
                [resultado.insertId]
            );
            console.error('Erro ao enviar e-mail de recuperação:', erroEmail);
            return resposta.status(502).json({ error: 'Não foi possível enviar o e-mail. Tente novamente.' });
        }

        return resposta.json({ message: MENSAGEM_ENVIO });

    } catch (error) {
        console.error('Erro ao solicitar recuperação de senha:', error);
        return resposta.status(500).json({ error: 'Erro ao solicitar recuperação de senha' });
    }
}

export async function verificarTokenRecuperacao(req: Request, resposta: Response) {
    try {
        const registro = await buscarTokenValido(req.params.token);

        if (!registro) {
            return resposta.status(400).json({ error: MENSAGEM_LINK_INVALIDO });
        }

        return resposta.json({ valido: true, email: registro.email });

    } catch (error) {
        console.error('Erro ao verificar link de recuperação:', error);
        return resposta.status(500).json({ error: 'Erro ao verificar link de recuperação' });
    }
}

/*
   3. Grava a senha nova
   Numa transação: troca a senha, marca o link como usado e
   encerra todas as sessões abertas da conta (quem tinha a senha
   antiga perde o acesso). Depois o usuário faz login de novo.
*/
export async function redefinirSenha(req: Request, resposta: Response) {
    const { token, novaSenha, confirmacaoSenha } = req.body;

    if (!token || !novaSenha || !confirmacaoSenha) {
        return resposta.status(400).json({ error: 'Preencha todos os campos' });
    }

    if (novaSenha !== confirmacaoSenha) {
        return resposta.status(400).json({ error: 'A confirmação não corresponde à nova senha' });
    }

    if (!senhaValida(novaSenha)) {
        return resposta.status(400).json({
            error: 'A nova senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e caractere especial',
        });
    }

    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const [rows]: any = await conexao.query(
            `SELECT t.id_token, t.id_usuario
               FROM token_recuperacao_senha t
               JOIN usuario u ON u.id_usuario = t.id_usuario
              WHERE t.token_hash = ?
                AND t.data_utilizacao IS NULL
                AND t.data_invalidacao IS NULL
                AND t.data_expiracao > NOW()
                AND u.ativo = TRUE
              FOR UPDATE`,
            [gerarHash(token)]
        );

        if (rows.length === 0) {
            await conexao.rollback();
            return resposta.status(400).json({ error: MENSAGEM_LINK_INVALIDO });
        }

        const { id_token, id_usuario } = rows[0];
        const novoHash = await bcrypt.hash(novaSenha, 10);

        await conexao.query('UPDATE usuario SET senha_hash = ? WHERE id_usuario = ?', [novoHash, id_usuario]);

        await conexao.query(
            'UPDATE token_recuperacao_senha SET data_utilizacao = NOW() WHERE id_token = ?',
            [id_token]
        );

        await conexao.query(
            `UPDATE sessao
                SET encerrada_em = NOW(),
                    motivo_encerramento = 'SENHA_ALTERADA'
              WHERE id_usuario = ?
                AND encerrada_em IS NULL`,
            [id_usuario]
        );

        await conexao.commit();

        return resposta.json({ message: 'Senha redefinida com sucesso. Faça login com a nova senha.' });

    } catch (error) {
        await conexao.rollback();
        console.error('Erro ao redefinir senha:', error);
        return resposta.status(500).json({ error: 'Erro ao redefinir senha' });
    } finally {
        conexao.release();
    }
}