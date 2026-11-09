// Fábrica de snapshots para testes e benchmark (dados sintéticos em memória;
// nada é gravado em banco — RN-63, RN-71).

import { hashSnapshot } from '../../src/motor/hash';
import { LIMITE_EXECUCAO_SEGUNDOS, politicaDoSnapshot, SCHEMA_SNAPSHOT } from '../../src/motor/politica';
import type { Coordenada, Dia, Snapshot, Trava, Turno } from '../../src/motor/tipos';

export type BlocoCurto = [Dia, Turno, number];

export interface ProfessorCurto {
  id: string;
  disciplinas: [string, number][];
  blocos: BlocoCurto[];
  notas: [Dia, Turno, number][];
}

export interface InstanciaCurta {
  K: number;
  blocos: [Dia, Turno, number][]; // dia, turno, quantidade
  turmas: [string, string, Turno][]; // id, semestre, turno
  disciplinas: [string, string, number][]; // id, semestre, carga
  professores: ProfessorCurto[];
  travas?: Trava[];
  limite?: number;
  runId?: string;
  curso?: string;
  periodo?: string;
}

export function coord(dia: Dia, turno: Turno, indice: number): Coordenada {
  return { dia, turno, indice };
}

// Professor com nota de dia/turno uniforme para todos os dias/turnos dos blocos
export function prof(id: string, disciplinas: [string, number][], blocos: BlocoCurto[], notaDiaTurno = 5): ProfessorCurto {
  const dts = new Map<string, [Dia, Turno, number]>();
  for (const [d, t] of blocos) dts.set(`${d}|${t}`, [d, t, notaDiaTurno]);
  return { id, disciplinas, blocos, notas: [...dts.values()] };
}

export function montarSnapshot(i: InstanciaCurta): Snapshot {
  const dias = [...new Set(i.blocos.map((b) => b[0]))];
  const turnos = [...new Set(i.blocos.map((b) => b[1]))];
  const s: Snapshot = {
    schema_version: SCHEMA_SNAPSHOT,
    run_id: i.runId ?? 'run-teste',
    curso_id: i.curso ?? 'ES',
    periodo_letivo_id: i.periodo ?? '2027/1',
    form_version: '1',
    snapshot_hash: '',
    K: i.K,
    turnos,
    dias_letivos: dias,
    blocos_por_dia_turno: i.blocos.map(([dia, turno, quantidade]) => ({ dia, turno, quantidade })),
    turmas: i.turmas.map(([id, semestre_id, turno]) => ({ id, semestre_id, turno })),
    disciplinas: i.disciplinas.map(([id, semestre_id, carga_aulas]) => ({ id, semestre_id, carga_aulas })),
    professores_participantes: i.professores.map((p) => ({
      id: p.id,
      disciplinas_selecionadas_e_notas: p.disciplinas.map(([disciplina_id, nota]) => ({ disciplina_id, nota })),
      blocos_selecionados: p.blocos.map(([dia, turno, indice]) => ({ dia, turno, indice })),
      notas_dia_turno: p.notas.map(([dia, turno, nota]) => ({ dia, turno, nota })),
    })),
    travas: i.travas ?? [],
    politica: politicaDoSnapshot(),
    limite_execucao_segundos: i.limite ?? LIMITE_EXECUCAO_SEGUNDOS,
  };
  return comHash(s);
}

export function comHash(s: Snapshot): Snapshot {
  return { ...s, snapshot_hash: hashSnapshot(s) };
}

// Todos os blocos de um dia/turno para seleção de disponibilidade
export function todos(dia: Dia, turno: Turno, quantidade: number): BlocoCurto[] {
  return Array.from({ length: quantidade }, (_, k) => [dia, turno, k + 1] as BlocoCurto);
}

// PRNG determinístico (mulberry32) para instâncias reprodutíveis
export function prng(semente: number) {
  let a = semente >>> 0;
  const proximo = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    real: proximo,
    inteiro: (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1)),
    escolher: <T>(xs: T[]): T => xs[Math.floor(proximo() * xs.length)],
    embaralhar: <T>(xs: T[]): T[] => {
      const c = [...xs];
      for (let k = c.length - 1; k > 0; k--) {
        const j = Math.floor(proximo() * (k + 1));
        [c[k], c[j]] = [c[j], c[k]];
      }
      return c;
    },
  };
}

// Reordena todos os arrays do snapshot (CA-47, CA-71, CA-169)
export function embaralharSnapshot(s: Snapshot, semente: number): Snapshot {
  const r = prng(semente);
  return {
    ...s,
    turnos: r.embaralhar(s.turnos),
    dias_letivos: r.embaralhar(s.dias_letivos),
    blocos_por_dia_turno: r.embaralhar(s.blocos_por_dia_turno),
    turmas: r.embaralhar(s.turmas),
    disciplinas: r.embaralhar(s.disciplinas),
    professores_participantes: r.embaralhar(s.professores_participantes).map((p) => ({
      ...p,
      disciplinas_selecionadas_e_notas: r.embaralhar(p.disciplinas_selecionadas_e_notas),
      blocos_selecionados: r.embaralhar(p.blocos_selecionados),
      notas_dia_turno: r.embaralhar(p.notas_dia_turno),
    })),
    travas: r.embaralhar(s.travas),
  };
}
