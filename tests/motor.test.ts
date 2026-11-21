// Integração backend ↔ motor Prolog com instâncias construídas à mão.
// Cada caso fixa o valor esperado calculado manualmente (CA-44, CA-66 a
// CA-68, CA-47, CA-71, CA-168, CA-17, CA-21, CA-23, CA-37, CA-39, CA-50,
// CA-54, CA-85, CA-93 a CA-101, CA-115, CA-141 a CA-144).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chaveCanonica } from '../src/motor/canonico';
import { executarGeracao } from '../src/motor/geracao';
import type { Ocupacao, Trava } from '../src/motor/tipos';
import { validarResultado } from '../src/motor/validador';
import { comHash, embaralharSnapshot, montarSnapshot, prof, todos } from './apoio/fabrica';
import { resolver, resumoOcupacoes } from './apoio/motor';

const responsaveis = (oc: Ocupacao[]) =>
  [...new Set(oc.map((o) => `${o.turma_id}/${o.disciplina_id}=${o.professor_id}`))].sort();

describe('Hierarquia lexicográfica (RN-32, CP-04)', () => {
  it('CA-44/CA-66: menor custo primário prevalece (C=4, não 24)', async () => {
    // Cada professor precisa de uma disciplina: (P1-D1, P2-D2) custa 0+24;
    // (P1-D2, P2-D1) custa 0+4.
    const s = montarSnapshot({
      K: 2,
      blocos: [['SEGUNDA', 'NOITE', 2]],
      turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: [
        prof('P1', [['D1', 5], ['D2', 5]], todos('SEGUNDA', 'NOITE', 2)),
        prof('P2', [['D1', 4], ['D2', 2]], todos('SEGUNDA', 'NOITE', 2)),
      ],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.equal(e.resultado!.C, 4);
    assert.deepEqual(responsaveis(e.resultado!.ocupacoes), ['T1/D1=P2', 'T1/D2=P1']);
  });

  it('CA-67: empate em C=12; vence a menor pior média (3, não 6)', async () => {
    // D1 só P1, D4 só P2; P2 tem 2 blocos. (D2→P1,D3→P2): M=(6,0);
    // (D2→P2,D3→P1): M=(3,3). Ambos C=12.
    const s = montarSnapshot({
      K: 1,
      blocos: [['SEGUNDA', 'MANHA', 4]],
      turmas: [['T1', 'S1', 'MANHA']],
      disciplinas: [['D1', 'S1', 1], ['D2', 'S1', 1], ['D3', 'S1', 1], ['D4', 'S1', 1]],
      professores: [
        prof('P1', [['D1', 5], ['D2', 2], ['D3', 3]], todos('SEGUNDA', 'MANHA', 4)),
        prof('P2', [['D2', 3], ['D3', 5], ['D4', 5]], [['SEGUNDA', 'MANHA', 3], ['SEGUNDA', 'MANHA', 4]]),
      ],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.equal(e.resultado!.C, 12);
    assert.deepEqual(e.resultado!.max_M_p, { num: 3, den: 1 });
    assert.deepEqual(responsaveis(e.resultado!.ocupacoes), ['T1/D1=P1', 'T1/D2=P2', 'T1/D3=P1', 'T1/D4=P2']);
  });

  it('CA-68: empate em C e na pior média; vence a menor amplitude (14, não 20)', async () => {
    const s = montarSnapshot({
      K: 1,
      blocos: [['SEGUNDA', 'MANHA', 3]],
      turmas: [['T1', 'S1', 'MANHA']],
      disciplinas: [['D1', 'S1', 1], ['D2', 'S1', 1], ['D3', 'S1', 1]],
      professores: [
        prof('P1', [['D1', 1]], todos('SEGUNDA', 'MANHA', 3)),
        prof('P2', [['D2', 5], ['D3', 3]], todos('SEGUNDA', 'MANHA', 3)),
        prof('P3', [['D2', 3], ['D3', 2]], todos('SEGUNDA', 'MANHA', 3)),
      ],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.equal(e.resultado!.C, 32);
    assert.deepEqual(e.resultado!.max_M_p, { num: 20, den: 1 });
    assert.deepEqual(e.resultado!.amplitude_M, { num: 14, den: 1 });
    assert.deepEqual(responsaveis(e.resultado!.ocupacoes), ['T1/D1=P1', 'T1/D2=P3', 'T1/D3=P2']);
  });

  it('CA-47/CA-71: mesma grade com arrays reordenados (desempate canônico)', async () => {
    const s = montarSnapshot({
      K: 2,
      blocos: [['SEGUNDA', 'NOITE', 3], ['TERCA', 'NOITE', 3]],
      turmas: [['TB', 'S1', 'NOITE'], ['TA', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: ['P1', 'P2', 'P3'].map((p) =>
        prof(p, [['D1', 5], ['D2', 5]], [...todos('SEGUNDA', 'NOITE', 3), ...todos('TERCA', 'NOITE', 3)])),
    });
    const referencia = await resolver(s);
    assert.equal(referencia.status_final, 'OTIMA_COMPROVADA');
    for (const semente of [3, 7, 11]) {
      const e = await resolver(comHash(embaralharSnapshot(s, semente)));
      assert.equal(e.status_final, 'OTIMA_COMPROVADA');
      assert.equal(e.resultado!.chave_canonica, referencia.resultado!.chave_canonica);
      assert.deepEqual(resumoOcupacoes(e), resumoOcupacoes(referencia));
    }
  });
});

describe('Canonicidade com 10+ turmas (AUD-001, CA-168)', () => {
  it('T1..T11: chave do Prolog igual à do validador e grade aprovada', async () => {
    const turmas = Array.from({ length: 11 }, (_, i) => [`T${i + 1}`, 'S1', 'NOITE'] as [string, string, 'NOITE']);
    const s = montarSnapshot({
      K: 2,
      blocos: [['SEGUNDA', 'NOITE', 4]],
      turmas,
      disciplinas: [['D1', 'S1', 2]],
      professores: ['P1', 'P2', 'P3'].map((p) => prof(p, [['D1', 5]], todos('SEGUNDA', 'NOITE', 4))),
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'OTIMA_COMPROVADA', JSON.stringify(e.diagnosticos));
    assert.equal(e.grade_validada, true);
    assert.equal(e.resultado!.chave_canonica, chaveCanonica(comHash({ ...s, limite_execucao_segundos: 60 }), e.resultado!.ocupacoes));
  });
});

describe('Inviabilidade comprovada e preferências baixas', () => {
  it('CA-50: disciplina sem docente que a selecionou', async () => {
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: [prof('P1', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2))],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'INVIAVEL_COMPROVADA');
    const d = e.diagnosticos.find((x) => x.codigo === 'DISCIPLINA_SEM_DOCENTE_ELEGIVEL');
    assert.deepEqual(d?.entidades, { turma_id: 'T1', disciplina_id: 'D2' });
    assert.equal(e.resultado!.ocupacoes.length, 0);
  });

  it('CA-17: capacidade semanal insuficiente (8 aulas, 3 blocos de K=2)', async () => {
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 3]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 4], ['D2', 'S1', 4]],
      professores: [prof('P1', [['D1', 5], ['D2', 5]], todos('SEGUNDA', 'NOITE', 3))],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'INVIAVEL_COMPROVADA');
    assert.ok(e.diagnosticos.some((x) => x.codigo === 'CAPACIDADE_TURMA_INSUFICIENTE'));
  });

  it('CA-23: turma noturna e docente só com blocos da manhã', async () => {
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2], ['SEGUNDA', 'MANHA', 2]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2]],
      professores: [prof('P1', [['D1', 5]], todos('SEGUNDA', 'MANHA', 2))],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'INVIAVEL_COMPROVADA');
    assert.ok(e.diagnosticos.some((x) => x.codigo === 'DISPONIBILIDADE_INSUFICIENTE'));
  });

  it('CA-85/RN-20: mais participantes do que obrigações', async () => {
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2]],
      professores: ['P1', 'P2'].map((p) => prof(p, [['D1', 5]], todos('SEGUNDA', 'NOITE', 2))),
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'INVIAVEL_COMPROVADA');
    assert.ok(e.diagnosticos.some((x) => x.codigo === 'COBERTURA_DOCENTE_IMPOSSIVEL'));
  });

  it('CA-54: inviabilidade só descoberta pela busca completa', async () => {
    // Duas turmas exigem P1 na única coordenada que ele selecionou.
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE'], ['T2', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2]],
      professores: [prof('P1', [['D1', 5]], [['SEGUNDA', 'NOITE', 1]])],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'INVIAVEL_COMPROVADA');
    assert.equal(e.motivo_termino, 'INVIABILIDADE_COMPROVADA');
  });

  it('CA-21/CA-39: nota 1 continua elegível quando é a única alternativa', async () => {
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2]],
      professores: [prof('P1', [['D1', 1]], todos('SEGUNDA', 'NOITE', 2), 1)],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.equal(e.resultado!.C, 2 * (3 * 10 + 2 * 10));
  });
});

