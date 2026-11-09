// Validação independente do resultado (RN-28, RN-67, CA-56, CA-147, CA-173,
// CA-174). Recalcula, a partir do snapshot e das ocupações, todas as
// restrições obrigatórias e todos os valores da hierarquia; status, prova ou
// custo declarados pelo motor não são aceitos por simples declaração.

import { chaveCanonica, chaveCoordenada, chavePosicao, compararIds } from './canonico';
import { hashSnapshot } from './hash';
import { parcelasBloco, POLICY_VERSION, SCHEMA_RESULTADO, TETO_AULAS_PROFESSOR, VERSAO_MOTOR_ESPERADA } from './politica';
import * as Q from './racional';
import type { Diagnostico, Ocupacao, ResultadoMotor, Snapshot, StatusFinal } from './tipos';
import { STATUS_FINAIS } from './tipos';

export interface ContextoSupervisor {
  // O supervisor encerrou o processo pelo prazo (o motor não concluiu sozinho)
  encerradoPorPrazo?: boolean;
}

export interface Recomputo {
  C: number;
  parcelas: { dia_turno: number; disciplina: number };
  porProfessor: { professor_id: string; aulas: number; custo: number; media: Q.Racional | null }[];
  totais: { turma_id: string; disciplina_id: string; aulas: number }[];
  maxM: Q.Racional | null;
  minM: Q.Racional | null;
  amplitude: Q.Racional | null;
  chave: string;
}

export interface ResultadoValidacao {
  aprovada: boolean;
  erros: Diagnostico[];
  recomputo: Recomputo | null;
}

const STATUS_COM_GRADE: ReadonlySet<StatusFinal> = new Set(['OTIMA_COMPROVADA', 'VALIDA_NAO_OTIMA']);

function falha(codigo: string, mensagem: string, entidades: Record<string, unknown> = {}): Diagnostico {
  return {
    categoria: 'validacao_independente',
    codigo,
    severidade: 'erro',
    etapa: 'validacao_independente',
    mensagem,
    entidades,
    natureza_evidencia: 'comprovada',
  };
}

