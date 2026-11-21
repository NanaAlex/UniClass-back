// Publicação atômica da grade (RN-29, RN-68, ET-16, CA-57, CA-58, CA-187,
// CA-188, CA-195, CA-216). Tudo numa transação:
//   1. trava o administrador e a execução (FOR UPDATE);
//   2. só OTIMA_COMPROVADA com grade validada é publicável — VALIDA_NAO_OTIMA
//      depende de autorização institucional ainda não homologada (seção 8);
//   3. remonta o snapshot com leituras FOR SHARE e exige o mesmo hash: dados
//      alterados depois da geração bloqueiam a publicação;
//   4. revalida a grade guardada contra o snapshot guardado;
//   5. grava geracao_horario/aula_alocada (tabelas já usadas pelas telas de
//      horário), substituindo a versão definitiva anterior de cada semestre.

import { hashSnapshot } from './hash';
import { buscarExecucao, marcarPublicada, type Executor } from './repositorio';
import { carregarDadosAdmin, montarSnapshotDeDados } from './snapshotMysql';
import type { Diagnostico } from './tipos';
import { validarResultado } from './validador';

export type ResultadoPublicacao =
  | { ok: true; geracoes: { id_semestre: number; id_geracao: number; numero_versao: number }[]; aulas: number }
  | { ok: false; status: 404 | 409; codigo: string; mensagem: string; diagnosticos?: Diagnostico[] };

async function linhas(ex: Executor, sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = (await ex.query(sql, params)) as [any[], unknown];
  return rows;
}

const recusa = (status: 404 | 409, codigo: string, mensagem: string, diagnosticos?: Diagnostico[]): ResultadoPublicacao =>
  ({ ok: false, status, codigo, mensagem, diagnosticos });

