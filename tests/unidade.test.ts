// Testes unitários: política homologada, racionais exatos, comparador e
// chave canônica, hash do snapshot (CP-02, CP-03, CA-41, CA-42, CA-70,
// CA-114, CA-168, CA-169, RN-61, ET-13).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chaveCanonica, compararGrades, compararIds, entradasCanonicas, hexUtf8 } from '../src/motor/canonico';
import { hashSnapshot } from '../src/motor/hash';
import { custoBloco, parcelasBloco, phi, politicaDoSnapshot } from '../src/motor/politica';
import * as Q from '../src/motor/racional';
import type { Ocupacao } from '../src/motor/tipos';
import { embaralharSnapshot, montarSnapshot, prof, todos } from './apoio/fabrica';

describe('Política homologada (CP-02, CP-03)', () => {
  it('CA-41: φ(5..1) = 0, 1, 3, 6, 10', () => {
    assert.deepEqual([5, 4, 3, 2, 1].map(phi), [0, 1, 3, 6, 10]);
  });

  it('CA-42/CA-114: K=2, dia/turno 2, disciplina 5 → 2×(3×6+2×0) = 36', () => {
    assert.equal(custoBloco(2, 2, 5), 36);
    assert.deepEqual(parcelasBloco(2, 2, 5), { diaTurno: 36, disciplina: 0, total: 36 });
  });

  it('CA-43: custo multiplicado por K; pesos 3:2', () => {
    assert.equal(custoBloco(3, 1, 1), 3 * (3 * 10 + 2 * 10));
    assert.equal(custoBloco(1, 5, 1), 20);
  });

  it('nota fora da escala é rejeitada', () => {
    assert.throws(() => phi(0));
    assert.throws(() => phi(6));
  });

  it('política do snapshot não tem campo configurável além dos homologados (CA-48, CA-72)', () => {
    assert.deepEqual(Object.keys(politicaDoSnapshot()).sort(), [
      'minimo_disciplinas_professor', 'peso_dia_turno', 'peso_disciplina', 'phi', 'policy_version', 'teto_aulas_professor',
    ]);
  });
});

describe('Racionais exatos (CA-70)', () => {
  it('distingue médias que o ponto flutuante confunde', () => {
    const a = Q.racional(10_000_000_000_000_001n, 10_000_000_000_000_000n);
    const b = Q.racional(1, 1);
    assert.equal(10_000_000_000_000_001 / 10_000_000_000_000_000, 1); // float não distingue
    assert.equal(Q.comparar(a, b), 1);
  });

  it('normaliza e subtrai', () => {
    assert.deepEqual(Q.racional(6, -4), { num: -3n, den: 2n });
    assert.ok(Q.iguais(Q.subtrair(Q.racional(3, 1), Q.racional(3, 2)), Q.racional(3, 2)));
  });

  it('CA-68: amplitudes 2 e 1,5 ordenadas corretamente', () => {
    assert.equal(Q.comparar(Q.racional(3, 2), Q.racional(2, 1)), -1);
  });
});

describe('Comparador canônico (RN-61, ET-13, AUD-001)', () => {
  it('ordena IDs por bytes UTF-8: T1 < T10 < T2 (sem sufixo numérico)', () => {
    assert.deepEqual(['T2', 'T10', 'T1'].sort(compararIds), ['T1', 'T10', 'T2']);
  });

  it('usa bytes UTF-8, não unidades UTF-16 nem locale', () => {
    const acima = '\u{1F600}'; // fora do BMP (par substituto em UTF-16)
    const bmp = '�';
    assert.ok(acima > bmp === false); // em UTF-16 o par substituto vem antes
    assert.equal(compararIds(bmp, acima), -1); // em UTF-8 / pontos de código, U+FFFD < U+1F600
    assert.equal(compararIds('Á', 'B') > 0, true); // sem locale: "Á" (C3 81) depois de "B" (42)
  });

  it('hexadecimal dos bytes UTF-8', () => {
    assert.equal(hexUtf8('Sé'), '53c3a9');
  });

  const instancia = () =>
    montarSnapshot({
      K: 2,
      blocos: [['SEGUNDA', 'NOITE', 2]],
      turmas: [['T10', 'S1', 'NOITE'], ['T2', 'S1', 'NOITE'], ['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2]],
      professores: [prof('P1', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2)), prof('P2', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2)),
        prof('P3', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2))],
    });

  it('a chave inclui vagas e segue a ordem canônica das posições', () => {
    const s = instancia();
    const oc: Ocupacao[] = [{ turma_id: 'T2', dia: 'SEGUNDA', turno: 'NOITE', indice: 2, disciplina_id: 'D1', professor_id: 'P1' }];
    const es = entradasCanonicas(s, oc);
    assert.equal(es.length, 6);
    assert.deepEqual(es.map((e) => `${e.indice}:${e.turma}:${e.ocupado}`), ['1:T1:0', '1:T10:0', '1:T2:0', '2:T1:0', '2:T10:0', '2:T2:1']);
    assert.match(chaveCanonica(s, oc), /^staggy\.chave\.v1\|1\.3\.1\./);
  });

  it('vaga precede aula na mesma posição; disciplina e professor por bytes', () => {
    const s = instancia();
    const vaga: Ocupacao[] = [];
    const aula: Ocupacao[] = [{ turma_id: 'T1', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, disciplina_id: 'D1', professor_id: 'P1' }];
    assert.equal(compararGrades(s, vaga, aula), -1);
  });

  it('CA-169: a mesma grade tem a mesma chave com arrays reordenados', () => {
    const s = instancia();
    const oc: Ocupacao[] = [
      { turma_id: 'T10', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, disciplina_id: 'D1', professor_id: 'P2' },
      { turma_id: 'T1', dia: 'SEGUNDA', turno: 'NOITE', indice: 2, disciplina_id: 'D1', professor_id: 'P1' },
    ];
    const chave = chaveCanonica(s, oc);
    for (let semente = 1; semente <= 5; semente++) {
      assert.equal(chaveCanonica(embaralharSnapshot(s, semente), [...oc].reverse()), chave);
    }
  });
});

describe('Hash do snapshot (RN-23, CA-169)', () => {
  const base = () =>
    montarSnapshot({
      K: 2,
      blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'NOITE', 2]],
      turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: [prof('P1', [['D1', 5], ['D2', 3]], todos('SEGUNDA', 'NOITE', 2)), prof('P2', [['D2', 4]], todos('TERCA', 'NOITE', 2))],
    });

  it('não muda com a ordem dos arrays nem com run_id', () => {
    const s = base();
    for (let semente = 1; semente <= 5; semente++) {
      assert.equal(hashSnapshot({ ...embaralharSnapshot(s, semente), run_id: `outro-${semente}` }), s.snapshot_hash);
    }
  });

  it('muda quando o conteúdo muda', () => {
    const s = base();
    const alterado = { ...s, disciplinas: s.disciplinas.map((d) => (d.id === 'D1' ? { ...d, carga_aulas: 4 } : d)) };
    assert.notEqual(hashSnapshot(alterado), s.snapshot_hash);
  });
});
