// Hash do snapshot (RN-23, CA-169): SHA-256 da forma normalizada, com listas
// ordenadas por IDs estáveis e chaves de objeto em ordem fixa. Reordenar os
// arrays do JSON não altera o hash. run_id e snapshot_hash não entram no
// cálculo: o hash identifica o conteúdo, não a execução.

import { createHash } from 'crypto';
import { compararCoordenadas, compararIds, DIA_ISO, TURNO_CODIGO } from './canonico';
import type { Snapshot, Trava } from './tipos';

function ordenarChaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarChaves);
  if (valor !== null && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(obj).sort()) saida[chave] = ordenarChaves(obj[chave]);
    return saida;
  }
  return valor;
}

export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenarChaves(valor));
}

export function normalizarSnapshot(s: Snapshot): Omit<Snapshot, 'run_id' | 'snapshot_hash'> {
  const { run_id: _r, snapshot_hash: _h, ...resto } = s;
  return {
    ...resto,
    turnos: [...s.turnos].sort((a, b) => TURNO_CODIGO[a] - TURNO_CODIGO[b]),
    dias_letivos: [...s.dias_letivos].sort((a, b) => DIA_ISO[a] - DIA_ISO[b]),
    blocos_por_dia_turno: [...s.blocos_por_dia_turno].sort((a, b) =>
      compararCoordenadas({ ...a, indice: 0 }, { ...b, indice: 0 }),
    ),
    turmas: [...s.turmas].sort((a, b) => compararIds(a.id, b.id)),
    disciplinas: [...s.disciplinas].sort((a, b) => compararIds(a.id, b.id)),
    professores_participantes: [...s.professores_participantes]
      .sort((a, b) => compararIds(a.id, b.id))
      .map((p) => ({
        ...p,
        disciplinas_selecionadas_e_notas: [...p.disciplinas_selecionadas_e_notas].sort((a, b) =>
          compararIds(a.disciplina_id, b.disciplina_id),
        ),
        blocos_selecionados: [...p.blocos_selecionados].sort(compararCoordenadas),
        notas_dia_turno: [...p.notas_dia_turno].sort((a, b) =>
          compararCoordenadas({ ...a, indice: 0 }, { ...b, indice: 0 }),
        ),
      })),
    travas: [...s.travas].sort((a: Trava, b: Trava) => compararIds(a.id, b.id)),
  };
}

export function hashSnapshot(s: Snapshot): string {
  return createHash('sha256').update(jsonCanonico(normalizarSnapshot(s)), 'utf8').digest('hex');
}

export function hashTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}
