// Geradores de instâncias com solução plantada (viabilidade garantida) para
// benchmark e regressão (CA-63, CA-170, CA-217). A solução plantada é uma
// grade completa válida verificada pelo validador independente.

import { validarSnapshot } from '../../src/motor/contrato';
import type { Dia, Ocupacao, Snapshot, Trava, Turno } from '../../src/motor/tipos';
import { montarSnapshot, prng, type BlocoCurto, type ProfessorCurto } from './fabrica';

// Instâncias pequenas e aleatórias (semente fixa) para o oráculo exaustivo
// (CA-172): K variado, IDs de vários dígitos (T1/T2/T10), travas, empates.
export function instanciaPequenaAleatoria(semente: number): Snapshot {
  const r = prng(semente);
  for (;;) {
    const K = r.escolher([1, 2, 3]);
    const turnos: Turno[] = r.real() < 0.6 ? ['MANHA'] : ['MANHA', 'NOITE'];
    const dias: Dia[] = r.real() < 0.5 ? ['SEGUNDA'] : ['SEGUNDA', 'TERCA'];
    const blocos = dias.flatMap((d) => turnos.map((t) => [d, t, r.inteiro(1, 2)] as [Dia, Turno, number]));
    const coords = blocos.flatMap(([d, t, q]) => Array.from({ length: q }, (_, i) => [d, t, i + 1] as BlocoCurto));
    const nSem = r.inteiro(1, 2);
    const idsTurma = r.embaralhar(['T1', 'T2', 'T10']).slice(0, r.inteiro(1, 3));
    const turmas = idsTurma.map((id) => [id, `S${r.inteiro(1, nSem)}`, r.escolher(turnos)] as [string, string, Turno]);
    const disciplinas: [string, string, number][] = [];
    for (let s = 1; s <= nSem; s++) {
      for (let j = 1; j <= r.inteiro(1, 2); j++) disciplinas.push([`D${s}${j}`, `S${s}`, K * r.inteiro(1, 2)]);
    }
    const obrigacoes = turmas.flatMap(([t, s, tu]) =>
      disciplinas.filter(([, ds]) => ds === s).map(([d, , carga]) => ({ t, tu, d, r: carga / K })));
    if (obrigacoes.length === 0 || obrigacoes.length > 4) continue;

    const nProf = r.inteiro(1, Math.min(3, obrigacoes.length));
    const ids = ['P1', 'P2', 'P10'].slice(0, nProf);
    const selD = new Map(ids.map((p) => [p, new Set<string>()]));
    const selB = new Map(ids.map((p) => [p, new Set<string>()]));

    // Em ~3/4 das instâncias planta uma grade válida (garante viabilidade);
    // nas demais as seleções são livres (exercita a inviabilidade).
    if (r.real() < 0.75) {
      const usadoTurma = new Set<string>();
      const usadoProf = new Set<string>();
      let plantou = true;
      obrigacoes.forEach((o, i) => {
        const p = i < ids.length ? ids[i] : r.escolher(ids);
        const livres = r.embaralhar(coords.filter((c) => c[1] === o.tu && !usadoTurma.has(`${o.t}|${c}`) && !usadoProf.has(`${p}|${c}`)));
        if (livres.length < o.r) { plantou = false; return; }
        for (const c of livres.slice(0, o.r)) {
          usadoTurma.add(`${o.t}|${c}`);
          usadoProf.add(`${p}|${c}`);
          selB.get(p)!.add(`${c}`);
        }
        selD.get(p)!.add(o.d);
      });
      if (!plantou) continue;
    }
    for (const p of ids) {
      for (const [d] of disciplinas) if (r.real() < 0.4) selD.get(p)!.add(d);
      for (const c of coords) if (r.real() < 0.4) selB.get(p)!.add(`${c}`);
    }
    const professores: ProfessorCurto[] = ids.map((id) => {
      const bs = coords.filter((c) => selB.get(id)!.has(`${c}`));
      const dts = [...new Set(bs.map((b) => `${b[0]}|${b[1]}`))];
      return {
        id,
        disciplinas: [...selD.get(id)!].map((d) => [d, r.inteiro(1, 5)] as [string, number]),
        blocos: bs,
        notas: dts.map((k) => [...k.split('|'), r.inteiro(1, 5)] as [Dia, Turno, number]),
      };
    });

    const travas: Trava[] = [];
    if (r.real() < 0.3) {
      const [t, , tu] = r.escolher(turmas);
      const c = r.escolher(coords.filter((x) => x[1] === tu));
      travas.push({ id: 'vt', tipo: 'vaga_turma', origem_versao: 'base', alvo: { turma_id: t, dia: c[0], turno: c[1], indice: c[2] }, valor_fixo: null });
    }
    if (r.real() < 0.25 && professores.length) {
      const p = r.escolher(professores);
      const c = r.escolher(coords);
      travas.push({ id: 'vp', tipo: 'vaga_professor', origem_versao: 'base', alvo: { professor_id: p.id, dia: c[0], turno: c[1], indice: c[2] }, valor_fixo: null });
    }
    if (r.real() < 0.25) {
      const [d, s] = r.escolher(disciplinas);
      const ps = professores.filter((p) => p.disciplinas.some(([x]) => x === d));
      if (ps.length) travas.push({ id: 'fx', tipo: 'fixacao_disciplina_professor', origem_versao: 'base', alvo: { semestre_id: s, disciplina_id: d }, valor_fixo: { professor_id: r.escolher(ps).id } });
    }
    if (r.real() < 0.25) {
      const [t, s, tu] = r.escolher(turmas);
      const ds = disciplinas.filter(([, x]) => x === s);
      const d = ds.length ? r.escolher(ds)[0] : null;
      const ps = professores.filter((p) => d && p.disciplinas.some(([x]) => x === d));
      if (d && ps.length) {
        const p = r.escolher(ps);
        const cs = p.blocos.filter((b) => b[1] === tu);
        if (cs.length) {
          const c = r.escolher(cs);
          travas.push({ id: 'oc', tipo: 'ocupacao', origem_versao: 'base', alvo: { turma_id: t, dia: c[0], turno: c[1], indice: c[2] }, valor_fixo: { disciplina_id: d, professor_id: p.id } });
        }
      }
    }

    const snap = montarSnapshot({ K, blocos, turmas, disciplinas, professores, travas, limite: 30, runId: `rnd-${semente}` });
    if (validarSnapshot(snap, { permitirLimiteDeTeste: true }).valido) return snap;
    const semTravas = montarSnapshot({ K, blocos, turmas, disciplinas, professores, limite: 30, runId: `rnd-${semente}` });
    if (validarSnapshot(semTravas, { permitirLimiteDeTeste: true }).valido) return semTravas;
  }
}

