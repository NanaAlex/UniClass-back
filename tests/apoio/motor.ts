import { executarGeracao, type ExecucaoFinal, type OpcoesGeracao } from '../../src/motor/geracao';
import type { Snapshot } from '../../src/motor/tipos';
import { comHash } from './fabrica';

// Executa o motor real com prazo de teste (a API usa sempre 600 s)
export async function resolver(s: Snapshot, limite = 60, opcoes: OpcoesGeracao = {}): Promise<ExecucaoFinal> {
  const snap = comHash({ ...s, limite_execucao_segundos: limite });
  return executarGeracao(snap, { permitirLimiteDeTeste: true, ...opcoes });
}

export function resumoOcupacoes(e: ExecucaoFinal): string[] {
  return (e.resultado?.ocupacoes ?? []).map((o) => `${o.turma_id}:${o.dia}:${o.turno}:${o.indice}=${o.disciplina_id}/${o.professor_id}`);
}