// Restrições obrigatórias da grade completa (RN-05, RN-08, RN-11, RN-15,
// RN-16, RN-19, RN-20, RN-21, travas RN-41 a RN-45, RN-54, RN-55).
export function validarGrade(s: Snapshot, ocupacoes: Ocupacao[]): Diagnostico[] {
  const erros: Diagnostico[] = [];
  const K = s.K;
  const turmas = new Map(s.turmas.map((t) => [t.id, t]));
  const disciplinas = new Map(s.disciplinas.map((d) => [d.id, d]));
  const professores = new Map(
    s.professores_participantes.map((p) => [
      p.id,
      {
        disciplinas: new Map(p.disciplinas_selecionadas_e_notas.map((d) => [d.disciplina_id, d.nota])),
        blocos: new Set(p.blocos_selecionados.map(chaveCoordenada)),
      },
    ]),
  );
  const quantidade = new Map(s.blocos_por_dia_turno.map((b) => [`${b.dia}|${b.turno}`, b.quantidade]));

  const posicoes = new Set<string>();
  const professorCoord = new Map<string, string>();
  const blocosObrigacao = new Map<string, number>();
  const responsaveis = new Map<string, Set<string>>();
  const blocosProfessor = new Map<string, number>();

  for (const o of ocupacoes) {
    const ent = { turma_id: o.turma_id, disciplina_id: o.disciplina_id, professor_id: o.professor_id, dia: o.dia, turno: o.turno, indice: o.indice };
    const turma = turmas.get(o.turma_id);
    const disc = disciplinas.get(o.disciplina_id);
    const prof = professores.get(o.professor_id);
    if (!turma) { erros.push(falha('TURMA_INEXISTENTE', 'Ocupação em turma ausente do snapshot', ent)); continue; }
    if (!disc) { erros.push(falha('DISCIPLINA_INEXISTENTE', 'Ocupação com disciplina ausente do snapshot', ent)); continue; }
    if (!prof) { erros.push(falha('PROFESSOR_NAO_PARTICIPANTE', 'Ocupação com professor fora dos participantes (RN-20)', ent)); continue; }
    if ((quantidade.get(`${o.dia}|${o.turno}`) ?? 0) < o.indice || !Number.isInteger(o.indice) || o.indice < 1) {
      erros.push(falha('BLOCO_INEXISTENTE', 'Ocupação em bloco inexistente (CA-11)', ent));
      continue;
    }
    if (o.turno !== turma.turno) erros.push(falha('TURNO_INCOMPATIVEL', 'Aula fora do turno da turma (RN-05)', ent));
    if (disc.semestre_id !== turma.semestre_id) erros.push(falha('DISCIPLINA_FORA_DO_SEMESTRE', 'Disciplina não pertence ao semestre da turma (RN-06)', ent));
    if (!prof.disciplinas.has(o.disciplina_id)) erros.push(falha('DISCIPLINA_NAO_SELECIONADA', 'Professor sem seleção da disciplina (RN-15, CA-20)', ent));
    if (!prof.blocos.has(chaveCoordenada(o))) erros.push(falha('BLOCO_NAO_SELECIONADO', 'Professor em bloco não selecionado (RN-16, CA-22)', ent));

    const pos = chavePosicao(o.turma_id, o);
    if (posicoes.has(pos)) erros.push(falha('CONFLITO_TURMA', 'Duas aulas na mesma posição da turma (RN-21, CA-35)', ent));
    posicoes.add(pos);

    const pc = `${o.professor_id}#${chaveCoordenada(o)}`;
    const outraTurma = professorCoord.get(pc);
    if (outraTurma !== undefined && outraTurma !== o.turma_id) {
      erros.push(falha('CONFLITO_PROFESSOR', 'Professor em duas turmas na mesma coordenada (RN-21, CA-34)', ent));
    }
    professorCoord.set(pc, o.turma_id);

    const ob = `${o.turma_id}|${o.disciplina_id}`;
    blocosObrigacao.set(ob, (blocosObrigacao.get(ob) ?? 0) + 1);
    if (!responsaveis.has(ob)) responsaveis.set(ob, new Set());
    responsaveis.get(ob)!.add(o.professor_id);
    blocosProfessor.set(o.professor_id, (blocosProfessor.get(o.professor_id) ?? 0) + 1);
  }

  // Carga exata por turma–disciplina e um único responsável (RN-08, RN-19)
  for (const t of s.turmas) {
    for (const d of s.disciplinas) {
      if (d.semestre_id !== t.semestre_id) continue;
      const ob = `${t.id}|${d.id}`;
      const aulas = (blocosObrigacao.get(ob) ?? 0) * K;
      if (aulas !== d.carga_aulas) {
        erros.push(falha('CARGA_DIVERGENTE', `Turma–disciplina com ${aulas} aulas; exigidas ${d.carga_aulas} (RN-08, CA-07, CA-08)`,
          { turma_id: t.id, disciplina_id: d.id }));
      }
      const resp = responsaveis.get(ob);
      if (resp && resp.size > 1) {
        erros.push(falha('RESPONSAVEL_MULTIPLO', 'Mais de um professor na mesma turma–disciplina (RN-19, CA-30)',
          { turma_id: t.id, disciplina_id: d.id, professores: [...resp].sort(compararIds) }));
      }
    }
  }
  // Teto de 40 aulas e mínimo de uma disciplina por participante (RN-20)
  for (const p of s.professores_participantes) {
    const blocos = blocosProfessor.get(p.id) ?? 0;
    if (blocos * K > TETO_AULAS_PROFESSOR) {
      erros.push(falha('TETO_EXCEDIDO', `Professor com ${blocos * K} aulas, acima de ${TETO_AULAS_PROFESSOR} (RN-20, CA-33)`, { professor_id: p.id }));
    }
    if (blocos === 0) {
      erros.push(falha('PARTICIPANTE_SEM_DISCIPLINA', 'Participante sem nenhuma disciplina atribuída (RN-20, CA-32, CA-133)', { professor_id: p.id }));
    }
  }

  // Travas (CA-93 a CA-99, CA-147, CA-148)
  const porPosicao = new Map(ocupacoes.map((o) => [chavePosicao(o.turma_id, o), o]));
  for (const tr of s.travas) {
    if (tr.tipo === 'ocupacao') {
      const o = porPosicao.get(chavePosicao(tr.alvo.turma_id, tr.alvo));
      if (!o || o.disciplina_id !== tr.valor_fixo.disciplina_id || o.professor_id !== tr.valor_fixo.professor_id) {
        erros.push(falha('TRAVA_VIOLADA', 'Bloco ocupado travado não foi preservado (RN-42, CA-96)', { trava_id: tr.id }));
      }
    } else if (tr.tipo === 'vaga_turma') {
      if (porPosicao.has(chavePosicao(tr.alvo.turma_id, tr.alvo))) {
        erros.push(falha('TRAVA_VIOLADA', 'Aula em vaga travada da turma (RN-54, CA-147)', { trava_id: tr.id }));
      }
    } else if (tr.tipo === 'vaga_professor') {
      if (professorCoord.has(`${tr.alvo.professor_id}#${chaveCoordenada(tr.alvo)}`)) {
        erros.push(falha('TRAVA_VIOLADA', 'Professor alocado em vaga travada da sua grade (RN-55, CA-147)', { trava_id: tr.id }));
      }
    } else {
      for (const t of s.turmas) {
        if (t.semestre_id !== tr.alvo.semestre_id) continue;
        const resp = responsaveis.get(`${t.id}|${tr.alvo.disciplina_id}`);
        if (!resp || resp.size !== 1 || !resp.has(tr.valor_fixo.professor_id)) {
          erros.push(falha('TRAVA_VIOLADA', 'Fixação disciplina–professor não respeitada na turma (RN-43, CA-99)',
            { trava_id: tr.id, turma_id: t.id }));
        }
      }
    }
  }

  return erros;
}