describe('Travas como restrições rígidas (RN-41 a RN-45, RN-54, RN-55)', () => {
  const instancia = (travas: Trava[]) =>
    montarSnapshot({
      K: 2,
      blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'NOITE', 2]],
      turmas: [['TA', 'S1', 'NOITE'], ['TB', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: [
        prof('P1', [['D1', 5], ['D2', 4]], [...todos('SEGUNDA', 'NOITE', 2), ...todos('TERCA', 'NOITE', 2)], 5),
        prof('P2', [['D1', 3], ['D2', 5]], [...todos('SEGUNDA', 'NOITE', 2), ...todos('TERCA', 'NOITE', 2)], 4),
      ],
      travas,
    });

  it('CA-96: bloco ocupado travado é preservado mesmo mais caro', async () => {
    const t: Trava = { id: 'oc1', tipo: 'ocupacao', origem_versao: 'base', alvo: { turma_id: 'TA', dia: 'TERCA', turno: 'NOITE', indice: 2 }, valor_fixo: { disciplina_id: 'D1', professor_id: 'P2' } };
    const e = await resolver(instancia([t]));
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.ok(resumoOcupacoes(e).includes('TA:TERCA:NOITE:2=D1/P2'));
    assert.deepEqual(e.resultado!.travas_aplicadas, ['oc1']);
  });

  it('CA-97/CA-141/CA-143: vaga travada na turma A fica vazia; turma B pode usar a coordenada', async () => {
    const vaga: Trava = { id: 'v1', tipo: 'vaga_turma', origem_versao: 'base', alvo: { turma_id: 'TA', dia: 'SEGUNDA', turno: 'NOITE', indice: 1 }, valor_fixo: null };
    const e = await resolver(instancia([vaga]));
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.ok(!resumoOcupacoes(e).some((x) => x.startsWith('TA:SEGUNDA:NOITE:1=')));
  });

  it('CA-142/CA-144: vaga travada do professor não impede outro professor', async () => {
    const t: Trava = { id: 'vp', tipo: 'vaga_professor', origem_versao: 'base', alvo: { professor_id: 'P1', dia: 'SEGUNDA', turno: 'NOITE', indice: 1 }, valor_fixo: null };
    const e = await resolver(instancia([t]));
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.ok(!resumoOcupacoes(e).some((x) => x.includes(':SEGUNDA:NOITE:1=') && x.endsWith('/P1')));
  });

  it('CA-99/CA-100: fixação disciplina–professor vale para todas as turmas do semestre', async () => {
    const t: Trava = { id: 'fx', tipo: 'fixacao_disciplina_professor', origem_versao: 'base', alvo: { semestre_id: 'S1', disciplina_id: 'D1' }, valor_fixo: { professor_id: 'P2' } };
    const e = await resolver(instancia([t]));
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    const r = responsaveis(e.resultado!.ocupacoes);
    assert.ok(r.includes('TA/D1=P2') && r.includes('TB/D1=P2'));
  });

  it('CA-93/CA-95/CA-148: bloqueio integral de todas as turmas reproduz a grade-base', async () => {
    const base = await resolver(instancia([]));
    const s = instancia([]);
    const travas: Trava[] = [];
    for (const t of s.turmas) {
      for (const dia of ['SEGUNDA', 'TERCA'] as const) {
        for (const indice of [1, 2]) {
          const o = base.resultado!.ocupacoes.find((x) => x.turma_id === t.id && x.dia === dia && x.indice === indice);
          travas.push(o
            ? { id: `oc-${t.id}-${dia}-${indice}`, tipo: 'ocupacao', origem_versao: 'base', alvo: { turma_id: t.id, dia, turno: 'NOITE', indice }, valor_fixo: { disciplina_id: o.disciplina_id, professor_id: o.professor_id } }
            : { id: `vg-${t.id}-${dia}-${indice}`, tipo: 'vaga_turma', origem_versao: 'base', alvo: { turma_id: t.id, dia, turno: 'NOITE', indice }, valor_fixo: null });
        }
      }
    }
    const e = await resolver(instancia(travas));
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.deepEqual(resumoOcupacoes(e), resumoOcupacoes(base));
  });

  it('CA-102: fixação para professor sem blocos suficientes → inviabilidade identificada', async () => {
    const s = montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 3]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 6]],
      professores: [prof('P1', [['D1', 5]], todos('SEGUNDA', 'NOITE', 3)), prof('P2', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2))],
      travas: [{ id: 'fx', tipo: 'fixacao_disciplina_professor', origem_versao: 'base', alvo: { semestre_id: 'S1', disciplina_id: 'D1' }, valor_fixo: { professor_id: 'P2' } }],
    });
    const e = await resolver(s);
    assert.equal(e.status_final, 'INVIAVEL_COMPROVADA');
    const d = e.diagnosticos.find((x) => x.codigo === 'FIXACAO_SEM_CAPACIDADE');
    assert.equal(d?.entidades.professor_id, 'P2');
  });
});

