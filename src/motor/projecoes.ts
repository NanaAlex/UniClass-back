// Projeções por turma e por professor a partir da MESMA ocupação canônica
// (RN-34, RN-57, RN-69, ET-02, ET-11, ET-17). Cada bloco ocupado é um único
// objeto com suas K aulas consecutivas; não há entidade de aula isolada que
// possa divergir entre as visões (CA-113, CA-150, CA-155, CA-191).

import { chaveCoordenada, chavePosicao, compararIds, coordenadasDoCalendario } from './canonico';
import type { Coordenada, Ocupacao, Snapshot, Trava } from './tipos';

export interface BlocoProjetado extends Coordenada {
  // Aulas ((i−1)K+1)..(iK) do dia/turno (RN-10, CA-78)
  aulas: number[];
  ocupado: boolean;
  turma_id: string | null;
  disciplina_id: string | null;
  professor_id: string | null;
  travas: string[];
}

export function aulasDoBloco(K: number, indice: number): number[] {
  return Array.from({ length: K }, (_, i) => (indice - 1) * K + i + 1);
}

function travasPorPosicao(travas: Trava[]) {
  const turma = new Map<string, string[]>();
  const professor = new Map<string, string[]>();
  const adicionar = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id]);
  for (const t of travas) {
    if (t.tipo === 'ocupacao' || t.tipo === 'vaga_turma') adicionar(turma, chavePosicao(t.alvo.turma_id, t.alvo), t.id);
    else if (t.tipo === 'vaga_professor') adicionar(professor, `${t.alvo.professor_id}#${chaveCoordenada(t.alvo)}`, t.id);
  }
  return { turma, professor };
}

export function gradePorTurma(s: Snapshot, ocupacoes: Ocupacao[]) {
  const porPosicao = new Map(ocupacoes.map((o) => [chavePosicao(o.turma_id, o), o]));
  const travas = travasPorPosicao(s.travas);
  const coordenadas = coordenadasDoCalendario(s);

  return [...s.turmas]
    .sort((a, b) => compararIds(a.id, b.id))
    .map((t) => ({
      turma_id: t.id,
      semestre_id: t.semestre_id,
      turno: t.turno,
      posicoes: coordenadas
        .filter((c) => c.turno === t.turno)
        .map<BlocoProjetado>((c) => {
          const o = porPosicao.get(chavePosicao(t.id, c));
          return {
            dia: c.dia,
            turno: c.turno,
            indice: c.indice,
            aulas: aulasDoBloco(s.K, c.indice),
            ocupado: Boolean(o),
            turma_id: t.id,
            disciplina_id: o ? o.disciplina_id : null,
            professor_id: o ? o.professor_id : null,
            travas: travas.turma.get(chavePosicao(t.id, c)) ?? [],
          };
        }),
    }));
}

// Visão docente: todas as coordenadas ordinais existentes, ocupadas ou vagas,
// com turma_id em cada bloco ocupado (RN-69, CA-190, ET-09).
export function projecaoPorProfessor(s: Snapshot, ocupacoes: Ocupacao[]) {
  const travas = travasPorPosicao(s.travas);
  const coordenadas = coordenadasDoCalendario(s);
  const porProfCoord = new Map<string, Ocupacao>();
  for (const o of ocupacoes) porProfCoord.set(`${o.professor_id}#${chaveCoordenada(o)}`, o);

  return [...s.professores_participantes]
    .sort((a, b) => compararIds(a.id, b.id))
    .map((p) => ({
      professor_id: p.id,
      posicoes: coordenadas.map<BlocoProjetado>((c) => {
        const o = porProfCoord.get(`${p.id}#${chaveCoordenada(c)}`);
        return {
          dia: c.dia,
          turno: c.turno,
          indice: c.indice,
          aulas: aulasDoBloco(s.K, c.indice),
          ocupado: Boolean(o),
          turma_id: o ? o.turma_id : null,
          disciplina_id: o ? o.disciplina_id : null,
          professor_id: p.id,
          travas: [
            ...(travas.professor.get(`${p.id}#${chaveCoordenada(c)}`) ?? []),
            ...(o ? travas.turma.get(chavePosicao(o.turma_id, c)) ?? [] : []),
          ],
        };
      }),
    }));
}
