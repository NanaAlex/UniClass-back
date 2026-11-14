import { Request, Response } from 'express';
import crypto                from 'crypto';
import pool                  from '../database/connection';
import { enviarEmail }       from '../utils/email';
import { emailValido }       from '../utils/validacoes';

// RNF 8: o link do convite vale 72 horas
const VALIDADE_CONVITE_HORAS = 72;
const LIMITE_EMAILS_POR_ENVIO = 50;

const gerarHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const escaparHtml = (texto: string) =>
    texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// RN-39: o e-mail leva so o necessario (quem convidou e o link)
function montarEmailConvite(tipo: string, nomeAdmin: string, link: string) {
    const acao = tipo === 'CRIACAO_CONTA'
        ? 'criar sua conta de professor'
        : 'vincular sua conta de professor';

    const assunto = 'Convite para o Staggy';
    const texto =
        `${nomeAdmin} convidou você para ${acao} no Staggy.\n\n` +
        `Acesse o link abaixo (válido por ${VALIDADE_CONVITE_HORAS} horas):\n${link}\n\n` +
        'Se você não esperava este convite, ignore este e-mail.';
    const html =
        `<p>${escaparHtml(nomeAdmin)} convidou você para ${acao} no Staggy.</p>` +
        `<p><a href="${link}">Aceitar convite</a> (válido por ${VALIDADE_CONVITE_HORAS} horas)</p>` +
        '<p>Se você não esperava este convite, ignore este e-mail.</p>';

    return { assunto, texto, html };
}

// Registra e envia o convite de um e-mail; o resultado vai na resposta do lote
async function convidar(idAdmin: number, nomeAdmin: string, email: string) {
    const [usuarios]: any = await pool.query(
        `SELECT u.id_usuario, u.tipo_usuario, v.ativo AS vinculo_ativo
           FROM usuario u
           LEFT JOIN vinculo_professor_admin v
             ON v.id_professor = u.id_usuario
            AND v.id_admin = ?
          WHERE u.email = ?`,
        [idAdmin, email]
    );

    const usuario = usuarios.length > 0 ? usuarios[0] : null;

    if (usuario && usuario.tipo_usuario !== 'PROFESSOR') {
      return { email, enviado: false, error: 'Este e-mail pertence a um administrador' };
    }
    if (usuario && usuario.vinculo_ativo === 1) {
      return { email, enviado: false, error: 'Este professor já está vinculado a você' };
    }

    // CU-007: professor ja cadastrado recebe convite de vinculo, sem duplicar a conta
    const tipo  = usuario ? 'VINCULO' : 'CRIACAO_CONTA';
    const token = crypto.randomBytes(32).toString('hex');

    const conexao = await pool.getConnection();
    let idConvite: number;

    try {
        await conexao.beginTransaction();

        // RNF 8: um novo convite invalida o anterior
        await conexao.query(
            `UPDATE convite_professor
                SET status = 'INVALIDADO'
              WHERE id_admin = ? AND email_destino = ? AND status = 'PENDENTE'`,
            [idAdmin, email]
        );

        const [resultado]: any = await conexao.query(
            `INSERT INTO convite_professor
                    (id_admin, email_destino, tipo_convite, token_hash, status, data_envio, data_expiracao, id_professor)
             VALUES (?, ?, ?, ?, 'PENDENTE', NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR), ?)`,
            [idAdmin, email, tipo, gerarHash(token), VALIDADE_CONVITE_HORAS, usuario ? usuario.id_usuario : null]
        );
        idConvite = resultado.insertId;

        await conexao.commit();
    } catch (error) {
        await conexao.rollback();
        throw error;
    } finally {
        conexao.release();
    }

    const link = `${process.env.APP_URL || 'http://localhost:5173'}/convite/${token}`;
    const { assunto, texto, html } = montarEmailConvite(tipo, nomeAdmin, link);

    try {
        await enviarEmail(email, assunto, texto, html);
    } catch (error) {
        console.error(`Erro ao enviar convite para ${email}:`, error);

        // CU-005 A3: convite que nao saiu nao pode continuar valido
        await pool.query(
            "UPDATE convite_professor SET status = 'INVALIDADO' WHERE id_convite = ?",
            [idConvite]
        );
        return { email, enviado: false, error: 'Não foi possível enviar o convite' };
    }

    return { email, tipo, enviado: true };
}