export function recomputar(s: Snapshot, ocupacoes: Ocupacao[]): Recomputo {
  const K = s.K;
  const notasDisc = new Map<string, number>();
  const notasDT = new Map<string, number>();
  for (const p of s.professores_participantes) {
    for (const d of p.disciplinas_selecionadas_e_notas) notasDisc.set(`${p.id}|${d.disciplina_id}`, d.nota);
    for (const n of p.notas_dia_turno) notasDT.set(`${p.id}|${n.dia}|${n.turno}`, n.nota);
  }

  let C = 0;
  let parcelaDT = 0;
  let parcelaD = 0;
  const porProf = new Map<string, { aulas: number; custo: number }>();
  for (const p of s.professores_participantes) porProf.set(p.id, { aulas: 0, custo: 0 });

  for (const o of ocupacoes) {
    const notaD = notasDisc.get(`${o.professor_id}|${o.disciplina_id}`);
    const notaDT = notasDT.get(`${o.professor_id}|${o.dia}|${o.turno}`);
    if (notaD === undefined || notaDT === undefined) continue; // violação já reportada por validarGrade
    const parc = parcelasBloco(K, notaDT, notaD);
    C += parc.total;
    parcelaDT += parc.diaTurno;
    parcelaD += parc.disciplina;
    const acc = porProf.get(o.professor_id);
    if (acc) {
      acc.aulas += K;
      acc.custo += parc.total;
    }
  }

  const porProfessor = [...porProf.entries()]
    .sort(([a], [b]) => compararIds(a, b))
    .map(([professor_id, v]) => ({ professor_id, ...v, media: v.aulas > 0 ? Q.racional(v.custo, v.aulas) : null }));
  const medias = porProfessor.map((p) => p.media).filter((m): m is Q.Racional => m !== null);
  const maxM = Q.maximo(medias);
  const minM = Q.minimo(medias);
  const amplitude = maxM && minM ? Q.subtrair(maxM, minM) : null;

  const totais: Recomputo['totais'] = [];
  const contagem = new Map<string, number>();
  for (const o of ocupacoes) contagem.set(`${o.turma_id}|${o.disciplina_id}`, (contagem.get(`${o.turma_id}|${o.disciplina_id}`) ?? 0) + 1);
  for (const t of [...s.turmas].sort((a, b) => compararIds(a.id, b.id))) {
    for (const d of [...s.disciplinas].sort((a, b) => compararIds(a.id, b.id))) {
      if (d.semestre_id !== t.semestre_id) continue;
      totais.push({ turma_id: t.id, disciplina_id: d.id, aulas: (contagem.get(`${t.id}|${d.id}`) ?? 0) * K });
    }
  }

  return {
    C,
    parcelas: { dia_turno: parcelaDT, disciplina: parcelaD },
    porProfessor,
    totais,
    maxM,
    minM,
    amplitude,
    chave: chaveCanonica(s, ocupacoes),
  };
}

