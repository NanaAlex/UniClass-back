// Montagem do snapshot imutável de uma geração a partir do banco (RN-23,
// RN-34, RN-36, RN-37, ET-01, ET-06). Separado em duas partes:
//   carregarDadosAdmin  — consultas SQL (escopo do administrador = curso);
//   montarSnapshotDeDados — mapeamento puro, testado sem banco.
//
// Decisões de mapeamento do modelo existente para o contrato v2.7:
// - curso: o escopo de dados do sistema é o administrador (semestres, turmas,
//   disciplinas, dias e blocos são dele); curso_id = curso ativo do admin ou
//   "adm-<id>" quando não há registro em `curso`;
// - período: informado na geração; entram os semestres ativos sem período
//   definido ou com o mesmo período (semestre.periodo_letivo);
// - K: bloco_aula.qtd_aulas precisa ser único em todos os turnos (RN-09);
// - bloco ordinal: (dia_letivo, bloco_aula.ordem); horários de relógio do
//   cadastro existente não entram no modelo (RN-10, RN-35);
// - disponibilidade: o bloco só é selecionado se todas as suas aulas
//   (slot_aula) estiverem disponíveis; seleção parcial vira aviso (RN-16);
// - participantes: professores ativos e vinculados com resposta ENVIADA ao
//   formulário vigente (o mais recente); LIBERADA_PARA_ALTERACAO conta como
//   pendente (RN-20, RN-22, RN-37).

import { hashSnapshot } from './hash';
import { LIMITE_EXECUCAO_SEGUNDOS, politicaDoSnapshot, SCHEMA_SNAPSHOT } from './politica';
import type { ContextoFormulario } from './painel';
import type { Coordenada, Dia, Diagnostico, Snapshot, Trava, Turno } from './tipos';

export type Consultar = (sql: string, params?: unknown[]) => Promise<any[]>;

export interface DadosAdmin {
  idAdmin: number;
  cursos: { id_curso: number }[];
  formulario: { id_formulario: number; status: string } | null;
  semestres: { id_semestre: number; periodo_letivo: string | null }[];
  turmas: { id_turma: number; id_semestre: number; turno: string }[];
  materias: { id_materia: number; id_semestre: number; qtd_aulas_semana: number; qtd_professores: number }[];
  dias: { id_dia_letivo: number; dia_semana: string; turno: string }[];
  blocos: { id_bloco: number; turno: string; ordem: number; qtd_aulas: number }[];
  slots: { id_slot: number; id_bloco: number; numero_aula: number }[];
  professores: { id_usuario: number; nome: string }[];
  respostas: { id_resposta: number; id_professor: number; status: string }[];
  interesses: { id_resposta: number; id_materia: number; nota_interesse: number }[];
  disponibilidades: { id_resposta: number; id_dia_letivo: number; id_slot: number; disponivel: number | boolean }[];
  preferencias: { id_resposta: number; id_dia_letivo: number; nota: number }[];
  travas: { id_trava: number; tipo: string; dados: unknown; grade_base_hash: string }[];
}

export interface SnapshotMontado {
  snapshot: Snapshot | null;
  erros: Diagnostico[];
  avisos: Diagnostico[];
  formulario: ContextoFormulario;
}

export const PERIODO_VALIDO = /^\d{4}\/[12]$/;

function diag(severidade: 'erro' | 'aviso', codigo: string, mensagem: string, entidades: Record<string, unknown> = {}): Diagnostico {
  return {
    categoria: severidade === 'erro' ? 'entrada_invalida' : 'aviso',
    codigo,
    severidade,
    etapa: 'montagem_snapshot',
    mensagem,
    entidades,
    natureza_evidencia: 'comprovada',
  };
}

