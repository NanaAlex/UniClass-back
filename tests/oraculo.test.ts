// Regressão diferencial contra oráculo exaustivo independente (RN-73, CA-172,
// ET-19): para instâncias pequenas com K variado, travas e empates, o motor
// e o oráculo devem concordar em status, custo, pior média, amplitude e
// chave canônica.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compararComOraculo } from './apoio/diferencial';
import { instanciaPequenaAleatoria } from './apoio/gerador';

describe('Motor × oráculo exaustivo (CA-172)', () => {
  const SEMENTES = Array.from({ length: 120 }, (_, i) => 1000 + i);

  it(`concorda em ${SEMENTES.length} instâncias aleatórias com semente fixa`, async () => {
    const divergencias: string[] = [];
    let viaveis = 0;
    let comTravas = 0;
    for (const semente of SEMENTES) {
      const s = instanciaPequenaAleatoria(semente);
      if (s.travas.length) comTravas++;
      const r = await compararComOraculo(s);
      if (r.viavel) viaveis++;
      if (!r.ok) divergencias.push(`semente ${semente}: ${r.detalhe}`);
    }
    assert.deepEqual(divergencias, []);
    // A amostra precisa exercitar os dois desfechos e as travas
    assert.ok(viaveis >= 30, `poucas instâncias viáveis: ${viaveis}`);
    assert.ok(SEMENTES.length - viaveis >= 10, 'poucas instâncias inviáveis');
    assert.ok(comTravas >= 15, `poucas instâncias com travas: ${comTravas}`);
  });
});
