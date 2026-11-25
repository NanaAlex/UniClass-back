import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transportador: Transporter | null = null;

// Sem SMTP_HOST no .env, usa uma caixa de teste do Ethereal:
// o e-mail nao chega de verdade, mas o link para visualiza-lo sai no console
async function obterTransportador() {
    if (transportador) {
      return transportador;
    }

    if (process.env.SMTP_HOST) {
        const porta = Number(process.env.SMTP_PORT) || 465;

        transportador = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: porta,
            secure: porta === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    } else {
        const contaTeste = await nodemailer.createTestAccount();

        transportador = nodemailer.createTransport({
            host: contaTeste.smtp.host,
            port: contaTeste.smtp.port,
            secure: contaTeste.smtp.secure,
            auth: {
                user: contaTeste.user,
                pass: contaTeste.pass,
            },
        });
    }

    return transportador;
}

export async function enviarEmail(para: string, assunto: string, texto: string, html: string) {
    const transporte = await obterTransportador();
    const remetente  = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@staggy.local';

    const info = await transporte.sendMail({
        from: `"Staggy" <${remetente}>`,
        to: para,
        subject: assunto,
        text: texto,
        html,
    });

    const previa = nodemailer.getTestMessageUrl(info);
    if (previa) {
      console.log(`E-mail de teste para ${para}: ${previa}`);
    }
}