// Consultas filtradas por administrador (= curso) e período (RN-70, ET-18).
// Com bloquear=true, as leituras usam FOR SHARE: na transação de publicação,
// as linhas lidas ficam travadas contra escrita até o commit (ET-16).
export async function carregarDadosAdmin(consultar: Consultar, idAdmin: number, periodo: string, bloquear = false): Promise<DadosAdmin> {
  const trava = bloquear ? ' FOR SHARE' : '';
  const filtroPeriodo = '(s.periodo_letivo IS NULL OR s.periodo_letivo = ?)';
  const cursos = await consultar(`SELECT id_curso FROM curso WHERE id_admin = ? AND ativo = TRUE ORDER BY id_curso${trava}`, [idAdmin]);
  const formularios = await consultar(
    `SELECT id_formulario, status FROM formulario WHERE id_admin = ? ORDER BY id_formulario DESC LIMIT 1${trava}`, [idAdmin]);
  const formulario = formularios.length ? formularios[0] : null;
  const semestres = await consultar(
    `SELECT s.id_semestre, s.periodo_letivo FROM semestre s WHERE s.id_admin = ? AND s.ativo = TRUE AND ${filtroPeriodo}${trava}`,
    [idAdmin, periodo]);
  const turmas = await consultar(
    `SELECT t.id_turma, t.id_semestre, t.turno
       FROM turma t JOIN semestre s ON s.id_semestre = t.id_semestre
      WHERE s.id_admin = ? AND s.ativo = TRUE AND t.ativo = TRUE AND ${filtroPeriodo}${trava}`,
    [idAdmin, periodo]);
  const materias = await consultar(
    `SELECT m.id_materia, m.id_semestre, m.qtd_aulas_semana, m.qtd_professores
       FROM materia m JOIN semestre s ON s.id_semestre = m.id_semestre
      WHERE s.id_admin = ? AND s.ativo = TRUE AND m.ativo = TRUE AND ${filtroPeriodo}${trava}`,
    [idAdmin, periodo]);
  const dias = await consultar(`SELECT id_dia_letivo, dia_semana, turno FROM dia_letivo WHERE id_admin = ?${trava}`, [idAdmin]);
  const blocos = await consultar(`SELECT id_bloco, turno, ordem, qtd_aulas FROM bloco_aula WHERE id_admin = ?${trava}`, [idAdmin]);
  const slots = await consultar(
    `SELECT sl.id_slot, sl.id_bloco, sl.numero_aula FROM slot_aula sl JOIN bloco_aula b ON b.id_bloco = sl.id_bloco WHERE b.id_admin = ?${trava}`,
    [idAdmin]);
  const professores = await consultar(
    `SELECT u.id_usuario, u.nome
       FROM vinculo_professor_admin v JOIN usuario u ON u.id_usuario = v.id_professor
      WHERE v.id_admin = ? AND v.ativo = TRUE AND u.ativo = TRUE AND u.tipo_usuario = 'PROFESSOR'${trava}`,
    [idAdmin]);
  const idForm = formulario ? formulario.id_formulario : -1;
  const respostas = await consultar(`SELECT id_resposta, id_professor, status FROM resposta_formulario WHERE id_formulario = ?${trava}`, [idForm]);
  const interesses = await consultar(
    `SELECT i.id_resposta, i.id_materia, i.nota_interesse
       FROM interesse_materia i JOIN resposta_formulario r ON r.id_resposta = i.id_resposta
      WHERE r.id_formulario = ?${trava}`, [idForm]);
  const disponibilidades = await consultar(
    `SELECT d.id_resposta, d.id_dia_letivo, d.id_slot, d.disponivel
       FROM disponibilidade_horario d JOIN resposta_formulario r ON r.id_resposta = d.id_resposta
      WHERE r.id_formulario = ?${trava}`, [idForm]);
  const preferencias = await consultar(
    `SELECT p.id_resposta, p.id_dia_letivo, p.nota
       FROM preferencia_turno p JOIN resposta_formulario r ON r.id_resposta = p.id_resposta
      WHERE r.id_formulario = ?${trava}`, [idForm]);
  // Travas só do período (expiram com ele: RN-39, RN-50, CA-130, CA-131)
  const travas = await consultar(
    `SELECT id_trava, tipo, dados, grade_base_hash FROM trava_geracao WHERE id_admin = ? AND periodo_letivo = ? ORDER BY id_trava${trava}`,
    [idAdmin, periodo]);
  return { idAdmin, cursos, formulario, semestres, turmas, materias, dias, blocos, slots, professores, respostas, interesses, disponibilidades, preferencias, travas };
}

const TURNOS = new Set(['MANHA', 'TARDE', 'NOITE']);
const DIAS = new Set(['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO']);

