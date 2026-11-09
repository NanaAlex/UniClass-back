// Supervisor do processo Prolog (RN-48, RN-51, RN-66, ET-09, ET-15).
// - Relógio monotônico (performance.now) com prazo único; ao estourar, o
//   processo é encerrado e o incumbente recebido por stream é preservado.
// - Cada evento chega como uma linha JSON; o último incumbente sobrevive a
//   quedas do motor e fica disponível como candidato recuperável (CA-175).

import { spawn } from 'child_process';
import path from 'path';
import { performance } from 'perf_hooks';
import type { EventoIncumbente, EventoProva, ResultadoMotor, Snapshot } from './tipos';

export interface OpcoesSupervisor {
  limiteMs: number;
  caminhoSwipl?: string;
  caminhoMotor?: string;
  rastreio?: number;
  limitePilha?: string;
  aoEvento?: (evento: Record<string, unknown>) => void;
}

export interface ExecucaoBruta {
  resultado: ResultadoMotor | null;
  ultimoIncumbente: EventoIncumbente | null;
  tempoPrimeiroIncumbenteMs: number | null;
  provas: EventoProva[];
  decisoes: Record<string, unknown>[];
  encerradoPorPrazo: boolean;
  codigoSaida: number | null;
  sinal: string | null;
  erroInicializacao: string | null;
  stderr: string;
  linhasInvalidas: number;
  duracaoMs: number;
}

export const CAMINHO_MOTOR_PADRAO = path.resolve(__dirname, '..', '..', 'prolog', 'executar.pl');
const MAX_STDERR = 8000;

export function caminhoSwipl(): string {
  return process.env.SWIPL_PATH && process.env.SWIPL_PATH.trim() !== '' ? process.env.SWIPL_PATH : 'swipl';
}

export function executarMotor(snapshot: Snapshot, opcoes: OpcoesSupervisor): Promise<ExecucaoBruta> {
  const inicio = performance.now();
  const bruta: ExecucaoBruta = {
    resultado: null,
    ultimoIncumbente: null,
    tempoPrimeiroIncumbenteMs: null,
    provas: [],
    decisoes: [],
    encerradoPorPrazo: false,
    codigoSaida: null,
    sinal: null,
    erroInicializacao: null,
    stderr: '',
    linhasInvalidas: 0,
    duracaoMs: 0,
  };

  return new Promise((resolve) => {
    const args = [
      `--stack-limit=${opcoes.limitePilha ?? '2g'}`,
      opcoes.caminhoMotor ?? CAMINHO_MOTOR_PADRAO,
      '--orcamento-ms',
      String(Math.max(1, Math.floor(opcoes.limiteMs))),
    ];
    if (opcoes.rastreio) args.push('--rastreio', String(opcoes.rastreio));

    let filho: ReturnType<typeof spawn>;
    try {
      filho = spawn(opcoes.caminhoSwipl ?? caminhoSwipl(), args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      bruta.erroInicializacao = e instanceof Error ? e.message : String(e);
      bruta.duracaoMs = performance.now() - inicio;
      resolve(bruta);
      return;
    }

    let encerrado = false;
    const prazo = setTimeout(() => {
      if (!encerrado) {
        bruta.encerradoPorPrazo = true;
        filho.kill('SIGKILL');
      }
    }, Math.max(1, opcoes.limiteMs));

    let pendente = '';
    const tratarLinha = (linha: string) => {
      if (linha.trim() === '') return;
      let evento: any;
      try {
        evento = JSON.parse(linha);
      } catch {
        bruta.linhasInvalidas++;
        return;
      }
      if (evento.tipo === 'incumbente') {
        bruta.ultimoIncumbente = evento;
        if (bruta.tempoPrimeiroIncumbenteMs === null) bruta.tempoPrimeiroIncumbenteMs = evento.tempo_ms ?? null;
      } else if (evento.tipo === 'prova') bruta.provas.push(evento);
      else if (evento.tipo === 'decisao') bruta.decisoes.push(evento);
      else if (evento.tipo === 'resultado') bruta.resultado = evento;
      opcoes.aoEvento?.(evento);
    };

    filho.stdout!.setEncoding('utf8');
    filho.stdout!.on('data', (parte: string) => {
      pendente += parte;
      let i: number;
      while ((i = pendente.indexOf('\n')) >= 0) {
        tratarLinha(pendente.slice(0, i));
        pendente = pendente.slice(i + 1);
      }
    });
    filho.stderr!.setEncoding('utf8');
    filho.stderr!.on('data', (parte: string) => {
      if (bruta.stderr.length < MAX_STDERR) bruta.stderr = (bruta.stderr + parte).slice(0, MAX_STDERR);
    });

    filho.on('error', (e) => {
      bruta.erroInicializacao = e.message;
    });
    filho.on('close', (codigo, sinal) => {
      encerrado = true;
      clearTimeout(prazo);
      if (pendente !== '') tratarLinha(pendente);
      bruta.codigoSaida = codigo;
      bruta.sinal = sinal;
      bruta.duracaoMs = performance.now() - inicio;
      resolve(bruta);
    });

    filho.stdin!.on('error', () => {
      // EPIPE: o motor encerrou antes de ler toda a entrada; tratado no 'close'
    });
    filho.stdin!.end(JSON.stringify(snapshot), 'utf8');
  });
}
