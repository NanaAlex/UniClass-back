// Supervisor, prazo único e falhas técnicas (RN-27, RN-48, RN-51, RN-66,
// ET-07, ET-09, ET-15, CA-52, CA-53, CA-55, CA-120, CA-136 a CA-138,
// CA-173, CA-175, AUD-006, AUD-011).

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { executarGeracao } from '../src/motor/geracao';
import { comHash, montarSnapshot, prof, todos } from './apoio/fabrica';
import { instanciaRealista } from './apoio/gerador';

const FIXTURES = path.resolve(__dirname, 'fixtures');

const pequena = (limite: number) =>
  comHash({
    ...montarSnapshot({
      K: 2, blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'NOITE', 2]], turmas: [['T1', 'S1', 'NOITE']],
      disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
      professores: [prof('P1', [['D1', 5], ['D2', 3]], todos('SEGUNDA', 'NOITE', 2)), prof('P2', [['D2', 4]], todos('TERCA', 'NOITE', 2))],
    }),
    limite_execucao_segundos: limite,
  });

describe('Supervisor do processo Prolog', () => {
  it('CA-120/CA-137: prazo atingido com incumbente → VALIDA_NAO_OTIMA, nunca ótima', async () => {
    const e = await executarGeracao(pequena(3), { permitirLimiteDeTeste: true, caminhoMotor: path.join(FIXTURES, 'motor_lento.pl') });
    assert.equal(e.encerrado_por_prazo, true);
    assert.equal(e.status_final, 'VALIDA_NAO_OTIMA');
    assert.equal(e.motivo_termino, 'LIMITE_TEMPO_SUPERVISOR');
    assert.equal(e.grade_validada, true);
    assert.deepEqual(e.resultado!.limites_atingidos, ['TEMPO']);
  });

  it('CA-53/CA-138: prazo sem incumbente → INCONCLUSIVA, sem grade', async () => {
    const e = await executarGeracao(pequena(2), { permitirLimiteDeTeste: true, caminhoMotor: path.join(FIXTURES, 'motor_mudo.pl') });
    assert.equal(e.status_final, 'INCONCLUSIVA');
    assert.equal(e.grade_validada, false);
    assert.equal(e.resultado!.ocupacoes.length, 0);
  });

  it('CA-175/AUD-006: queda após incumbente → ERRO_EXECUCAO com candidato recuperável não publicado', async () => {
    const e = await executarGeracao(pequena(20), { permitirLimiteDeTeste: true, caminhoMotor: path.join(FIXTURES, 'motor_queda.pl') });
    assert.equal(e.status_final, 'ERRO_EXECUCAO');
    assert.equal(e.motivo_termino, 'QUEDA_DO_MOTOR');
    assert.equal(e.grade_validada, false);
    assert.equal(e.resultado, null);
    assert.ok(e.candidato_recuperavel && e.candidato_recuperavel.ocupacoes.length > 0);
    assert.ok(e.diagnosticos.every((d) => d.natureza_evidencia === 'falha_tecnica'));
  });

  it('CA-55: motor inexistente → ERRO_EXECUCAO (falha técnica, não inviabilidade)', async () => {
    const e = await executarGeracao(pequena(10), { permitirLimiteDeTeste: true, caminhoSwipl: 'swipl-inexistente-xyz' });
    assert.equal(e.status_final, 'ERRO_EXECUCAO');
    assert.ok(e.diagnosticos.some((d) => d.codigo === 'MOTOR_NAO_INICIOU'));
  });

  it('CA-52/CA-136: motor real no limite → VALIDA_NAO_OTIMA com prazo único respeitado', async () => {
    const inst = instanciaRealista({ semente: 22, semestres: 4, turmasPorSemestre: 1, disciplinasPorSemestre: 5, blocosPorDia: 4, professores: 12 });
    const limite = 4;
    const e = await executarGeracao(comHash({ ...inst.snapshot, limite_execucao_segundos: limite }), { permitirLimiteDeTeste: true });
    assert.equal(e.status_final, 'VALIDA_NAO_OTIMA');
    assert.equal(e.grade_validada, true);
    assert.ok(e.duracao_execucao_ms <= limite * 1000 + 1500, `duração ${e.duracao_execucao_ms} ms`);
    assert.ok(e.resultado!.prova_por_nivel.some((p) => !p.comprovado));
    assert.ok(e.tempo_primeira_grade_ms !== null && e.tempo_primeira_grade_ms < limite * 1000);
  });
});
