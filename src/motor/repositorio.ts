// Persistência das execuções do motor e das travas (RN-23, RN-31, RN-49,
// RN-66, RN-68, ET-16). Tabelas da migration 005: execucao_geracao e
// trava_geracao. Snapshot, resultado do motor e validação ficam gravados
// para auditoria; a execução publicada nunca é sobrescrita.

import type { ExecucaoFinal } from './geracao';
import type { ContextoFormulario } from './painel';
import type { CamposGrade, Diagnostico, Snapshot, StatusExecucao, Trava } from './tipos';

export interface Executor {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

async function linhas(ex: Executor, sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = (await ex.query(sql, params)) as [any[], unknown];
  return rows;
}

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const lerJson = <T>(v: unknown): T | null => (v === null || v === undefined ? null : ((typeof v === 'string' ? JSON.parse(v) : v) as T));

export interface ExecucaoRegistrada {
  run_id: string;
  id_admin: number;
  curso_id: string;
  periodo_letivo: string;
  id_formulario: number | null;
  snapshot_hash: string | null;
  snapshot: Snapshot | null;
  status: StatusExecucao;
  motivo_termino: string | null;
  grade_validada: boolean;
  resultado: ExecucaoFinal['resultado_motor'];
  validacao: ExecucaoFinal['validacao'];
  diagnosticos: Diagnostico[];
  candidato_recuperavel: CamposGrade | null;
  contexto_formulario: ContextoFormulario | null;
  confirmacao_antecipada: boolean;
  grade_base_run_id: string | null;
  duracao_ms: number | null;
  tempo_primeira_grade_ms: number | null;
  iniciada_em: string;
  concluida_em: string | null;
  publicada_em: string | null;
}

function deLinha(r: any): ExecucaoRegistrada {
  return {
    run_id: r.run_id,
    id_admin: r.id_admin,
    curso_id: r.curso_id,
    periodo_letivo: r.periodo_letivo,
    id_formulario: r.id_formulario,
    snapshot_hash: r.snapshot_hash,
    snapshot: lerJson<Snapshot>(r.snapshot),
    status: r.status,
    motivo_termino: r.motivo_termino,
    grade_validada: r.grade_validada === 1 || r.grade_validada === true,
    resultado: lerJson(r.resultado),
    validacao: lerJson(r.validacao),
    diagnosticos: lerJson<Diagnostico[]>(r.diagnosticos) ?? [],
    candidato_recuperavel: lerJson<CamposGrade>(r.candidato_recuperavel),
    contexto_formulario: lerJson<ContextoFormulario>(r.contexto_formulario),
    confirmacao_antecipada: r.confirmacao_antecipada === 1 || r.confirmacao_antecipada === true,
    grade_base_run_id: r.grade_base_run_id,
    duracao_ms: r.duracao_ms,
    tempo_primeira_grade_ms: r.tempo_primeira_grade_ms,
    iniciada_em: r.iniciada_em,
    concluida_em: r.concluida_em,
    publicada_em: r.publicada_em,
  };
}

export async function inserirExecucao(
  ex: Executor,
  e: {
    run_id: string; id_admin: number; curso_id: string; periodo_letivo: string; id_formulario: number | null;
    snapshot: Snapshot | null; status: StatusExecucao; diagnosticos: Diagnostico[]; contexto_formulario: ContextoFormulario;
    confirmacao_antecipada: boolean; grade_base_run_id: string | null; id_responsavel: number;
  },
) {
  await ex.query(
    `INSERT INTO execucao_geracao
       (run_id, id_admin, curso_id, periodo_letivo, id_formulario, snapshot_hash, snapshot, status, diagnosticos,
        contexto_formulario, confirmacao_antecipada, grade_base_run_id, id_responsavel, iniciada_em, concluida_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), IF(? = 'EM_PROCESSAMENTO', NULL, NOW(3)))`,
    [e.run_id, e.id_admin, e.curso_id, e.periodo_letivo, e.id_formulario, e.snapshot?.snapshot_hash ?? null, json(e.snapshot),
      e.status, json(e.diagnosticos), json(e.contexto_formulario), e.confirmacao_antecipada, e.grade_base_run_id, e.id_responsavel, e.status],
  );
}

// Candidato recuperável preservado durante a execução (RN-66, CA-175)
export async function salvarCandidato(ex: Executor, runId: string, candidato: CamposGrade) {
  await ex.query(`UPDATE execucao_geracao SET candidato_recuperavel = ? WHERE run_id = ? AND status = 'EM_PROCESSAMENTO'`, [json(candidato), runId]);
}

export async function concluirExecucao(ex: Executor, runId: string, f: ExecucaoFinal) {
  await ex.query(
    `UPDATE execucao_geracao
        SET status = ?, motivo_termino = ?, grade_validada = ?, resultado = ?, validacao = ?, diagnosticos = ?,
            candidato_recuperavel = ?, versao_motor = ?, policy_version = ?,
            duracao_ms = ?, tempo_primeira_grade_ms = ?, concluida_em = NOW(3)
      WHERE run_id = ? AND status = 'EM_PROCESSAMENTO'`,
    [f.status_final, f.motivo_termino, f.grade_validada, json(f.resultado_motor), json(f.validacao), json(f.diagnosticos),
      json(f.candidato_recuperavel), f.resultado_motor?.versao_motor ?? null, f.resultado_motor?.policy_version ?? null,
      f.duracao_execucao_ms, f.tempo_primeira_grade_ms, runId],
  );
}

export async function buscarExecucao(ex: Executor, idAdmin: number, runId: string, bloquear = false): Promise<ExecucaoRegistrada | null> {
  const rows = await linhas(ex, `SELECT * FROM execucao_geracao WHERE run_id = ? AND id_admin = ?${bloquear ? ' FOR UPDATE' : ''}`, [runId, idAdmin]);
  return rows.length ? deLinha(rows[0]) : null;
}

export async function listarExecucoes(ex: Executor, idAdmin: number, periodo: string | null) {
  const rows = await linhas(
    ex,
    `SELECT run_id, periodo_letivo, status, motivo_termino, grade_validada, grade_base_run_id, duracao_ms,
            iniciada_em, concluida_em, publicada_em
       FROM execucao_geracao
      WHERE id_admin = ? ${periodo ? 'AND periodo_letivo = ?' : ''}
      ORDER BY iniciada_em DESC
      LIMIT 100`,
    periodo ? [idAdmin, periodo] : [idAdmin],
  );
  return rows.map((r) => ({ ...r, grade_validada: r.grade_validada === 1 || r.grade_validada === true }));
}

export async function existeEmProcessamento(ex: Executor, idAdmin: number): Promise<boolean> {
  const rows = await linhas(ex, `SELECT 1 FROM execucao_geracao WHERE id_admin = ? AND status = 'EM_PROCESSAMENTO' LIMIT 1`, [idAdmin]);
  return rows.length > 0;
}

export interface TravaRegistrada {
  trava: Trava;
  acao_origem: string;
  id_acao: string;
  grade_base_run_id: string;
  id_responsavel: number;
  criada_em: string;
}

export async function listarTravas(ex: Executor, idAdmin: number, periodo: string): Promise<TravaRegistrada[]> {
  const rows = await linhas(
    ex,
    `SELECT id_trava, tipo, dados, acao_origem, id_acao, grade_base_run_id, grade_base_hash, id_responsavel, criada_em
       FROM trava_geracao WHERE id_admin = ? AND periodo_letivo = ? ORDER BY id_trava`,
    [idAdmin, periodo],
  );
  return rows.map((r) => {
    const dados = lerJson<{ alvo: unknown; valor_fixo: unknown }>(r.dados)!;
    return {
      trava: { id: String(r.id_trava), tipo: r.tipo, origem_versao: r.grade_base_hash, alvo: dados.alvo, valor_fixo: dados.valor_fixo ?? null } as Trava,
      acao_origem: r.acao_origem,
      id_acao: r.id_acao,
      grade_base_run_id: r.grade_base_run_id,
      id_responsavel: r.id_responsavel,
      criada_em: r.criada_em,
    };
  });
}

// Travas com responsável, ação de origem e grade-base (RN-49, CA-189)
export async function inserirTravas(
  ex: Executor,
  dados: { id_admin: number; periodo: string; travas: Trava[]; acao: string; id_acao: string; grade_base_run_id: string; id_responsavel: number },
) {
  for (const t of dados.travas) {
    await ex.query(
      `INSERT INTO trava_geracao
         (id_admin, periodo_letivo, tipo, dados, acao_origem, id_acao, grade_base_run_id, grade_base_hash, id_responsavel, criada_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [dados.id_admin, dados.periodo, t.tipo, json({ alvo: t.alvo, valor_fixo: t.valor_fixo }), dados.acao, dados.id_acao,
        dados.grade_base_run_id, t.origem_versao, dados.id_responsavel],
    );
  }
}

// Execuções deixadas em processamento por reinício do servidor: falha
// técnica, preservando o candidato recuperável (RN-66)
export async function encerrarExecucoesOrfas(ex: Executor) {
  await ex.query(
    `UPDATE execucao_geracao
        SET status = 'ERRO_EXECUCAO', motivo_termino = 'SUPERVISOR_INTERROMPIDO', concluida_em = NOW(3),
            diagnosticos = JSON_ARRAY(JSON_OBJECT('categoria', 'falha_tecnica', 'codigo', 'SUPERVISOR_INTERROMPIDO',
              'severidade', 'erro', 'etapa', 'supervisao', 'natureza_evidencia', 'falha_tecnica', 'entidades', JSON_OBJECT(),
              'mensagem', 'O servidor foi reiniciado durante a execução; não se trata de inviabilidade'))
      WHERE status = 'EM_PROCESSAMENTO' AND iniciada_em < NOW(3) - INTERVAL 11 MINUTE`,
  );
}

export async function marcarPublicada(ex: Executor, runId: string, idPublicador: number) {
  await ex.query(`UPDATE execucao_geracao SET publicada_em = NOW(), id_publicador = ? WHERE run_id = ?`, [idPublicador, runId]);
}
