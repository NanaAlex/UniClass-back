// Orquestração de uma geração (ET-01, ET-07): pré-validação → motor sob
// supervisor → validação independente → classificação final.
//
// Classificação (RN-27, RN-66, ET-07):
// - entrada recusada antes do motor ............ ENTRADA_INVALIDA
// - motor não iniciou / caiu sem resultado ...... ERRO_EXECUCAO (incumbente só
//   como candidato recuperável, nunca promovido)
// - prazo do supervisor com incumbente .......... VALIDA_NAO_OTIMA (níveis com
//   prova recebida antes do prazo); sem incumbente → INCONCLUSIVA
// - resultado reprovado pela validação .......... ERRO_EXECUCAO (não publicável)
// - demais ...................................... status do motor, já validado

import { performance } from 'perf_hooks';
import { validarSnapshot } from './contrato';
import { hashSnapshot } from './hash';
import { POLICY_VERSION, SCHEMA_RESULTADO, VERSAO_MOTOR_ESPERADA } from './politica';
import { executarMotor, type ExecucaoBruta, type OpcoesSupervisor } from './supervisor';
import type { CamposGrade, Diagnostico, ProvaNivel, ResultadoMotor, Snapshot, StatusFinal } from './tipos';
import { validarResultado, type ResultadoValidacao } from './validador';

export interface ExecucaoFinal {
  run_id: string;
  snapshot_hash: string;
  status_final: StatusFinal;
  motivo_termino: string;
  // Resultado aceito (grade validada quando grade_validada = true)
  resultado: ResultadoMotor | null;
  // O que o motor declarou, preservado para auditoria (RN-31)
  resultado_motor: ResultadoMotor | null;
  validacao: ResultadoValidacao | null;
  grade_validada: boolean;
  diagnosticos: Diagnostico[];
  candidato_recuperavel: CamposGrade | null;
  encerrado_por_prazo: boolean;
  duracao_execucao_ms: number;
  tempo_primeira_grade_ms: number | null;
  detalhe_tecnico: string | null;
}

export interface OpcoesGeracao {
  permitirLimiteDeTeste?: boolean;
  caminhoSwipl?: string;
  caminhoMotor?: string;
  rastreio?: number;
  aoEvento?: OpcoesSupervisor['aoEvento'];
}

function diag(
  categoria: string,
  codigo: string,
  etapa: string,
  mensagem: string,
  natureza: Diagnostico['natureza_evidencia'],
  entidades: Record<string, unknown> = {},
): Diagnostico {
  return { categoria, codigo, severidade: 'erro', etapa, mensagem, entidades, natureza_evidencia: natureza };
}

function camposDaGrade(fonte: CamposGrade): CamposGrade {
  return {
    ocupacoes: fonte.ocupacoes,
    C: fonte.C,
    parcelas: fonte.parcelas,
    aulas_por_professor: fonte.aulas_por_professor,
    total_aulas_por_turma_disciplina: fonte.total_aulas_por_turma_disciplina,
    max_M_p: fonte.max_M_p,
    min_M_p: fonte.min_M_p,
    amplitude_M: fonte.amplitude_M,
    chave_canonica: fonte.chave_canonica,
  };
}

const OBJETIVOS = ['custo_primario', 'max_media_docente', 'amplitude_medias', 'chave_canonica'];
const METODOS = [
  'branch_and_bound_profundidade_completo',
  'reinicios_com_melhoria_estrita_busca_completa',
  'reinicios_com_melhoria_estrita_busca_completa',
  'rotulacao_lexicografica_canonica_completa',
];