// CU-005 / CU-007: aceita um ou mais e-mails (lista ou texto separado por virgula, espaco ou linha)
export async function convidarProfessores(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const entrada = req.body.emails;

    const lista: any[] = Array.isArray(entrada)
        ? entrada
        : typeof entrada === 'string' ? entrada.split(/[\s,;]+/) : [];

    const emails: string[] = [...new Set(
        lista
            .filter((item) => typeof item === 'string')
            .map((item: string) => item.trim().toLowerCase())
            .filter((item) => item !== '')
    )];

    if (emails.length === 0) {
      return resposta.status(400).json({ error: 'Informe pelo menos um e-mail' });
    }
    if (emails.length > LIMITE_EMAILS_POR_ENVIO) {
      return resposta.status(400).json({ error: `Envie no máximo ${LIMITE_EMAILS_POR_ENVIO} convites por vez` });
    }

    // CU-005 A1: e-mails invalidos precisam ser corrigidos antes do envio
    const invalidos = emails.filter((email) => !emailValido(email));
    if (invalidos.length > 0) {
      return resposta.status(400).json({ error: 'Corrija os e-mails inválidos antes de enviar', invalidos });
    }

    try {
        const [admins]: any = await pool.query('SELECT nome FROM usuario WHERE id_usuario = ?', [id]);
        const nomeAdmin = admins[0].nome;

        const resultados = [];
        for (const email of emails) {
            resultados.push(await convidar(id, nomeAdmin, email));
        }

        const enviados = resultados.filter((item) => item.enviado).length;
        const message   = `${enviados} de ${emails.length} convite(s) enviado(s)`;

        // Nenhum enviado: o motivo do primeiro recusado vai em error, como nos outros 400
        if (enviados === 0) {
          return resposta.status(400).json({ error: resultados[0].error, message, resultados });
        }

        return resposta.status(201).json({ message, resultados });
    } catch (error) {
        console.error('Erro ao convidar professores:', error);
        return resposta.status(500).json({ error: 'Erro interno ao enviar os convites' });
    }
}

// Convite pendente e no prazo; um convite vencido e marcado como EXPIRADO aqui
export async function buscarConvitePendente(token: string) {
    const [convites]: any = await pool.query(
        `SELECT c.id_convite, c.id_admin, c.email_destino, c.tipo_convite, c.status, c.id_professor,
                c.data_expiracao <= NOW() AS expirado, u.nome AS nome_admin
           FROM convite_professor c
           JOIN usuario u ON u.id_usuario = c.id_admin
          WHERE c.token_hash = ?`,
        [gerarHash(token)]
    );

    if (convites.length === 0 || convites[0].status !== 'PENDENTE') {
      return null;
    }

    const convite = convites[0];

    if (convite.expirado === 1) {
        await pool.query(
            "UPDATE convite_professor SET status = 'EXPIRADO' WHERE id_convite = ?",
            [convite.id_convite]
        );
        return null;
    }

    return convite;
}

export const MENSAGEM_CONVITE_INVALIDO =
    'Convite inválido, expirado ou já utilizado. Peça um novo convite ao administrador';

// Tela aberta pelo link do e-mail: diz se e criacao de conta ou vinculo
export async function verConvite(req: Request, resposta: Response) {
    try {
        const convite = await buscarConvitePendente(String(req.params.token));

        if (!convite) {
          return resposta.status(404).json({ error: MENSAGEM_CONVITE_INVALIDO });
        }

        return resposta.json({
            convite: {
                email: convite.email_destino,
                tipo: convite.tipo_convite,
                administrador: convite.nome_admin,
            },
        });
    } catch (error) {
        console.error('Erro ao consultar convite:', error);
        return resposta.status(500).json({ error: 'Erro interno ao consultar o convite' });
    }
}

// CU-007: professor que ja tem conta aceita o vinculo com o administrador
// (a criacao de conta pelo convite fica em authController.registro)
export async function aceitarVinculo(req: Request, resposta: Response) {
    try {
        const convite = await buscarConvitePendente(String(req.params.token));

        if (!convite || convite.tipo_convite !== 'VINCULO') {
          return resposta.status(404).json({ error: MENSAGEM_CONVITE_INVALIDO });
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            // Marca o convite primeiro: se o link ja foi usado em paralelo, nada e feito
            const [usoConvite]: any = await conexao.query(
                `UPDATE convite_professor
                    SET status = 'ACEITO', data_aceite = NOW()
                  WHERE id_convite = ? AND status = 'PENDENTE'`,
                [convite.id_convite]
            );

            if (usoConvite.affectedRows === 0) {
                await conexao.rollback();
                return resposta.status(404).json({ error: MENSAGEM_CONVITE_INVALIDO });
            }

            // Reativa um vinculo antigo, se houver
            await conexao.query(
                `INSERT INTO vinculo_professor_admin (id_admin, id_professor, ativo, data_vinculo)
                 VALUES (?, ?, TRUE, NOW())
                 ON DUPLICATE KEY UPDATE ativo = TRUE, data_vinculo = NOW(), data_desvinculo = NULL`,
                [convite.id_admin, convite.id_professor]
            );

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({ message: `Você agora está vinculado a ${convite.nome_admin}` });
    } catch (error) {
        console.error('Erro ao aceitar vínculo:', error);
        return resposta.status(500).json({ error: 'Erro interno ao aceitar o convite' });
    }
}
