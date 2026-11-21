// Oráculo exaustivo independente (RN-73, CA-172, ET-19): enumera todas as
// grades candidatas de instâncias pequenas, valida cada uma com o validador
// TypeScript e escolhe o mínimo lexicográfico (C, max M_p, amplitude, chave)
// com racionais exatos. Não compartilha código com o modelo Prolog.

import { chaveCoordenada, compararGrades, coordenadasDoCalendario } from '../../src/motor/canonico';
import { TETO_AULAS_PROFESSOR } from '../../src/motor/politica';
import * as Q from '../../src/motor/racional';
import type { Coordenada, Ocupacao, Snapshot } from '../../src/motor/tipos';
import { recomputar, validarGrade, type Recomputo } from '../../src/motor/validador';

export interface RespostaOraculo {
  viavel: boolean;
  melhor: { ocupacoes: Ocupacao[]; recomputo: Recomputo } | null;
  grades_validas: number;
  folhas: number;
}

function combinacoes<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [h, ...t] = xs;
  return [...combinacoes(t, k - 1).map((c) => [h, ...c]), ...combinacoes(t, k)];
}

function compararVetor(s: Snapshot, a: { ocupacoes: Ocupacao[]; recomputo: Recomputo }, b: { ocupacoes: Ocupacao[]; recomputo: Recomputo }): number {
  if (a.recomputo.C !== b.recomputo.C) return a.recomputo.C - b.recomputo.C;
  const cmpNulo = (x: Q.Racional | null, y: Q.Racional | null) => (x && y ? Q.comparar(x, y) : 0);
  const m = cmpNulo(a.recomputo.maxM, b.recomputo.maxM);
  if (m !== 0) return m;
  const amp = cmpNulo(a.recomputo.amplitude, b.recomputo.amplitude);
  if (amp !== 0) return amp;
  return compararGrades(s, a.ocupacoes, b.ocupacoes);
}

export function resolverPorEnumeracao(s: Snapshot, maxFolhas = 3_000_000): RespostaOraculo {
  const coords = coordenadasDoCalendario(s);
  const capBlocos = Math.floor(TETO_AULAS_PROFESSOR / s.K);
  const obrigacoes = s.turmas.flatMap((t) =>
    s.disciplinas.filter((d) => d.semestre_id === t.semestre_id).map((d) => ({ turma: t, disc: d, r: d.carga_aulas / s.K })),
  );

  // Opções de cada obrigação: professor que selecionou a disciplina e
  // conjunto de r posições do turno da turma entre os blocos que selecionou
  const opcoes = obrigacoes.map((o) => {
    const lista: { professor: string; posicoes: Coordenada[] }[] = [];
    for (const p of s.professores_participantes) {
      if (!p.disciplinas_selecionadas_e_notas.some((x) => x.disciplina_id === o.disc.id)) continue;
      const sel = new Set(p.blocos_selecionados.map(chaveCoordenada));
      const livres = coords.filter((c) => c.turno === o.turma.turno && sel.has(chaveCoordenada(c)));
      for (const comb of combinacoes(livres, o.r)) lista.push({ professor: p.id, posicoes: comb });
    }
    return lista;
  });

  let melhor: RespostaOraculo['melhor'] = null;
  let validas = 0;
  let folhas = 0;
  const posTurma = new Set<string>();
  const posProf = new Set<string>();
  const blocosProf = new Map<string, number>();
  const atual: Ocupacao[] = [];

  const dfs = (i: number) => {
    if (i === obrigacoes.length) {
      folhas++;
      if (folhas > maxFolhas) throw new Error('Instância grande demais para o oráculo');
      if (validarGrade(s, atual).length > 0) return;
      validas++;
      const candidato = { ocupacoes: atual.map((o) => ({ ...o })), recomputo: recomputar(s, atual) };
      if (!melhor || compararVetor(s, candidato, melhor) < 0) melhor = candidato;
      return;
    }
    const o = obrigacoes[i];
    for (const op of opcoes[i]) {
      const kt = op.posicoes.map((c) => `${o.turma.id}#${chaveCoordenada(c)}`);
      const kp = op.posicoes.map((c) => `${op.professor}#${chaveCoordenada(c)}`);
      if (kt.some((k) => posTurma.has(k)) || kp.some((k) => posProf.has(k))) continue;
      if ((blocosProf.get(op.professor) ?? 0) + o.r > capBlocos) continue;
      kt.forEach((k) => posTurma.add(k));
      kp.forEach((k) => posProf.add(k));
      blocosProf.set(op.professor, (blocosProf.get(op.professor) ?? 0) + o.r);
      for (const c of op.posicoes) {
        atual.push({ turma_id: o.turma.id, dia: c.dia, turno: c.turno, indice: c.indice, disciplina_id: o.disc.id, professor_id: op.professor });
      }
      dfs(i + 1);
      atual.splice(atual.length - op.posicoes.length, op.posicoes.length);
      blocosProf.set(op.professor, blocosProf.get(op.professor)! - o.r);
      kt.forEach((k) => posTurma.delete(k));
      kp.forEach((k) => posProf.delete(k));
    }
  };
  dfs(0);

  return { viavel: melhor !== null, melhor, grades_validas: validas, folhas };
}
