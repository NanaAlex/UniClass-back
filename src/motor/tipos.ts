// Contrato técnico backend–Prolog (ET-06): staggy.snapshot.v1 e staggy.resultado.v1.

export type Turno = 'MANHA' | 'TARDE' | 'NOITE';
export type Dia = 'SEGUNDA' | 'TERCA' | 'QUARTA' | 'QUINTA' | 'SEXTA' | 'SABADO' | 'DOMINGO';

export interface Coordenada {
  dia: Dia;
  turno: Turno;
  indice: number;
}

export interface PoliticaSnapshot {
  policy_version: string;
  phi: { nota: number; penalidade: number }[];
  peso_dia_turno: number;
  peso_disciplina: number;
  teto_aulas_professor: number;
  minimo_disciplinas_professor: number;
}

export interface BlocosDiaTurno {
  dia: Dia;
  turno: Turno;
  quantidade: number;
}

export interface TurmaSnapshot {
  id: string;
  semestre_id: string;
  turno: Turno;
}

export interface DisciplinaSnapshot {
  id: string;
  semestre_id: string;
  carga_aulas: number;
}

export interface ProfessorSnapshot {
  id: string;
  disciplinas_selecionadas_e_notas: { disciplina_id: string; nota: number }[];
  blocos_selecionados: Coordenada[];
  notas_dia_turno: { dia: Dia; turno: Turno; nota: number }[];
}

export type TipoTrava = 'ocupacao' | 'vaga_turma' | 'vaga_professor' | 'fixacao_disciplina_professor';

export interface TravaOcupacao {
  id: string;
  tipo: 'ocupacao';
  origem_versao: string;
  alvo: Coordenada & { turma_id: string };
  valor_fixo: { disciplina_id: string; professor_id: string };
}

export interface TravaVagaTurma {
  id: string;
  tipo: 'vaga_turma';
  origem_versao: string;
  alvo: Coordenada & { turma_id: string };
  valor_fixo: null;
}

export interface TravaVagaProfessor {
  id: string;
  tipo: 'vaga_professor';
  origem_versao: string;
  alvo: Coordenada & { professor_id: string };
  valor_fixo: null;
}

export interface TravaFixacao {
  id: string;
  tipo: 'fixacao_disciplina_professor';
  origem_versao: string;
  alvo: { semestre_id: string; disciplina_id: string };
  valor_fixo: { professor_id: string };
}

export type Trava = TravaOcupacao | TravaVagaTurma | TravaVagaProfessor | TravaFixacao;

export interface Snapshot {
  schema_version: string;
  run_id: string;
  curso_id: string;
  periodo_letivo_id: string;
  form_version: string;
  snapshot_hash: string;
  K: number;
  turnos: Turno[];
  dias_letivos: Dia[];
  blocos_por_dia_turno: BlocosDiaTurno[];
  turmas: TurmaSnapshot[];
  disciplinas: DisciplinaSnapshot[];
  professores_participantes: ProfessorSnapshot[];
  travas: Trava[];
  politica: PoliticaSnapshot;
  limite_execucao_segundos: number;
}

export const STATUS_FINAIS = [
  'OTIMA_COMPROVADA',
  'VALIDA_NAO_OTIMA',
  'INVIAVEL_COMPROVADA',
  'INCONCLUSIVA',
  'ENTRADA_INVALIDA',
  'ERRO_EXECUCAO',
] as const;

export type StatusFinal = (typeof STATUS_FINAIS)[number];

// EM_PROCESSAMENTO é estado de interface, nunca resultado do resolvedor (ET-12)
export type StatusExecucao = StatusFinal | 'EM_PROCESSAMENTO';

export type NaturezaEvidencia = 'comprovada' | 'hipotese_preliminar' | 'falha_tecnica';

export interface Diagnostico {
  categoria: string;
  codigo: string;
  severidade: 'erro' | 'aviso' | 'info';
  etapa: string;
  mensagem: string;
  entidades: Record<string, unknown>;
  natureza_evidencia: NaturezaEvidencia;
  detalhe_tecnico?: string;
}

export interface Ocupacao {
  turma_id: string;
  dia: Dia;
  turno: Turno;
  indice: number;
  disciplina_id: string;
  professor_id: string;
}

export interface RacionalJson {
  num: number;
  den: number;
}

export interface ProvaNivel {
  nivel: 1 | 2 | 3 | 4;
  objetivo: string;
  metodo: string;
  estado: 'COMPROVADO' | 'NAO_COMPROVADO_LIMITE_TEMPO' | 'NAO_COMPROVADO_FALHA_INTERNA' | 'NAO_EXECUTADO';
  comprovado: boolean;
  valor: number | RacionalJson | string | null;
}

export interface CamposGrade {
  ocupacoes: Ocupacao[];
  C: number | null;
  parcelas: { dia_turno: number; disciplina: number } | null;
  aulas_por_professor: { professor_id: string; aulas: number; custo: number }[];
  total_aulas_por_turma_disciplina: { turma_id: string; disciplina_id: string; aulas: number }[];
  max_M_p: RacionalJson | null;
  min_M_p: RacionalJson | null;
  amplitude_M: RacionalJson | null;
  chave_canonica: string | null;
}

export interface ResultadoMotor extends CamposGrade {
  tipo: 'resultado';
  schema_version: string;
  run_id: string | null;
  snapshot_hash: string | null;
  versao_motor: string;
  policy_version: string;
  status: StatusFinal;
  motivo_termino: string;
  duracao_execucao_ms: number;
  tempo_primeira_grade_ms: number | null;
  limites_atingidos: string[];
  prova_por_nivel: ProvaNivel[];
  travas_aplicadas: string[];
  diagnosticos: Diagnostico[];
  estatisticas: Record<string, unknown>;
  heuristica: string;
  candidato_recuperavel: (CamposGrade & Record<string, unknown>) | null;
}

export interface EventoIncumbente extends CamposGrade {
  tipo: 'incumbente';
  run_id: string;
  snapshot_hash: string;
  nivel: number;
  tempo_ms: number;
}

export interface EventoProva {
  tipo: 'prova';
  run_id: string;
  snapshot_hash: string;
  nivel: number;
  objetivo: string;
  valor: unknown;
  tempo_ms: number;
}
