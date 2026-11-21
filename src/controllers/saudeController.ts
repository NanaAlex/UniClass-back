import { Request, Response } from 'express';
import { spawn } from 'child_process';
import pool from '../database/connection';
import { caminhoSwipl } from '../motor/supervisor';

// RN-72, ET-18, CA-199: a saúde reflete as dependências críticas (banco e
// motor Prolog), sem expor credenciais nem mensagens internas.

const LIMITE_MS = 3000;

function comPrazo<T>(promessa: Promise<T>): Promise<T> {
    return Promise.race([
        promessa,
        new Promise<T>((_, rejeitar) => setTimeout(() => rejeitar(new Error('tempo esgotado')), LIMITE_MS)),
    ]);
}

async function bancoDisponivel(): Promise<boolean> {
    try {
        await comPrazo(pool.query('SELECT 1'));
        return true;
    } catch {
        return false;
    }
}

function motorDisponivel(): Promise<boolean> {
    return new Promise((resolve) => {
        let filho: ReturnType<typeof spawn>;
        try {
            filho = spawn(caminhoSwipl(), ['--version'], { windowsHide: true });
        } catch {
            resolve(false);
            return;
        }
        const prazo = setTimeout(() => {
            filho.kill('SIGKILL');
            resolve(false);
        }, LIMITE_MS);
        filho.on('error', () => {
            clearTimeout(prazo);
            resolve(false);
        });
        filho.on('close', (codigo) => {
            clearTimeout(prazo);
            resolve(codigo === 0);
        });
    });
}

export async function saude(req: Request, resposta: Response) {
    const [banco, motor] = await Promise.all([bancoDisponivel(), motorDisponivel()]);
    const ok = banco && motor;
    return resposta.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degradado',
        dependencias: {
            banco_de_dados: banco ? 'disponivel' : 'indisponivel',
            motor_prolog: motor ? 'disponivel' : 'indisponivel',
        },
    });
}