// Resultado reconstruído pelo supervisor quando o prazo encerra o processo:
// incumbente recebido + níveis cujas provas chegaram antes do prazo.
function resultadoPorPrazo(s: Snapshot, bruta: ExecucaoBruta): ResultadoMotor {
  const inc = bruta.ultimoIncumbente;
  const comprovados = new Set(bruta.provas.map((p) => p.nivel));
  const valores = inc ? [inc.C, inc.max_M_p, inc.amplitude_M, inc.chave_canonica] : [null, null, null, null];
  const provas: ProvaNivel[] = [1, 2, 3, 4].map((n) => {
    const comprovado = Boolean(inc) && comprovados.has(n) && [...Array(n).keys()].every((i) => comprovados.has(i + 1));
    return {
      nivel: n as ProvaNivel['nivel'],
      objetivo: OBJETIVOS[n - 1],
      metodo: METODOS[n - 1],
      estado: comprovado ? 'COMPROVADO' : 'NAO_COMPROVADO_LIMITE_TEMPO',
      comprovado,
      valor: (valores[n - 1] ?? null) as ProvaNivel['valor'],
    };
  });
  const vazio: CamposGrade = {
    ocupacoes: [], C: null, parcelas: null, aulas_por_professor: [], total_aulas_por_turma_disciplina: [],
    max_M_p: null, min_M_p: null, amplitude_M: null, chave_canonica: null,
  };
  return {
    tipo: 'resultado',
    schema_version: SCHEMA_RESULTADO,
    run_id: s.run_id,
    snapshot_hash: s.snapshot_hash,
    versao_motor: VERSAO_MOTOR_ESPERADA,
    policy_version: POLICY_VERSION,
    status: inc ? 'VALIDA_NAO_OTIMA' : 'INCONCLUSIVA',
    motivo_termino: 'LIMITE_TEMPO_SUPERVISOR',
    duracao_execucao_ms: Math.round(bruta.duracaoMs),
    tempo_primeira_grade_ms: bruta.tempoPrimeiroIncumbenteMs,
    limites_atingidos: ['TEMPO'],
    ...(inc ? camposDaGrade(inc) : vazio),
    prova_por_nivel: inc ? provas : provas.map((p) => ({ ...p, comprovado: false, estado: 'NAO_COMPROVADO_LIMITE_TEMPO' as const, valor: null })),
    travas_aplicadas: s.travas.map((t) => t.id),
    diagnosticos: [],
    estatisticas: {},
    heuristica: '',
    candidato_recuperavel: null,
  };
}

function final(
  s: Pick<Snapshot, 'run_id' | 'snapshot_hash'>,
  status: StatusFinal,
  motivo: string,
  inicio: number,
  extra: Partial<ExecucaoFinal> = {},
): ExecucaoFinal {
  return {
    run_id: s.run_id,
    snapshot_hash: s.snapshot_hash,
    status_final: status,
    motivo_termino: motivo,
    resultado: null,
    resultado_motor: null,
    validacao: null,
    grade_validada: false,
    diagnosticos: [],
    candidato_recuperavel: null,
    encerrado_por_prazo: false,
    duracao_execucao_ms: Math.round(performance.now() - inicio),
    tempo_primeira_grade_ms: null,
    detalhe_tecnico: null,
    ...extra,
  };
}

