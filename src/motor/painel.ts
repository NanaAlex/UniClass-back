// Painel técnico da geração (RN-59, RN-60, ET-12, CA-156 a CA-167).
// Contagens e penalidades saem da grade canônica validada pelo backend; sem
// grade completa validada, aparecem como indisponíveis — nunca como êxito
// ou grade parcial (CA-158).

import { compararIds } from './canonico';
import type { ExecucaoFinal } from './geracao';
import { POLICY_VERSION } from './politica';
import type { Diagnostico, ProvaNivel, Snapshot, StatusExecucao } from './tipos';

export interface ContextoFormulario {
  professores_ativos: number;
  respostas_enviadas: number;
  pendentes: number;
  professores_pendentes?: { id: string; nome: string }[];
  geracao_antecipada_confirmada: boolean;
}

const NOMES_NIVEL: Record<number, string> = {
  1: 'custo primário de preferências',
  2: 'maior média de penalidade por aula entre professores',
  3: 'amplitude entre as médias dos professores',
  4: 'desempate canônico',
};

function racionalTexto(r: unknown): string | null {
  if (!r || typeof r !== 'object') return null;
  const { num, den } = r as { num: number; den: number };
  return den === 1 ? String(num) : `${num}/${den}`;
}

// Mensagem administrativa derivada das evidências da execução (RN-60)
export function justificativa(e: Pick<ExecucaoFinal, 'status_final' | 'motivo_termino' | 'resultado' | 'diagnosticos' | 'encerrado_por_prazo'>) {
  const provas: ProvaNivel[] = e.resultado?.prova_por_nivel ?? [];
  const comprovados = provas.filter((p) => p.comprovado).map((p) => p.nivel);
  const pendentes = provas.filter((p) => !p.comprovado).map((p) => p.nivel);
  const listar = (ns: number[]) => ns.map((n) => NOMES_NIVEL[n]).join('; ');
  const limiteTempo = e.motivo_termino.startsWith('LIMITE_TEMPO');

  switch (e.status_final) {
    case 'OTIMA_COMPROVADA':
      return {
        titulo: 'Grade ótima comprovada',
        texto:
          'A grade cumpre todas as obrigações e restrições, foi aprovada pela validação independente do backend e ' +
          `teve comprovados os mínimos de: ${listar(comprovados)}.`,
        niveis_comprovados: comprovados,
        niveis_nao_comprovados: pendentes,
      };
    case 'VALIDA_NAO_OTIMA':
      return {
        titulo: 'Grade completa e válida, sem prova de ótimo',
        texto:
          'A grade é utilizável: cumpre todas as obrigações e foi aprovada pela validação independente. ' +
          (limiteTempo ? 'O limite de 600 segundos foi atingido antes de concluir as provas. ' : '') +
          (comprovados.length ? `Comprovados: ${listar(comprovados)}. ` : 'Nenhum nível da hierarquia foi comprovado. ') +
          `Não comprovados: ${listar(pendentes)}. A publicação de grade não ótima depende de autorização institucional ainda não homologada.`,
        niveis_comprovados: comprovados,
        niveis_nao_comprovados: pendentes,
      };
    case 'INCONCLUSIVA':
      return {
        titulo: 'Execução inconclusiva',
        texto:
          'Nenhuma grade completa foi encontrada e também não houve prova de inviabilidade' +
          (limiteTempo ? ' dentro do limite de 600 segundos' : '') +
          '. Isso não significa que montar a grade seja impossível.',
        niveis_comprovados: [],
        niveis_nao_comprovados: [1, 2, 3, 4],
      };
    case 'INVIAVEL_COMPROVADA': {
      const evidencias = e.diagnosticos.filter((d) => d.natureza_evidencia === 'comprovada' && d.severidade === 'erro');
      return {
        titulo: 'Inviabilidade comprovada',
        texto:
          'Foi demonstrado que nenhuma grade cumpre todas as obrigações e restrições. Evidência: ' +
          (evidencias.length ? evidencias.map((d) => d.mensagem).join(' | ') : 'busca completa esgotada') + '.',
        niveis_comprovados: [],
        niveis_nao_comprovados: [1, 2, 3, 4],
      };
    }
    case 'ENTRADA_INVALIDA':
      return {
        titulo: 'Dados de entrada rejeitados',
        texto:
          'A geração não foi executada porque os dados ou travas abaixo foram rejeitados na pré-validação. ' +
          'Não houve falha de otimização.',
        niveis_comprovados: [],
        niveis_nao_comprovados: [1, 2, 3, 4],
      };
    default: {
      const etapa = e.diagnosticos.find((d) => d.natureza_evidencia === 'falha_tecnica' || d.categoria === 'validacao_independente')?.etapa;
      return {
        titulo: 'Falha técnica na execução',
        texto:
          `A execução terminou por falha técnica${etapa ? ` na etapa ${etapa}` : ''}. ` +
          'Não se trata de inviabilidade da grade. Gere novamente; se persistir, acione o suporte com o identificador da execução.',
        niveis_comprovados: [],
        niveis_nao_comprovados: [1, 2, 3, 4],
      };
    }
  }
}

