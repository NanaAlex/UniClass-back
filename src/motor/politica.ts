// Política homologada da v2.7 (CP-02, CP-03, RN-20, RN-26, RN-32, RN-51).
// Fixa no código e versionada: nenhuma rota ou tela a altera (CA-48, CA-72).
// O motor Prolog tem a mesma política e recusa snapshots com outra (CA-174).

export const VERSAO_MOTOR_ESPERADA = 'staggy-clpfd-2.7.0';
export const SCHEMA_SNAPSHOT = 'staggy.snapshot.v1';
export const SCHEMA_RESULTADO = 'staggy.resultado.v1';
export const VERSAO_CHAVE = 'staggy.chave.v1';
export const POLICY_VERSION = 'staggy-preferencias-v2.7';

// Prazo único de 600 s por geração, sem reinício por estágio (RN-51, ET-09)
export const LIMITE_EXECUCAO_SEGUNDOS = 600;

export const PHI: Readonly<Record<number, number>> = Object.freeze({ 5: 0, 4: 1, 3: 3, 2: 6, 1: 10 });
export const PESO_DIA_TURNO = 3;
export const PESO_DISCIPLINA = 2;
export const TETO_AULAS_PROFESSOR = 40;
export const MINIMO_DISCIPLINAS_PROFESSOR = 1;

export const HIERARQUIA = Object.freeze([
  'custo_primario',
  'max_media_docente',
  'amplitude_medias',
  'chave_canonica',
] as const);

export function politicaDoSnapshot() {
  return {
    policy_version: POLICY_VERSION,
    phi: [5, 4, 3, 2, 1].map((nota) => ({ nota, penalidade: PHI[nota] })),
    peso_dia_turno: PESO_DIA_TURNO,
    peso_disciplina: PESO_DISCIPLINA,
    teto_aulas_professor: TETO_AULAS_PROFESSOR,
    minimo_disciplinas_professor: MINIMO_DISCIPLINAS_PROFESSOR,
  };
}

export function phi(nota: number): number {
  const valor = PHI[nota];
  if (valor === undefined) throw new RangeError(`Nota fora da escala 1..5: ${nota}`);
  return valor;
}

// Parcelas de um bloco ocupado: K × 3φ(dia/turno) e K × 2φ(disciplina) (CP-03)
export function parcelasBloco(K: number, notaDiaTurno: number, notaDisciplina: number) {
  const diaTurno = K * PESO_DIA_TURNO * phi(notaDiaTurno);
  const disciplina = K * PESO_DISCIPLINA * phi(notaDisciplina);
  return { diaTurno, disciplina, total: diaTurno + disciplina };
}

export function custoBloco(K: number, notaDiaTurno: number, notaDisciplina: number): number {
  return parcelasBloco(K, notaDiaTurno, notaDisciplina).total;
}