export function montarSnapshotDeDados(d: DadosAdmin, opcoes: { runId: string; periodoLetivo: string }): SnapshotMontado {
  const erros: Diagnostico[] = [];
  const avisos: Diagnostico[] = [];

  // Formulário vigente e participantes (RN-20, RN-22, RN-36, RN-37)
  const enviadas = new Map(d.respostas.filter((r) => r.status === 'ENVIADA').map((r) => [r.id_professor, r.id_resposta]));
  const participantes = d.professores.filter((p) => enviadas.has(p.id_usuario));
  const pendentes = d.professores.filter((p) => !enviadas.has(p.id_usuario));
  const formulario: ContextoFormulario = {
    professores_ativos: d.professores.length,
    respostas_enviadas: participantes.length,
    pendentes: pendentes.length,
    professores_pendentes: pendentes.map((p) => ({ id: String(p.id_usuario), nome: p.nome })),
    geracao_antecipada_confirmada: false,
  };
  if (!d.formulario) erros.push(diag('erro', 'FORMULARIO_INEXISTENTE', 'Nenhum formulário foi publicado; não há respostas para gerar a grade (ET-01)'));

  // K global e estrutura ordinal dos blocos (RN-09, RN-10, RN-11, RN-35)
  const ks = [...new Set(d.blocos.map((b) => b.qtd_aulas))];
  if (d.blocos.length === 0) erros.push(diag('erro', 'SEM_BLOCOS', 'Não há blocos de aulas cadastrados'));
  if (ks.length > 1) {
    erros.push(diag('erro', 'K_NAO_GLOBAL', `Os blocos têm quantidades de aulas diferentes (${ks.sort().join(', ')}); K deve ser único em todos os turnos (RN-09)`, { valores: ks }));
  }
  const K = ks.length === 1 ? ks[0] : 0;
  const blocosPorTurno = new Map<string, typeof d.blocos>();
  for (const b of d.blocos) blocosPorTurno.set(b.turno, [...(blocosPorTurno.get(b.turno) ?? []), b]);
  for (const [turno, bs] of blocosPorTurno) {
    const ordens = bs.map((b) => b.ordem).sort((a, b) => a - b);
    if (ordens.some((o, i) => o !== i + 1)) {
      erros.push(diag('erro', 'ORDEM_BLOCOS_INVALIDA', 'Os blocos do turno devem ter índices 1..n sem lacunas (RN-35)', { turno, ordens }));
    }
  }
  const slotsPorBloco = new Map<number, number[]>();
  for (const s of d.slots) slotsPorBloco.set(s.id_bloco, [...(slotsPorBloco.get(s.id_bloco) ?? []), s.id_slot]);
  for (const b of d.blocos) {
    const n = (slotsPorBloco.get(b.id_bloco) ?? []).length;
    if (n !== b.qtd_aulas) erros.push(diag('erro', 'AULAS_DO_BLOCO_INCONSISTENTES', `Bloco com ${n} aulas cadastradas para qtd_aulas=${b.qtd_aulas}`, { turno: b.turno, indice: b.ordem }));
  }

  // Calendário: cada dia letivo do turno tem todos os blocos do turno
  const diasValidos = d.dias.filter((x) => DIAS.has(x.dia_semana) && TURNOS.has(x.turno));
  const blocosDT = diasValidos
    .filter((x) => (blocosPorTurno.get(x.turno) ?? []).length > 0)
    .map((x) => ({ dia: x.dia_semana as Dia, turno: x.turno as Turno, quantidade: blocosPorTurno.get(x.turno)!.length }));
  const diaPorId = new Map(diasValidos.map((x) => [x.id_dia_letivo, x]));

  // Turmas e disciplinas do período (RN-04 a RN-07)
  const semestres = new Set(d.semestres.map((s) => s.id_semestre));
  const turmas = d.turmas.filter((t) => semestres.has(t.id_semestre));
  const materias = d.materias.filter((m) => semestres.has(m.id_semestre));
  for (const m of materias) {
    if (m.qtd_professores !== 1) {
      avisos.push(diag('aviso', 'CODOCENCIA_IGNORADA',
        `A disciplina indica ${m.qtd_professores} professores; a v2.7 exige um único responsável por turma–disciplina (RN-19)`,
        { disciplina_id: String(m.id_materia) }));
    }
  }
  const materiasIds = new Set(materias.map((m) => m.id_materia));

  // Respostas → seleções e notas (RN-15 a RN-18)
  const professores = participantes.map((p) => {
    const idResp = enviadas.get(p.id_usuario)!;
    const disponiveis = new Set(
      d.disponibilidades.filter((x) => x.id_resposta === idResp && (x.disponivel === true || x.disponivel === 1)).map((x) => `${x.id_dia_letivo}|${x.id_slot}`));
    const blocos: Coordenada[] = [];
    for (const dia of diasValidos) {
      for (const b of blocosPorTurno.get(dia.turno) ?? []) {
        const slots = slotsPorBloco.get(b.id_bloco) ?? [];
        const marcados = slots.filter((sl) => disponiveis.has(`${dia.id_dia_letivo}|${sl}`)).length;
        if (slots.length > 0 && marcados === slots.length) {
          blocos.push({ dia: dia.dia_semana as Dia, turno: dia.turno as Turno, indice: b.ordem });
        } else if (marcados > 0) {
          avisos.push(diag('aviso', 'BLOCO_PARCIALMENTE_SELECIONADO',
            'Professor disponível em parte das aulas do bloco; o bloco é indivisível e foi tratado como não selecionado (RN-11, RN-16)',
            { professor_id: String(p.id_usuario), dia: dia.dia_semana, turno: dia.turno, indice: b.ordem }));
        }
      }
    }
    const notas = d.preferencias
      .filter((x) => x.id_resposta === idResp)
      .map((x) => ({ x, dia: diaPorId.get(x.id_dia_letivo) }))
      .filter(({ dia }) => dia && (blocosPorTurno.get(dia.turno) ?? []).length > 0)
      .map(({ x, dia }) => ({ dia: dia!.dia_semana as Dia, turno: dia!.turno as Turno, nota: x.nota }));
    return {
      id: String(p.id_usuario),
      disciplinas_selecionadas_e_notas: d.interesses
        .filter((x) => x.id_resposta === idResp && materiasIds.has(x.id_materia))
        .map((x) => ({ disciplina_id: String(x.id_materia), nota: x.nota_interesse })),
      blocos_selecionados: blocos,
      notas_dia_turno: notas,
    };
  });

  // Travas do período, vinculadas à grade-base de origem (RN-49, RN-50)
  const travas: Trava[] = d.travas.map((t) => {
    const dados = (typeof t.dados === 'string' ? JSON.parse(t.dados) : t.dados) as { alvo: unknown; valor_fixo: unknown };
    return { id: String(t.id_trava), tipo: t.tipo, origem_versao: t.grade_base_hash, alvo: dados.alvo, valor_fixo: dados.valor_fixo ?? null } as Trava;
  });

  if (erros.length > 0) return { snapshot: null, erros, avisos, formulario };

  const s: Snapshot = {
    schema_version: SCHEMA_SNAPSHOT,
    run_id: opcoes.runId,
    curso_id: d.cursos.length === 1 ? String(d.cursos[0].id_curso) : `adm-${d.idAdmin}`,
    periodo_letivo_id: opcoes.periodoLetivo,
    form_version: String(d.formulario!.id_formulario),
    snapshot_hash: '',
    K,
    turnos: [...new Set(blocosDT.map((b) => b.turno))],
    dias_letivos: [...new Set(blocosDT.map((b) => b.dia))],
    blocos_por_dia_turno: blocosDT,
    turmas: turmas.map((t) => ({ id: String(t.id_turma), semestre_id: String(t.id_semestre), turno: t.turno as Turno })),
    disciplinas: materias.map((m) => ({ id: String(m.id_materia), semestre_id: String(m.id_semestre), carga_aulas: m.qtd_aulas_semana })),
    professores_participantes: professores,
    travas,
    politica: politicaDoSnapshot(),
    limite_execucao_segundos: LIMITE_EXECUCAO_SEGUNDOS,
  };
  if (d.cursos.length > 1) {
    avisos.push(diag('aviso', 'VARIOS_CURSOS', 'O administrador tem mais de um curso ativo; o escopo da geração é o conjunto de dados do administrador (RN-34)'));
  }
  return { snapshot: { ...s, snapshot_hash: hashSnapshot(s) }, erros, avisos, formulario };
}