function racionalIgual(declarado: unknown, esperado: Q.Racional | null): boolean {
  if (esperado === null) return declarado === null;
  if (declarado === null || typeof declarado !== 'object') return false;
  const d = declarado as { num?: unknown; den?: unknown };
  if (!Number.isInteger(d.num) || !Number.isInteger(d.den) || (d.den as number) <= 0) return false;
  return Q.iguais(Q.racional(d.num as number, d.den as number), esperado);
}

export function validarResultado(s: Snapshot, r: ResultadoMotor, ctx: ContextoSupervisor = {}): ResultadoValidacao {
  const erros: Diagnostico[] = [];

  // Vínculo com o snapshot, a política e o motor (RN-67, CA-174)
  if (r.schema_version !== SCHEMA_RESULTADO) erros.push(falha('SCHEMA_RESULTADO_INCOMPATIVEL', 'schema_version do resultado não reconhecida'));
  if (r.run_id !== s.run_id) erros.push(falha('RUN_ID_DIVERGENTE', 'Resultado não pertence a esta execução', { esperado: s.run_id, recebido: r.run_id }));
  if (r.snapshot_hash !== s.snapshot_hash) erros.push(falha('SNAPSHOT_DIVERGENTE', 'Resultado vinculado a outro snapshot (CA-121)'));
  if (hashSnapshot(s) !== s.snapshot_hash) erros.push(falha('SNAPSHOT_ADULTERADO', 'O hash do snapshot não confere com o conteúdo (RN-23)'));
  if (r.policy_version !== POLICY_VERSION) erros.push(falha('POLITICA_INCOMPATIVEL', 'Política aplicada difere da homologada (CA-174)', { recebida: r.policy_version }));
  if (r.versao_motor !== VERSAO_MOTOR_ESPERADA) erros.push(falha('VERSAO_MOTOR_INCOMPATIVEL', 'Versão do motor não homologada', { recebida: r.versao_motor }));
  if (!(STATUS_FINAIS as readonly string[]).includes(r.status)) {
    erros.push(falha('STATUS_INVALIDO', 'Status fora dos seis estados finais (RN-27)', { status: r.status }));
    return { aprovada: false, erros, recomputo: null };
  }

  const idsTravas = s.travas.map((t) => t.id).sort(compararIds);
  const aplicadas = [...(r.travas_aplicadas ?? [])].sort(compararIds);
  if (STATUS_COM_GRADE.has(r.status) && JSON.stringify(idsTravas) !== JSON.stringify(aplicadas)) {
    erros.push(falha('TRAVAS_NAO_APLICADAS', 'O motor não declarou a aplicação de todas as travas do snapshot (RN-49)'));
  }

  // Prazo esgotado não prova ótimo nem inviabilidade (RN-27, CA-54, CA-173)
  if (ctx.encerradoPorPrazo && (r.status === 'OTIMA_COMPROVADA' || r.status === 'INVIAVEL_COMPROVADA')) {
    erros.push(falha('PROVA_INCOMPATIVEL_COM_PRAZO', `Execução encerrada por prazo não pode declarar ${r.status} (CA-173)`));
  }

  const provas = Array.isArray(r.prova_por_nivel) ? r.prova_por_nivel : [];
  const estruturaProvaOk =
    provas.length === 4 &&
    provas.every((p, i) => p.nivel === i + 1 && typeof p.comprovado === 'boolean' && (p.estado === 'COMPROVADO') === p.comprovado);
  if (!estruturaProvaOk) erros.push(falha('PROVA_MALFORMADA', 'prova_por_nivel deve trazer os quatro níveis em ordem (CA-73)'));

  if (!STATUS_COM_GRADE.has(r.status)) {
    if ((r.ocupacoes?.length ?? 0) > 0 || r.C !== null || r.chave_canonica !== null) {
      erros.push(falha('GRADE_EM_STATUS_SEM_GRADE', `Status ${r.status} não pode apresentar grade ou custo final (CA-158)`));
    }
    if (provas.some((p) => p.comprovado)) {
      erros.push(falha('PROVA_INCOMPATIVEL', `Status ${r.status} não pode declarar níveis comprovados`));
    }
    return { aprovada: erros.length === 0, erros, recomputo: null };
  }

  // Grade completa: restrições obrigatórias e recomputação dos objetivos
  const ocupacoes = Array.isArray(r.ocupacoes) ? r.ocupacoes : [];
  erros.push(...validarGrade(s, ocupacoes));
  const rc = recomputar(s, ocupacoes);

  if (r.C !== rc.C) erros.push(falha('CUSTO_DIVERGENTE', 'Custo primário declarado difere do recomputado (CA-56, CA-159)', { declarado: r.C, recomputado: rc.C }));
  if (!r.parcelas || r.parcelas.dia_turno !== rc.parcelas.dia_turno || r.parcelas.disciplina !== rc.parcelas.disciplina) {
    erros.push(falha('PARCELAS_DIVERGENTES', 'Parcelas de penalidade divergentes (CA-159)'));
  }
  const declaradoPorProf = new Map((r.aulas_por_professor ?? []).map((p) => [p.professor_id, p]));
  for (const p of rc.porProfessor) {
    const d = declaradoPorProf.get(p.professor_id);
    if (!d || d.aulas !== p.aulas || d.custo !== p.custo) {
      erros.push(falha('CUSTO_PROFESSOR_DIVERGENTE', 'C_p ou A_p declarados divergem do recomputado (CA-56)', { professor_id: p.professor_id }));
    }
  }
  if (declaradoPorProf.size !== rc.porProfessor.length) erros.push(falha('CUSTO_PROFESSOR_DIVERGENTE', 'Lista de professores divergente'));
  if (!racionalIgual(r.max_M_p, rc.maxM)) erros.push(falha('MEDIA_MAXIMA_DIVERGENTE', 'max M_p declarado difere do recomputado (CA-56)'));
  if (!racionalIgual(r.min_M_p, rc.minM)) erros.push(falha('MEDIA_MINIMA_DIVERGENTE', 'min M_p declarado difere do recomputado'));
  if (!racionalIgual(r.amplitude_M, rc.amplitude)) erros.push(falha('AMPLITUDE_DIVERGENTE', 'Amplitude declarada difere da recomputada (CA-56)'));
  if (r.chave_canonica !== rc.chave) erros.push(falha('CHAVE_CANONICA_DIVERGENTE', 'Chave canônica difere da recomputada pelo comparador comum (RN-61, CA-168)'));

  // Provas vinculadas à execução (RN-67, ET-13, CA-51, CA-52, CA-74)
  if (estruturaProvaOk) {
    for (let i = 1; i < 4; i++) {
      if (provas[i].comprovado && !provas[i - 1].comprovado) {
        erros.push(falha('PROVA_FORA_DA_HIERARQUIA', `Nível ${i + 1} comprovado sem o nível ${i} (RN-32)`));
      }
    }
    const valores: [unknown, unknown, unknown, unknown] = [provas[0].valor, provas[1].valor, provas[2].valor, provas[3].valor];
    if (valores[0] !== rc.C) erros.push(falha('PROVA_VALOR_DIVERGENTE', 'Valor do nível 1 difere do custo recomputado'));
    if (!racionalIgual(valores[1], rc.maxM)) erros.push(falha('PROVA_VALOR_DIVERGENTE', 'Valor do nível 2 difere da maior média recomputada'));
    if (!racionalIgual(valores[2], rc.amplitude)) erros.push(falha('PROVA_VALOR_DIVERGENTE', 'Valor do nível 3 difere da amplitude recomputada'));
    if (valores[3] !== rc.chave) erros.push(falha('PROVA_VALOR_DIVERGENTE', 'Valor do nível 4 difere da chave recomputada'));

    const todos = provas.every((p) => p.comprovado);
    if (r.status === 'OTIMA_COMPROVADA') {
      if (!todos) erros.push(falha('OTIMO_SEM_PROVA', 'OTIMA_COMPROVADA exige prova de todos os níveis (RN-27, CA-51, CA-173)'));
      if (r.motivo_termino !== 'BUSCA_CONCLUIDA' || (r.limites_atingidos ?? []).length > 0) {
        erros.push(falha('OTIMO_APOS_LIMITE', 'Ótimo declarado após limite de execução (RN-67, CA-215)'));
      }
    }
    if (r.status === 'VALIDA_NAO_OTIMA' && todos && !ctx.encerradoPorPrazo) {
      erros.push(falha('STATUS_SUBDECLARADO', 'Todos os níveis comprovados exigem OTIMA_COMPROVADA'));
    }
  }

  return { aprovada: erros.length === 0, erros, recomputo: rc };
}
