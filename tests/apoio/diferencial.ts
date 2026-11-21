import * as Q from '../../src/motor/racional';
import type { Snapshot } from '../../src/motor/tipos';
import { resolver } from './motor';
import { resolverPorEnumeracao } from './oraculo';

// Compara o motor (opcionalmente uma cópia mutada) com o oráculo exaustivo:
// status, custo, pior média, amplitude e chave canônica (CA-172).
export async function compararComOraculo(s: Snapshot, caminhoMotor?: string) {
  const oraculo = resolverPorEnumeracao(s);
  const e = await resolver(s, 30, caminhoMotor ? { caminhoMotor } : {});
  if (!oraculo.viavel) {
    return { ok: e.status_final === 'INVIAVEL_COMPROVADA', viavel: false, detalhe: `oráculo: inviável; motor: ${e.status_final}` };
  }
  const m = oraculo.melhor!.recomputo;
  const r = e.resultado;
  const txt = (x: Q.Racional | null) => (x ? `${x.num}/${x.den}` : 'null');
  const igualR = (j: { num: number; den: number } | null | undefined, x: Q.Racional | null) =>
    x === null ? j === null : !!j && Q.iguais(Q.racional(j.num, j.den), x);
  const ok =
    e.status_final === 'OTIMA_COMPROVADA' &&
    !!r &&
    r.C === m.C &&
    igualR(r.max_M_p, m.maxM) &&
    igualR(r.amplitude_M, m.amplitude) &&
    r.chave_canonica === m.chave;
  return {
    ok,
    viavel: true,
    detalhe: `oráculo C=${m.C} max=${txt(m.maxM)} amp=${txt(m.amplitude)} | motor ${e.status_final} C=${r?.C} ` +
      `max=${JSON.stringify(r?.max_M_p)} amp=${JSON.stringify(r?.amplitude_M)} chave_igual=${r?.chave_canonica === m.chave}`,
  };
}