// Deve ser chamada com uma conexão em transação; o chamador faz commit/rollback.
export async function publicarExecucao(conexao: Executor, idAdmin: number, runId: string, idPublicador: number): Promise<ResultadoPublicacao> {
  await conexao.query('SELECT id_usuario FROM administrador WHERE id_usuario = ? FOR UPDATE', [idAdmin]);
  const exec = await buscarExecucao(conexao, idAdmin, runId, true);
  if (!exec) return recusa(404, 'EXECUCAO_INEXISTENTE', 'Execução não encontrada');
  if (exec.publicada_em) return recusa(409, 'JA_PUBLICADA', 'Esta grade já foi publicada');
  if (exec.status === 'VALIDA_NAO_OTIMA') {
    return recusa(409, 'PUBLICACAO_NAO_OTIMA_NAO_AUTORIZADA',
      'A publicação de grade válida não ótima depende de autorização institucional ainda não homologada (RN-29, CA-195)');
  }
  if (exec.status !== 'OTIMA_COMPROVADA' || !exec.grade_validada || !exec.resultado || !exec.snapshot) {
    return recusa(409, 'STATUS_NAO_PUBLICAVEL', `Execução com status ${exec.status} não pode ser publicada`);
  }

  // Versões vigentes: snapshot remontado com leitura bloqueante (ET-16)
  const consultar = (sql: string, params?: unknown[]) => linhas(conexao, sql, params);
  const dados = await carregarDadosAdmin(consultar, idAdmin, exec.periodo_letivo, true);
  const atual = montarSnapshotDeDados(dados, { runId: exec.run_id, periodoLetivo: exec.periodo_letivo });
  if (!atual.snapshot || hashSnapshot(atual.snapshot) !== exec.snapshot_hash) {
    return recusa(409, 'SNAPSHOT_DESATUALIZADO',
      'Respostas, configuração ou travas mudaram desde a geração; gere e valide novamente antes de publicar (CA-57, CA-187)');
  }

  // Revalidação na mesma transação (CA-188, CA-216)
  const v = validarResultado(exec.snapshot, exec.resultado);
  if (!v.aprovada) return recusa(409, 'REVALIDACAO_REPROVADA', 'A grade não passou na revalidação independente', v.erros);

  // Materialização nas tabelas existentes (uma linha por aula do bloco)
  const s = exec.snapshot;
  const diaLetivo = new Map((await linhas(conexao, 'SELECT id_dia_letivo, dia_semana, turno FROM dia_letivo WHERE id_admin = ?', [idAdmin]))
    .map((r) => [`${r.dia_semana}|${r.turno}`, r.id_dia_letivo]));
  const slots = new Map<string, number[]>();
  for (const r of await linhas(conexao,
    `SELECT b.turno, b.ordem, sl.id_slot FROM bloco_aula b JOIN slot_aula sl ON sl.id_bloco = b.id_bloco
      WHERE b.id_admin = ? ORDER BY b.turno, b.ordem, sl.numero_aula`, [idAdmin])) {
    const k = `${r.turno}|${r.ordem}`;
    slots.set(k, [...(slots.get(k) ?? []), r.id_slot]);
  }

  const semestreDaTurma = new Map(s.turmas.map((t) => [t.id, Number(t.semestre_id)]));
  const geracoes: { id_semestre: number; id_geracao: number; numero_versao: number }[] = [];
  for (const idSemestre of [...new Set(semestreDaTurma.values())].sort((a, b) => a - b)) {
    const [{ versao }] = await linhas(conexao,
      'SELECT COALESCE(MAX(numero_versao), 0) + 1 AS versao FROM geracao_horario WHERE id_semestre = ? FOR UPDATE', [idSemestre]);
    const anteriores = await linhas(conexao,
      "SELECT id_geracao FROM geracao_horario WHERE id_semestre = ? AND status = 'DEFINITIVO' ORDER BY numero_versao DESC", [idSemestre]);
    const [ins] = (await conexao.query(
      `INSERT INTO geracao_horario (id_semestre, id_admin, numero_versao, status, criada_em, definida_em, id_geracao_anterior, origem)
       VALUES (?, ?, ?, 'DEFINITIVO', NOW(), NOW(), ?, 'AUTOMATICA')`,
      [idSemestre, idAdmin, versao, anteriores.length ? anteriores[0].id_geracao : null])) as [{ insertId: number }, unknown];
    if (anteriores.length) {
      await conexao.query("UPDATE geracao_horario SET status = 'SUBSTITUIDO' WHERE id_semestre = ? AND status = 'DEFINITIVO' AND id_geracao <> ?",
        [idSemestre, ins.insertId]);
    }
    geracoes.push({ id_semestre: idSemestre, id_geracao: ins.insertId, numero_versao: Number(versao) });
  }

  const geracaoDoSemestre = new Map(geracoes.map((g) => [g.id_semestre, g.id_geracao]));
  let aulas = 0;
  for (const o of exec.resultado.ocupacoes) {
    const idDia = diaLetivo.get(`${o.dia}|${o.turno}`);
    const idsSlot = slots.get(`${o.turno}|${o.indice}`);
    if (!idDia || !idsSlot || idsSlot.length !== s.K) {
      return recusa(409, 'ESTRUTURA_DIVERGENTE', 'Estrutura de dias/blocos diverge do snapshot publicado');
    }
    for (const idSlot of idsSlot) {
      await conexao.query(
        `INSERT INTO aula_alocada (id_geracao, id_turma, id_materia, id_professor, id_dia_letivo, id_slot, bloqueada, origem)
         VALUES (?, ?, ?, ?, ?, ?, FALSE, 'AUTOMATICA')`,
        [geracaoDoSemestre.get(semestreDaTurma.get(o.turma_id)!), Number(o.turma_id), Number(o.disciplina_id), Number(o.professor_id), idDia, idSlot]);
      aulas++;
    }
  }

  await marcarPublicada(conexao, runId, idPublicador);
  return { ok: true, geracoes, aulas };
}