// Diagnóstico para a tela: sem detalhes técnicos internos (CA-192, CA-204, CA-210)
export function diagnosticoPublico(d: Diagnostico) {
  const { detalhe_tecnico: _oculto, ...publico } = d;
  return publico;
}

export function resumoPainel(
  s: Snapshot | null,
  e: (ExecucaoFinal & { status_execucao?: StatusExecucao }) | null,
  meta: { run_id: string; curso_id: string | null; periodo_letivo_id: string; status?: StatusExecucao },
  formulario: ContextoFormulario | null,
) {
  const emProcessamento = !e;
  const grade = e && e.grade_validada && e.resultado ? e.resultado : null;

  // Contagens a partir da MESMA grade canônica validada (CA-156, CA-157)
  const turmasComGrade = grade && s ? new Set(grade.ocupacoes.map((o) => o.turma_id)) : null;
  const turmasSemObrigacao = s
    ? s.turmas.filter((t) => !s.disciplinas.some((d) => d.semestre_id === t.semestre_id)).map((t) => t.id)
    : [];
  const professoresDistintos = grade ? new Set(grade.ocupacoes.map((o) => o.professor_id)).size : null;

  return {
    run_id: meta.run_id,
    curso_id: meta.curso_id,
    periodo_letivo_id: meta.periodo_letivo_id,
    snapshot_hash: s?.snapshot_hash ?? null,
    versao_do_modelo: e?.resultado_motor?.versao_motor ?? null,
    policy_version: POLICY_VERSION,
    // EM_PROCESSAMENTO é só estado de interface (ET-12)
    status: emProcessamento ? meta.status ?? 'EM_PROCESSAMENTO' : e!.status_final,
    status_final: emProcessamento ? null : e!.status_final,
    motivo_termino: e?.motivo_termino ?? null,
    duracao_execucao_segundos: e ? Math.round(e.duracao_execucao_ms) / 1000 : null,
    tempo_primeira_grade_segundos: e?.tempo_primeira_grade_ms != null ? e.tempo_primeira_grade_ms / 1000 : null,
    limite_execucao_segundos: s?.limite_execucao_segundos ?? null,
    total_turmas_abrangidas: s ? s.turmas.length : null,
    turmas_com_grade_validada: turmasComGrade && s
      ? s.turmas.filter((t) => turmasComGrade.has(t.id) || turmasSemObrigacao.includes(t.id)).length
      : null,
    professores_distintos_com_aulas_atribuidas: professoresDistintos,
    total_professores_participantes: s ? s.professores_participantes.length : null,
    professores_ativos: formulario?.professores_ativos ?? null,
    respostas_enviadas: formulario?.respostas_enviadas ?? null,
    pendentes_de_formulario: formulario?.pendentes ?? null,
    geracao_antecipada_confirmada: formulario?.geracao_antecipada_confirmada ?? false,
    custo_primario_total: grade ? grade.C : null,
    parcelas_penalidade: grade ? grade.parcelas : null,
    max_media_docente: grade ? racionalTexto(grade.max_M_p) : null,
    amplitude_medias: grade ? racionalTexto(grade.amplitude_M) : null,
    chave_canonica: grade ? grade.chave_canonica : null,
    prova_por_nivel: grade ? grade.prova_por_nivel : null,
    fonte_metricas: grade ? 'grade canônica validada pelo backend' : 'indisponível: sem grade completa validada',
    justificativa: e ? justificativa(e) : null,
    diagnosticos: (e?.diagnosticos ?? [])
      .map(diagnosticoPublico)
      .sort((a, b) => (a.severidade === b.severidade ? compararIds(a.codigo, b.codigo) : a.severidade === 'erro' ? -1 : 1)),
    candidato_recuperavel_disponivel: Boolean(e?.candidato_recuperavel),
    publicavel: Boolean(grade && e!.status_final === 'OTIMA_COMPROVADA'),
  };
}
