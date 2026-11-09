// Benchmark do motor (CA-63, CA-170, CA-217, ET-15). Instâncias sintéticas
// em memória, com solução plantada; nada é gravado em banco.
//
//   npx ts-node -P tests/tsconfig.json scripts/benchmark.ts [cenario...] [--limite S] [--saida arq.json]
//
// Cenários: pequeno, medio, grande, adversarial, adversarial-grande

import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { executarGeracao } from '../src/motor/geracao';
import { validarGrade } from '../src/motor/validador';
import { comHash } from '../tests/apoio/fabrica';
import { instanciaAdversarial, instanciaRealista, type InstanciaGerada } from '../tests/apoio/gerador';

const CENARIOS: Record<string, (limite: number) => InstanciaGerada> = {
  pequeno: (limite) => instanciaRealista({ semente: 11, semestres: 2, turmasPorSemestre: 1, disciplinasPorSemestre: 4, blocosPorDia: 4, professores: 6, limite }),
  medio: (limite) => instanciaRealista({ semente: 22, semestres: 4, turmasPorSemestre: 1, disciplinasPorSemestre: 5, blocosPorDia: 4, professores: 12, limite }),
  grande: (limite) => instanciaRealista({ semente: 33, semestres: 8, turmasPorSemestre: 1, disciplinasPorSemestre: 5, blocosPorDia: 4, professores: 22, limite }),
  'grande-2-turmas': (limite) => instanciaRealista({ semente: 44, semestres: 6, turmasPorSemestre: 2, disciplinasPorSemestre: 5, blocosPorDia: 4, professores: 24, limite }),
  adversarial: (limite) => instanciaAdversarial(7, 12, 1, limite),
  'adversarial-grande': (limite) => instanciaAdversarial(8, 24, 2, limite),
};

async function main() {
  const args = process.argv.slice(2);
  const iLim = args.indexOf('--limite');
  const limite = iLim >= 0 ? Number(args[iLim + 1]) : 600;
  const iSaida = args.indexOf('--saida');
  const saida = iSaida >= 0 ? args[iSaida + 1] : null;
  const valoresDeOpcao = new Set([iLim, iSaida].filter((i) => i >= 0).map((i) => i + 1));
  const nomes = args.filter((a, i) => !a.startsWith('--') && !valoresDeOpcao.has(i));
  if (!Number.isInteger(limite) || limite < 1 || limite > 600) throw new Error('--limite deve ser inteiro entre 1 e 600');
  const escolhidos = nomes.length ? nomes : Object.keys(CENARIOS);
  const relatorio: Record<string, unknown>[] = [];

  for (const nome of escolhidos) {
    const gerar = CENARIOS[nome];
    if (!gerar) throw new Error(`Cenário desconhecido: ${nome}`);
    const inst = gerar(limite);
    const s = comHash({ ...inst.snapshot, limite_execucao_segundos: limite });
    const plantadaOk = validarGrade(s, inst.plantada).length === 0;
    const t0 = performance.now();
    const memoriaAntes = process.memoryUsage().rss;
    const e = await executarGeracao(s, { permitirLimiteDeTeste: limite !== 600 });
    const ms = performance.now() - t0;
    const est = (e.resultado_motor?.estatisticas ?? {}) as Record<string, unknown>;
    const linha = {
      cenario: nome,
      ...inst.descricao,
      limite_s: limite,
      solucao_plantada_valida: plantadaOk,
      status: e.status_final,
      motivo_termino: e.motivo_termino,
      grade_validada: e.grade_validada,
      tempo_total_s: +(ms / 1000).toFixed(2),
      tempo_primeira_grade_s: e.tempo_primeira_grade_ms != null ? +(e.tempo_primeira_grade_ms / 1000).toFixed(3) : null,
      custo: e.resultado?.C ?? null,
      provas: (e.resultado?.prova_por_nivel ?? []).map((p) => `${p.nivel}:${p.comprovado ? 'ok' : '-'}`).join(' '),
      nos: est.nos ?? null,
      retrocessos: est.retrocessos ?? null,
      podas_limite_inferior: est.podas_limite_inferior ?? null,
      podas_cobertura: est.podas_cobertura ?? null,
      solucoes: est.solucoes ?? null,
      rss_supervisor_mb: Math.round((process.memoryUsage().rss - memoriaAntes) / 1e6),
    };
    relatorio.push(linha);
    console.log(JSON.stringify(linha));
  }
  if (saida) writeFileSync(saida, JSON.stringify({ gerado_em: new Date().toISOString(), relatorio }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