const DIAS: Dia[] = ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA'];

export interface InstanciaGerada {
  snapshot: Snapshot;
  plantada: Ocupacao[];
  descricao: Record<string, number | string>;
}

export interface ParametrosRealista {
  semente: number;
  semestres: number;
  turmasPorSemestre: number;
  disciplinasPorSemestre: number;
  blocosPorDia: number;
  professores: number;
  K?: number;
  cargaBlocos?: number;
  extraDisciplinas?: number; // disciplinas adicionais selecionadas por professor
  probBlocoExtra?: number; // probabilidade de selecionar blocos além dos plantados
  limite?: number;
}

// Curso de um turno (NOITE) com turmas por semestre e solução plantada.
export function instanciaRealista(p: ParametrosRealista): InstanciaGerada {
  const r = prng(p.semente);
  const K = p.K ?? 2;
  const cargaBlocos = p.cargaBlocos ?? 2;
  const turno: Turno = 'NOITE';
  const coords = DIAS.flatMap((d) => Array.from({ length: p.blocosPorDia }, (_, i) => [d, turno, i + 1] as BlocoCurto));

  const turmas: [string, string, Turno][] = [];
  const disciplinas: [string, string, number][] = [];
  for (let s = 1; s <= p.semestres; s++) {
    for (let t = 1; t <= p.turmasPorSemestre; t++) turmas.push([`S${s}T${t}`, `S${s}`, turno]);
    for (let d = 1; d <= p.disciplinasPorSemestre; d++) disciplinas.push([`S${s}D${d}`, `S${s}`, cargaBlocos * K]);
  }

  const profs = Array.from({ length: p.professores }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
  const ocupadoProf = new Map<string, Set<string>>(profs.map((x) => [x, new Set()]));
  const carga = new Map<string, number>(profs.map((x) => [x, 0]));
  const plantada: Ocupacao[] = [];
  const selDisc = new Map<string, Set<string>>(profs.map((x) => [x, new Set()]));
  const selBloco = new Map<string, Set<string>>(profs.map((x) => [x, new Set()]));

  const obrigacoes = turmas.flatMap(([t, s]) => disciplinas.filter(([, ds]) => ds === s).map(([d]) => ({ t, d })));
  // Garante o mínimo docente: as primeiras obrigações vão para professores distintos
  const ordemProfs = r.embaralhar(profs);
  obrigacoes.forEach((o, idx) => {
    const livresTurma = coords.filter((c) => !plantada.some((x) => x.turma_id === o.t && x.dia === c[0] && x.indice === c[2]));
    const candidatos = idx < ordemProfs.length ? [ordemProfs[idx]] : r.embaralhar(profs);
    for (const pr of candidatos) {
      if ((carga.get(pr)! + cargaBlocos * K) > 40) continue;
      const livres = r.embaralhar(livresTurma.filter((c) => !ocupadoProf.get(pr)!.has(`${c[0]}|${c[2]}`)));
      if (livres.length < cargaBlocos) continue;
      for (const c of livres.slice(0, cargaBlocos)) {
        plantada.push({ turma_id: o.t, dia: c[0], turno, indice: c[2], disciplina_id: o.d, professor_id: pr });
        ocupadoProf.get(pr)!.add(`${c[0]}|${c[2]}`);
        selBloco.get(pr)!.add(`${c[0]}|${c[2]}`);
      }
      carga.set(pr, carga.get(pr)! + cargaBlocos * K);
      selDisc.get(pr)!.add(o.d);
      return;
    }
    throw new Error('Não foi possível plantar a solução; ajuste os parâmetros');
  });

  const professores: ProfessorCurto[] = profs.map((pr) => {
    const extras = r.embaralhar(disciplinas.map(([d]) => d)).slice(0, p.extraDisciplinas ?? 2);
    for (const d of extras) selDisc.get(pr)!.add(d);
    for (const c of coords) if (r.real() < (p.probBlocoExtra ?? 0.3)) selBloco.get(pr)!.add(`${c[0]}|${c[2]}`);
    const blocos = coords.filter((c) => selBloco.get(pr)!.has(`${c[0]}|${c[2]}`));
    const dias = [...new Set(blocos.map((b) => b[0]))];
    return {
      id: pr,
      disciplinas: [...selDisc.get(pr)!].sort().map((d) => [d, r.inteiro(1, 5)] as [string, number]),
      blocos,
      notas: dias.map((d) => [d, turno, r.inteiro(1, 5)] as [Dia, Turno, number]),
    };
  });

  const snapshot = montarSnapshot({
    K,
    blocos: DIAS.map((d) => [d, turno, p.blocosPorDia] as [Dia, Turno, number]),
    turmas,
    disciplinas,
    professores,
    limite: p.limite,
    runId: `bench-${p.semente}`,
  });
  return {
    snapshot,
    plantada,
    descricao: {
      turmas: turmas.length,
      professores: profs.length,
      obrigacoes: obrigacoes.length,
      blocos_por_turma: coords.length,
      total_blocos_exigidos: obrigacoes.length * cargaBlocos,
      K,
    },
  };
}

// Cenário adversarial do mínimo docente (AUD-004, CA-170, CA-171, CA-217):
// número de obrigações próximo ao de professores; um professor "popular"
// tem notas máximas em quase tudo, e cada um dos demais só pode cobrir
// poucas obrigações. Escolhas gulosas por custo esgotam a cobertura.
export function instanciaAdversarial(semente: number, professores = 12, folga = 1, limite?: number): InstanciaGerada {
  const r = prng(semente);
  const K = 2;
  const turno: Turno = 'NOITE';
  const coords = DIAS.flatMap((d) => [1, 2, 3].map((i) => [d, turno, i] as BlocoCurto));
  const nObrig = professores + folga;
  const turmas: [string, string, Turno][] = [];
  const disciplinas: [string, string, number][] = [];
  const obrig: { t: string; d: string }[] = [];
  // Uma disciplina de 1 bloco por turma, turmas em semestres distintos
  for (let k = 1; k <= nObrig; k++) {
    turmas.push([`T${k}`, `S${k}`, turno]);
    disciplinas.push([`D${k}`, `S${k}`, K]);
    obrig.push({ t: `T${k}`, d: `D${k}` });
  }
  const profs = Array.from({ length: professores }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
  const popular = profs[0];
  const plantada: Ocupacao[] = [];
  const sel = new Map<string, { d: Map<string, number>; b: Set<string> }>(profs.map((p) => [p, { d: new Map(), b: new Set() }]));
  const ocupado = new Map<string, Set<string>>(profs.map((p) => [p, new Set()]));

  // Solução plantada: P_k cobre D_k (k = 1..n), o popular cobre as sobras
  obrig.forEach((o, idx) => {
    const pr = idx < professores ? profs[idx] : popular;
    const c = r.escolher(coords.filter((x) => !ocupado.get(pr)!.has(`${x[0]}|${x[2]}`)));
    ocupado.get(pr)!.add(`${c[0]}|${c[2]}`);
    plantada.push({ turma_id: o.t, dia: c[0], turno, indice: c[2], disciplina_id: o.d, professor_id: pr });
    sel.get(pr)!.d.set(o.d, pr === popular ? 5 : r.inteiro(1, 2));
    sel.get(pr)!.b.add(`${c[0]}|${c[2]}`);
  });
  // Iscas: o popular seleciona tudo com nota 5 e muitos blocos; cada um dos
  // demais seleciona mais uma disciplina já disputada, com nota baixa
  for (const o of obrig) sel.get(popular)!.d.set(o.d, 5);
  for (const c of coords) if (r.real() < 0.8) sel.get(popular)!.b.add(`${c[0]}|${c[2]}`);
  for (const pr of profs.slice(1)) {
    const outra = r.escolher(obrig);
    if (!sel.get(pr)!.d.has(outra.d)) sel.get(pr)!.d.set(outra.d, 1);
    for (const c of coords) if (r.real() < 0.25) sel.get(pr)!.b.add(`${c[0]}|${c[2]}`);
  }

  const professoresCurto: ProfessorCurto[] = profs.map((pr) => {
    const blocos = coords.filter((c) => sel.get(pr)!.b.has(`${c[0]}|${c[2]}`));
    const dias = [...new Set(blocos.map((b) => b[0]))];
    return {
      id: pr,
      disciplinas: [...sel.get(pr)!.d.entries()],
      blocos,
      notas: dias.map((d) => [d, turno, pr === popular ? 5 : r.inteiro(1, 3)] as [Dia, Turno, number]),
    };
  });

  return {
    snapshot: montarSnapshot({
      K,
      blocos: DIAS.map((d) => [d, turno, 3] as [Dia, Turno, number]),
      turmas,
      disciplinas,
      professores: professoresCurto,
      limite,
      runId: `adv-${semente}`,
    }),
    plantada,
    descricao: { turmas: turmas.length, professores, obrigacoes: nObrig, blocos_por_turma: coords.length, K },
  };
}