export async function executarGeracao(s: Snapshot, opcoes: OpcoesGeracao = {}): Promise<ExecucaoFinal> {
  const inicio = performance.now();

  // 1. Pré-validação (RN-24)
  const pre = validarSnapshot(s, { permitirLimiteDeTeste: opcoes.permitirLimiteDeTeste });
  if (!pre.valido) {
    return final(s, 'ENTRADA_INVALIDA', 'ENTRADA_INVALIDA', inicio, { diagnosticos: pre.diagnosticos });
  }
  if (hashSnapshot(s) !== s.snapshot_hash) {
    return final(s, 'ENTRADA_INVALIDA', 'ENTRADA_INVALIDA', inicio, {
      diagnosticos: [diag('entrada_invalida', 'SNAPSHOT_HASH_DIVERGENTE', 'pre_validacao_backend',
        'O hash do snapshot não confere com o conteúdo (RN-23)', 'comprovada')],
    });
  }

  // 2. Motor sob supervisão, com o prazo único restante (RN-51)
  const decorrido = performance.now() - inicio;
  const bruta = await executarMotor(s, {
    limiteMs: s.limite_execucao_segundos * 1000 - decorrido,
    caminhoSwipl: opcoes.caminhoSwipl,
    caminhoMotor: opcoes.caminhoMotor,
    rastreio: opcoes.rastreio,
    aoEvento: opcoes.aoEvento,
  });
  const comum = {
    encerrado_por_prazo: bruta.encerradoPorPrazo,
    tempo_primeira_grade_ms: bruta.tempoPrimeiroIncumbenteMs,
  };
  const candidatoDoStream = bruta.ultimoIncumbente ? camposDaGrade(bruta.ultimoIncumbente) : null;

  if (bruta.erroInicializacao) {
    return final(s, 'ERRO_EXECUCAO', 'FALHA_INICIALIZACAO_MOTOR', inicio, {
      ...comum,
      diagnosticos: [diag('falha_tecnica', 'MOTOR_NAO_INICIOU', 'inicializacao_motor',
        'O motor Prolog não pôde ser iniciado; verifique a instalação do SWI-Prolog', 'falha_tecnica')],
      detalhe_tecnico: bruta.erroInicializacao,
    });
  }

  let resultado: ResultadoMotor;
  if (bruta.resultado) {
    resultado = bruta.resultado;
  } else if (bruta.encerradoPorPrazo) {
    resultado = resultadoPorPrazo(s, bruta);
  } else {
    // Queda sem resultado: falha técnica, incumbente só para recuperação (CA-175)
    return final(s, 'ERRO_EXECUCAO', 'QUEDA_DO_MOTOR', inicio, {
      ...comum,
      candidato_recuperavel: candidatoDoStream,
      diagnosticos: [diag('falha_tecnica', 'MOTOR_ENCERRADO_SEM_RESULTADO', 'resolucao',
        'O motor encerrou sem emitir resultado; a execução é falha técnica, não inviabilidade (CA-55)', 'falha_tecnica',
        { codigo_saida: bruta.codigoSaida })],
      detalhe_tecnico: bruta.stderr.slice(0, 1000) || null,
    });
  }

  const tempoPrimeira = resultado.tempo_primeira_grade_ms ?? bruta.tempoPrimeiroIncumbenteMs;

  if (resultado.status === 'ERRO_EXECUCAO') {
    return final(s, 'ERRO_EXECUCAO', resultado.motivo_termino, inicio, {
      ...comum,
      resultado_motor: resultado,
      candidato_recuperavel: resultado.candidato_recuperavel ? camposDaGrade(resultado.candidato_recuperavel) : candidatoDoStream,
      diagnosticos: resultado.diagnosticos,
      tempo_primeira_grade_ms: tempoPrimeira,
    });
  }

  // 3. Validação independente (RN-28)
  const validacao = validarResultado(s, resultado, { encerradoPorPrazo: bruta.encerradoPorPrazo });
  if (!validacao.aprovada) {
    return final(s, 'ERRO_EXECUCAO', 'RESULTADO_REPROVADO_NA_VALIDACAO', inicio, {
      ...comum,
      resultado_motor: resultado,
      validacao,
      candidato_recuperavel: resultado.ocupacoes.length > 0 ? camposDaGrade(resultado) : candidatoDoStream,
      diagnosticos: [
        diag('validacao_independente', 'RESULTADO_DIVERGENTE', 'validacao_independente',
          'O resultado do motor foi reprovado pela validação independente e não pode ser publicado (RN-28)', 'comprovada'),
        ...validacao.erros,
      ],
      tempo_primeira_grade_ms: tempoPrimeira,
    });
  }

  const comGrade = resultado.status === 'OTIMA_COMPROVADA' || resultado.status === 'VALIDA_NAO_OTIMA';
  return final(s, resultado.status, resultado.motivo_termino, inicio, {
    ...comum,
    resultado,
    resultado_motor: resultado,
    validacao,
    grade_validada: comGrade,
    diagnosticos: resultado.diagnosticos,
    tempo_primeira_grade_ms: tempoPrimeira,
  });
}
