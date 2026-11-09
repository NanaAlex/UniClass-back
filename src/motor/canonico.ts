// Comparador e chave canônica (RN-33, RN-61, CP-07, ET-05, ET-13).
//
// IDs são opacos e comparados pela sequência de bytes UTF-8 (sem locale e sem
// sufixo numérico): "T1" < "T10" < "T2". O motor Prolog usa a mesma regra
// (compare/3 sobre listas de bytes), garantindo chaves idênticas (AUD-001).
//
// Chave: uma entrada por posição de cada turma, inclusive vagas, com campos
// (dia ISO, turno, índice, curso, período, turma, disciplina, professor,
// ocupado). Vaga tem disciplina/professor vazios e precede qualquer aula.
// Serialização: "staggy.chave.v1|" + entradas "d.t.i.hC.hP.hT.hD.hPr.o" unidas
// por ";" — IDs em hexadecimal minúsculo dos bytes UTF-8.

import { VERSAO_CHAVE } from './politica';
import type { Coordenada, Dia, Ocupacao, Snapshot, Turno } from './tipos';

export const DIA_ISO: Readonly<Record<Dia, number>> = Object.freeze({
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
  DOMINGO: 7,
});

export const TURNO_CODIGO: Readonly<Record<Turno, number>> = Object.freeze({ MANHA: 1, TARDE: 2, NOITE: 3 });

export function bytesUtf8(texto: string): Buffer {
  return Buffer.from(texto, 'utf8');
}

export function compararIds(a: string, b: string): number {
  return Buffer.compare(bytesUtf8(a), bytesUtf8(b));
}

export function hexUtf8(texto: string): string {
  return bytesUtf8(texto).toString('hex');
}

export function compararCoordenadas(a: Coordenada, b: Coordenada): number {
  return (
    DIA_ISO[a.dia] - DIA_ISO[b.dia] ||
    TURNO_CODIGO[a.turno] - TURNO_CODIGO[b.turno] ||
    a.indice - b.indice
  );
}

export function chaveCoordenada(c: Coordenada): string {
  return `${c.dia}|${c.turno}|${c.indice}`;
}

export function chavePosicao(turmaId: string, c: Coordenada): string {
  return `${turmaId}#${chaveCoordenada(c)}`;
}

// Todas as coordenadas ordinais existentes, na ordem canônica (RN-35)
export function coordenadasDoCalendario(snapshot: Pick<Snapshot, 'blocos_por_dia_turno'>): Coordenada[] {
  const coordenadas: Coordenada[] = [];
  for (const b of snapshot.blocos_por_dia_turno) {
    for (let indice = 1; indice <= b.quantidade; indice++) {
      coordenadas.push({ dia: b.dia, turno: b.turno, indice });
    }
  }
  return coordenadas.sort(compararCoordenadas);
}

export interface EntradaCanonica {
  dia: number;
  turno: number;
  indice: number;
  curso: string;
  periodo: string;
  turma: string;
  disciplina: string;
  professor: string;
  ocupado: 0 | 1;
}

export function compararEntradas(a: EntradaCanonica, b: EntradaCanonica): number {
  return (
    a.dia - b.dia ||
    a.turno - b.turno ||
    a.indice - b.indice ||
    compararIds(a.curso, b.curso) ||
    compararIds(a.periodo, b.periodo) ||
    compararIds(a.turma, b.turma) ||
    compararIds(a.disciplina, b.disciplina) ||
    compararIds(a.professor, b.professor) ||
    a.ocupado - b.ocupado
  );
}

export function entradasCanonicas(snapshot: Snapshot, ocupacoes: Ocupacao[]): EntradaCanonica[] {
  const porPosicao = new Map<string, Ocupacao>();
  for (const o of ocupacoes) porPosicao.set(chavePosicao(o.turma_id, o), o);

  const coordenadas = coordenadasDoCalendario(snapshot);
  const entradas: EntradaCanonica[] = [];

  for (const turma of snapshot.turmas) {
    for (const c of coordenadas) {
      if (c.turno !== turma.turno) continue;
      const o = porPosicao.get(chavePosicao(turma.id, c));
      entradas.push({
        dia: DIA_ISO[c.dia],
        turno: TURNO_CODIGO[c.turno],
        indice: c.indice,
        curso: snapshot.curso_id,
        periodo: snapshot.periodo_letivo_id,
        turma: turma.id,
        disciplina: o ? o.disciplina_id : '',
        professor: o ? o.professor_id : '',
        ocupado: o ? 1 : 0,
      });
    }
  }

  return entradas.sort(compararEntradas);
}

export function serializarChave(entradas: EntradaCanonica[]): string {
  const partes = entradas.map((e) =>
    [
      e.dia,
      e.turno,
      e.indice,
      hexUtf8(e.curso),
      hexUtf8(e.periodo),
      hexUtf8(e.turma),
      hexUtf8(e.disciplina),
      hexUtf8(e.professor),
      e.ocupado,
    ].join('.'),
  );
  return `${VERSAO_CHAVE}|${partes.join(';')}`;
}

export function chaveCanonica(snapshot: Snapshot, ocupacoes: Ocupacao[]): string {
  return serializarChave(entradasCanonicas(snapshot, ocupacoes));
}

// Comparação de duas grades da mesma instância pela chave canônica
export function compararGrades(snapshot: Snapshot, a: Ocupacao[], b: Ocupacao[]): number {
  const ea = entradasCanonicas(snapshot, a);
  const eb = entradasCanonicas(snapshot, b);
  for (let i = 0; i < Math.min(ea.length, eb.length); i++) {
    const c = compararEntradas(ea[i], eb[i]);
    if (c !== 0) return c;
  }
  return ea.length - eb.length;
}
