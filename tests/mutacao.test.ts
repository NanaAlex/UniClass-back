// Teste de mutação (RN-73, CA-207, AUD-012): cópias do motor com defeitos
// controlados devem ser detectadas pela comparação com o oráculo. Inclui a
// mutação exigida pela especificação (desabilitar o 3º nível de equidade).

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { Snapshot } from '../src/motor/tipos';
import { montarSnapshot, prof, todos } from './apoio/fabrica';
import { compararComOraculo } from './apoio/diferencial';
import { instanciaPequenaAleatoria } from './apoio/gerador';

const PROLOG = path.resolve(__dirname, '..', 'prolog');
const pastas: string[] = [];
after(() => pastas.forEach((p) => rmSync(p, { recursive: true, force: true })));

function mutante(original: string, substituto: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'staggy-mutante-'));
  pastas.push(dir);
  const fonte = readFileSync(path.join(PROLOG, 'alocacao.pl'), 'utf8');
  assert.ok(fonte.includes(original), `trecho a mutar não encontrado: ${original}`);
  writeFileSync(path.join(dir, 'alocacao.pl'), fonte.replace(original, substituto), 'utf8');
  copyFileSync(path.join(PROLOG, 'executar.pl'), path.join(dir, 'executar.pl'));
  return path.join(dir, 'executar.pl');
}

// Instâncias em que cada nível decide (os mesmos casos de motor.test.ts)
const casos: Record<string, Snapshot> = {
  nivel1: montarSnapshot({
    K: 2, blocos: [['SEGUNDA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE']], disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
    professores: [prof('P1', [['D1', 5], ['D2', 5]], todos('SEGUNDA', 'NOITE', 2)), prof('P2', [['D1', 4], ['D2', 2]], todos('SEGUNDA', 'NOITE', 2))],
  }),
  // Grade A (D2→P2, D3→P1): C=12, médias (6, 0, 0). Grade B (D2→P1,
  // D3→P2): C=12, médias (3, 3, 0). A busca acha A primeiro; P3 fixa a
  // menor média em 0, então o nível 3 não compensa; e A tem chave menor que
  // B (postos 0,1,3,… × 0,1,5,…). Sem o nível 2 o resultado seria A.
  nivel2: montarSnapshot({
    K: 1, blocos: [['SEGUNDA', 'MANHA', 6]], turmas: [['T1', 'S1', 'MANHA']],
    disciplinas: [['D1', 'S1', 1], ['D2', 'S1', 1], ['D3', 'S1', 1], ['D4', 'S1', 1], ['D5', 'S1', 1]],
    professores: [prof('P1', [['D1', 5], ['D2', 3], ['D3', 2]], todos('SEGUNDA', 'MANHA', 6)),
      prof('P2', [['D2', 5], ['D3', 3], ['D4', 5]], [['SEGUNDA', 'MANHA', 3], ['SEGUNDA', 'MANHA', 4]]),
      prof('P3', [['D5', 5]], todos('SEGUNDA', 'MANHA', 6))],
  }),
  nivel3: montarSnapshot({
    K: 1, blocos: [['SEGUNDA', 'MANHA', 3]], turmas: [['T1', 'S1', 'MANHA']],
    disciplinas: [['D1', 'S1', 1], ['D2', 'S1', 1], ['D3', 'S1', 1]],
    professores: [prof('P1', [['D1', 1]], todos('SEGUNDA', 'MANHA', 3)), prof('P2', [['D2', 5], ['D3', 3]], todos('SEGUNDA', 'MANHA', 3)),
      prof('P3', [['D2', 3], ['D3', 2]], todos('SEGUNDA', 'MANHA', 3))],
  }),
  nivel4: montarSnapshot({
    K: 2, blocos: [['SEGUNDA', 'NOITE', 3], ['TERCA', 'NOITE', 3]], turmas: [['TB', 'S1', 'NOITE'], ['TA', 'S1', 'NOITE']],
    disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
    professores: ['P1', 'P2', 'P3'].map((p) => prof(p, [['D1', 5], ['D2', 5]], [...todos('SEGUNDA', 'NOITE', 3), ...todos('TERCA', 'NOITE', 3)])),
  }),
};

async function detectado(motor: string): Promise<string | null> {
  const instancias = [...Object.values(casos), ...Array.from({ length: 30 }, (_, i) => instanciaPequenaAleatoria(1000 + i))];
  for (const s of instancias) {
    const r = await compararComOraculo(s, motor);
    if (!r.ok) return `${s.run_id}: ${r.detalhe}`;
  }
  return null;
}

describe('Mutações do motor são detectadas (CA-207)', () => {
  it('o motor original passa no mesmo critério', async () => {
    assert.equal(await detectado(path.join(PROLOG, 'executar.pl')), null);
  });

  it('CA-207: desabilitar o 3º nível (amplitude) é detectado', async () => {
    const m = mutante('nivel_iterativo(M, 3, R3),', 'R3 = completo,');
    assert.notEqual(await detectado(m), null);
  });

  it('desabilitar o 2º nível (pior média) é detectado', async () => {
    const m = mutante('nivel_iterativo(M, 2, R2),', 'R2 = completo,');
    assert.notEqual(await detectado(m), null);
  });

  it('desabilitar o desempate canônico é detectado', async () => {
    const m = mutante('melhorar_posicao(V, W, T, Ci, M, Sol0, Sol1, WF)', 'Sol1 = Sol0, WF = W');
    assert.notEqual(await detectado(m), null);
  });

  it('declarar ótimo o primeiro custo encontrado (sem prova do nível 1) é detectado', async () => {
    const m = mutante('    nb_setval(staggy_ub, UB),\n    fail.', '    nb_setval(staggy_ub, UB).');
    assert.notEqual(await detectado(m), null);
  });
});
