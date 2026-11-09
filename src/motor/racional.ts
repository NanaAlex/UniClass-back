// Aritmética racional exata para médias docentes (RN-33, CP-06, CP-08, CA-70):
// comparações por produto cruzado em BigInt, sem ponto flutuante.

import type { RacionalJson } from './tipos';

export interface Racional {
  num: bigint;
  den: bigint;
}

function mdc(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function racional(num: bigint | number, den: bigint | number): Racional {
  let n = BigInt(num);
  let d = BigInt(den);
  if (d === 0n) throw new RangeError('Denominador zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = mdc(n, d);
  return g === 0n ? { num: 0n, den: 1n } : { num: n / g, den: d / g };
}

export function comparar(a: Racional, b: Racional): number {
  const x = a.num * b.den;
  const y = b.num * a.den;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function subtrair(a: Racional, b: Racional): Racional {
  return racional(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function iguais(a: Racional, b: Racional): boolean {
  return comparar(a, b) === 0;
}

export function paraJson(r: Racional): RacionalJson {
  return { num: Number(r.num), den: Number(r.den) };
}

export function deJson(r: RacionalJson): Racional {
  return racional(BigInt(r.num), BigInt(r.den));
}

export function maximo(rs: Racional[]): Racional | null {
  return rs.reduce<Racional | null>((m, r) => (m === null || comparar(r, m) > 0 ? r : m), null);
}

export function minimo(rs: Racional[]): Racional | null {
  return rs.reduce<Racional | null>((m, r) => (m === null || comparar(r, m) < 0 ? r : m), null);
}