describe('Heurística de escassez registrada (CA-37, CA-115, CA-116)', () => {
  it('a primeira decisão é a obrigação de menor E(o), não a primeira por ID', async () => {
    // K=1, 6 posições. E(D0)=C(1,1)+C(6,1)=7; E(D3)=7; E(D2)=6+2+2=10;
    // E(D1)=C(2,2)+C(2,2)=2 com 2 candidatos: P1 selecionou D1 mas só tem
    // 1 bloco compatível e não conta para a demanda de 2 blocos (CA-115).
    const s = montarSnapshot({
      K: 1, blocos: [['SEGUNDA', 'MANHA', 6]], turmas: [['T1', 'S1', 'MANHA']],
      disciplinas: [['D0', 'S1', 1], ['D1', 'S1', 2], ['D2', 'S1', 1], ['D3', 'S1', 1]],
      professores: [
        prof('P1', [['D0', 5], ['D1', 5], ['D3', 5]], [['SEGUNDA', 'MANHA', 1]]),
        prof('P2', [['D0', 5], ['D2', 5], ['D3', 5]], todos('SEGUNDA', 'MANHA', 6)),
        prof('P3', [['D1', 5], ['D2', 5]], [['SEGUNDA', 'MANHA', 3], ['SEGUNDA', 'MANHA', 4]]),
        prof('P4', [['D1', 5], ['D2', 5]], [['SEGUNDA', 'MANHA', 5], ['SEGUNDA', 'MANHA', 6]]),
      ],
    });
    const decisoes: Record<string, unknown>[] = [];
    const e = await executarGeracao(comHash({ ...s, limite_execucao_segundos: 30 }), {
      permitirLimiteDeTeste: true, rastreio: 5, aoEvento: (ev) => { if (ev.tipo === 'decisao') decisoes.push(ev); },
    });
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    assert.ok(decisoes.length > 0);
    assert.equal(decisoes[0].disciplina_id, 'D1');
    assert.equal(decisoes[0].escassez, 2);
    assert.equal(decisoes[0].candidatos, 2);
  });
});

describe('Validação independente sobre o resultado real', () => {
  it('toda grade emitida passa no validador com o mesmo snapshot', async () => {
    const s = comHash({ ...montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: [prof('P1', [['D1', 5], ['D2', 3]], todos('SEGUNDA', 'NOITE', 2)), prof('P2', [['D2', 4]], todos('TERCA', 'NOITE', 2))],
    }), limite_execucao_segundos: 30 });
    const e = await executarGeracao(s, { permitirLimiteDeTeste: true });
    assert.equal(validarResultado(s, e.resultado!).aprovada, true);
  });
});
