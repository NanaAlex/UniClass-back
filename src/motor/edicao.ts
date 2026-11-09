// Camada de edição e bloqueio sobre uma grade-base validada (RN-40 a RN-45,
// RN-52 a RN-58, RN-64, ET-08 a ET-11). Cada ação vira travas primitivas
// (ocupacao, vaga_turma, vaga_professor, fixacao_disciplina_professor),
// vinculadas ao hash da grade-base. Nenhuma ação remove travas: não há
// desbloqueio no período vigente (seção 8 da especificação).

import { randomUUID } from 'crypto';
import { chaveCoordenada, chavePosicao, coordenadasDoCalendario } from './canonico';
import { validarSnapshot } from './contrato';
import { TETO_AULAS_PROFESSOR } from './politica';
import type { Coordenada, Diagnostico, Ocupacao, Snapshot, Trava, TravaFixacao } from './tipos';

export type AcaoEdicao =
  | { acao: 'bloquear_grade_turma'; turma_id: string }
  | { acao: 'bloquear_grade_professor'; professor_id: string }
  | { acao: 'bloquear_bloco_turma'; turma_id: string; dia: string; turno: string; indice: number }
  | { acao: 'bloquear_bloco_professor'; professor_id: string; dia: string; turno: string; indice: number }
  | { acao: 'fixar_disciplina_professor_semestre'; semestre_id: string; disciplina_id: string; professor_id: string }
  | { acao: 'trocar_posicoes'; origem: Coordenada & { turma_id: string }; destino: Coordenada & { turma_id: string } };

export interface GradeBase {
  run_id: string;
  snapshot: Snapshot; // snapshot da execução que gerou a grade-base
  ocupacoes: Ocupacao[]; // grade completa validada
  hash_grade: string; // hash da grade-base (origem_versao das travas)
}

export type ResultadoEdicao =
  | { ok: true; novas: Trava[]; ignoradas: number }
  | { ok: false; status: 400 | 409; erros: Diagnostico[] };

const CAMPOS_ACAO: Record<string, string[]> = {
  bloquear_grade_turma: ['acao', 'turma_id'],
  bloquear_grade_professor: ['acao', 'professor_id'],
  bloquear_bloco_turma: ['acao', 'turma_id', 'dia', 'turno', 'indice'],
  bloquear_bloco_professor: ['acao', 'professor_id', 'dia', 'turno', 'indice'],
  fixar_disciplina_professor_semestre: ['acao', 'semestre_id', 'disciplina_id', 'professor_id'],
  trocar_posicoes: ['acao', 'origem', 'destino'],
};

function erro(codigo: string, mensagem: string, entidades: Record<string, unknown> = {}): Diagnostico {
  return { categoria: 'edicao', codigo, severidade: 'erro', etapa: 'edicao', mensagem, entidades, natureza_evidencia: 'comprovada' };
}

const recusa = (status: 400 | 409, ...erros: Diagnostico[]): ResultadoEdicao => ({ ok: false, status, erros });

// Validação estrita do corpo (CA-201): só os campos fixos de cada ação
export function lerAcao(corpo: unknown): { acao?: AcaoEdicao; erro?: Diagnostico } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: erro('ACAO_INVALIDA', 'Corpo da ação inválido') };
  const c = corpo as Record<string, any>;
  const campos = CAMPOS_ACAO[c.acao];
  if (!campos) return { erro: erro('ACAO_DESCONHECIDA', 'Ação de edição não prevista (ET-08)', { acao: c.acao }) };
  const extras = Object.keys(c).filter((k) => !campos.includes(k));
  if (extras.length) return { erro: erro('CAMPO_DESCONHECIDO', `Campos não previstos: ${extras.join(', ')} (CA-201)`) };
  const faltando = campos.filter((k) => c[k] === undefined || c[k] === null || c[k] === '');
  if (faltando.length) return { erro: erro('CAMPO_AUSENTE', `Campos obrigatórios: ${faltando.join(', ')}`) };
  if (c.acao === 'trocar_posicoes') {
    for (const lado of ['origem', 'destino']) {
      const p = c[lado];
      const ok = p && typeof p === 'object' && Object.keys(p).sort().join(',') === 'dia,indice,turma_id,turno';
      // A troca recebe coordenadas completas do bloco, nunca índice de aula interna (ET-11)
      if (!ok) return { erro: erro('COORDENADA_INVALIDA', `${lado} deve ter exatamente turma_id, dia, turno e indice (ET-11)`) };
    }
  }
  return { acao: c as AcaoEdicao };
}

function coordenadaExiste(s: Snapshot, c: { dia: string; turno: string; indice: number }) {
  return coordenadasDoCalendario(s).some((x) => x.dia === c.dia && x.turno === c.turno && x.indice === c.indice);
}

function travaOcupacao(base: GradeBase, o: Ocupacao): Trava {
  return {
    id: randomUUID(),
    tipo: 'ocupacao',
    origem_versao: base.hash_grade,
    alvo: { turma_id: o.turma_id, dia: o.dia, turno: o.turno, indice: o.indice },
    valor_fixo: { disciplina_id: o.disciplina_id, professor_id: o.professor_id },
  };
}

function travaVagaTurma(base: GradeBase, turma_id: string, c: Coordenada): Trava {
  return { id: randomUUID(), tipo: 'vaga_turma', origem_versao: base.hash_grade, alvo: { turma_id, dia: c.dia, turno: c.turno, indice: c.indice }, valor_fixo: null };
}

function travaVagaProfessor(base: GradeBase, professor_id: string, c: Coordenada): Trava {
  return { id: randomUUID(), tipo: 'vaga_professor', origem_versao: base.hash_grade, alvo: { professor_id, dia: c.dia, turno: c.turno, indice: c.indice }, valor_fixo: null };
}

// Identidade lógica da trava (ignora id e origem) para não duplicar
function assinatura(t: Trava): string {
  return JSON.stringify([t.tipo, t.alvo, t.valor_fixo]);
}

export function aplicarAcao(base: GradeBase, existentes: Trava[], acao: AcaoEdicao): ResultadoEdicao {
  const s = base.snapshot;
  const porPosicao = new Map(base.ocupacoes.map((o) => [chavePosicao(o.turma_id, o), o]));
  const turma = (id: string) => s.turmas.find((t) => t.id === id);
  const professor = (id: string) => s.professores_participantes.find((p) => p.id === id);
  let novas: Trava[] = [];

  switch (acao.acao) {
    case 'bloquear_grade_turma': {
      // RN-41, CA-93: ocupações e vagas de todas as coordenadas da turma
      const t = turma(acao.turma_id);
      if (!t) return recusa(400, erro('TURMA_INEXISTENTE', 'Turma fora da grade-base', { turma_id: acao.turma_id }));
      for (const c of coordenadasDoCalendario(s).filter((x) => x.turno === t.turno)) {
        const o = porPosicao.get(chavePosicao(t.id, c));
        novas.push(o ? travaOcupacao(base, o) : travaVagaTurma(base, t.id, c));
      }
      break;
    }
    case 'bloquear_grade_professor': {
      // RN-41, CA-94: aulas do professor e todas as coordenadas em que não leciona
      if (!professor(acao.professor_id)) {
        return recusa(400, erro('PROFESSOR_INEXISTENTE', 'Professor fora da grade-base', { professor_id: acao.professor_id }));
      }
      const doProf = new Map(base.ocupacoes.filter((o) => o.professor_id === acao.professor_id).map((o) => [chaveCoordenada(o), o]));
      for (const c of coordenadasDoCalendario(s)) {
        const o = doProf.get(chaveCoordenada(c));
        novas.push(o ? travaOcupacao(base, o) : travaVagaProfessor(base, acao.professor_id, c));
      }
      break;
    }
    case 'bloquear_bloco_turma': {
      // RN-42, RN-54, CA-128: bloco ocupado ou vaga existente da turma
      const t = turma(acao.turma_id);
      const c = { dia: acao.dia, turno: acao.turno, indice: acao.indice } as Coordenada;
      if (!t) return recusa(400, erro('TURMA_INEXISTENTE', 'Turma fora da grade-base', { turma_id: acao.turma_id }));
      if (!coordenadaExiste(s, c) || c.turno !== t.turno) {
        return recusa(400, erro('POSICAO_INEXISTENTE', 'Posição inexistente ou de turno incompatível com a turma (RN-54, CA-128)', { ...c }));
      }
      const o = porPosicao.get(chavePosicao(t.id, c));
      novas.push(o ? travaOcupacao(base, o) : travaVagaTurma(base, t.id, c));
      break;
    }
    case 'bloquear_bloco_professor': {
      // RN-42, RN-55, CA-98: aula do professor (espelhada na turma) ou vaga docente
      const c = { dia: acao.dia, turno: acao.turno, indice: acao.indice } as Coordenada;
      if (!professor(acao.professor_id)) {
        return recusa(400, erro('PROFESSOR_INEXISTENTE', 'Professor fora da grade-base', { professor_id: acao.professor_id }));
      }
      if (!coordenadaExiste(s, c)) return recusa(400, erro('POSICAO_INEXISTENTE', 'Coordenada inexistente (RN-42)', { ...c }));
      const o = base.ocupacoes.find((x) => x.professor_id === acao.professor_id && chaveCoordenada(x) === chaveCoordenada(c));
      novas.push(o ? travaOcupacao(base, o) : travaVagaProfessor(base, acao.professor_id, c));
      break;
    }
    case 'fixar_disciplina_professor_semestre': {
      // RN-43, CA-99 a CA-106: verificações antes de aceitar a fixação
      const p = professor(acao.professor_id);
      const d = s.disciplinas.find((x) => x.id === acao.disciplina_id && x.semestre_id === acao.semestre_id);
      if (!d) return recusa(400, erro('DISCIPLINA_INEXISTENTE', 'Disciplina inexistente no semestre', { ...acao }));
      if (!p) return recusa(400, erro('PROFESSOR_INEXISTENTE', 'Professor fora dos participantes', { professor_id: acao.professor_id }));
      if (!p.disciplinas_selecionadas_e_notas.some((x) => x.disciplina_id === d.id)) {
        return recusa(409, erro('DISCIPLINA_NAO_SELECIONADA', 'O professor não selecionou a disciplina; a fixação não pode liberá-la (CA-105)', { ...acao }));
      }
      const turmas = s.turmas.filter((t) => t.semestre_id === acao.semestre_id);
      const r = d.carga_aulas / s.K;
      const erros: Diagnostico[] = [];
      for (const t of turmas) {
        const compativeis = p.blocos_selecionados.filter((b) => b.turno === t.turno).length;
        if (compativeis < r) {
          erros.push(erro('CAPACIDADE_INSUFICIENTE', `O professor tem ${compativeis} blocos compatíveis e a disciplina exige ${r} na turma (CA-102)`,
            { turma_id: t.id, disciplina_id: d.id, professor_id: p.id }));
        }
        for (const ex of existentes) {
          if (ex.tipo === 'ocupacao' && ex.alvo.turma_id === t.id && ex.valor_fixo.disciplina_id === d.id && ex.valor_fixo.professor_id !== p.id) {
            erros.push(erro('CONFLITO_TRAVA', 'Há bloco travado desta disciplina com outro professor (CA-103, CA-104)', { turma_id: t.id, trava_id: ex.id }));
          }
        }
      }
      const fixadas = existentes.filter((ex): ex is TravaFixacao =>
        ex.tipo === 'fixacao_disciplina_professor' && ex.valor_fixo.professor_id === p.id && ex.alvo.disciplina_id !== d.id);
      const aulasFixadas = fixadas.reduce((soma, ex) => {
        const dx = s.disciplinas.find((x) => x.id === ex.alvo.disciplina_id);
        const n = s.turmas.filter((t) => t.semestre_id === ex.alvo.semestre_id).length;
        return soma + (dx ? dx.carga_aulas * n : 0);
      }, 0);
      const total = aulasFixadas + d.carga_aulas * turmas.length;
      if (total > TETO_AULAS_PROFESSOR) {
        erros.push(erro('TETO_EXCEDIDO', `As fixações somariam ${total} aulas para o professor (teto ${TETO_AULAS_PROFESSOR}, CA-106)`, { professor_id: p.id }));
      }
      if (erros.length) return recusa(409, ...erros);
      novas.push({
        id: randomUUID(),
        tipo: 'fixacao_disciplina_professor',
        origem_versao: base.hash_grade,
        alvo: { semestre_id: acao.semestre_id, disciplina_id: d.id },
        valor_fixo: { professor_id: p.id },
      });
      break;
    }
    case 'trocar_posicoes': {
      // RN-45, RN-53, RN-56, RN-64, ET-09: só na MESMA turma, em qualquer visão
      const { origem, destino } = acao;
      if (origem.turma_id !== destino.turma_id) {
        return recusa(409, erro('TROCA_ENTRE_TURMAS', 'Troca entre turmas diferentes não é permitida, inclusive pela visão do professor (RN-64, CA-127, CA-185)',
          { origem_turma_id: origem.turma_id, destino_turma_id: destino.turma_id }));
      }
      const t = turma(origem.turma_id);
      if (!t) return recusa(400, erro('TURMA_INEXISTENTE', 'Turma fora da grade-base', { turma_id: origem.turma_id }));
      for (const c of [origem, destino]) {
        if (!coordenadaExiste(s, c) || c.turno !== t.turno) {
          return recusa(400, erro('DESTINO_PROIBIDO', 'Posição inexistente, em dia não letivo ou fora do turno da turma (CA-110)', { ...c }));
        }
      }
      if (chaveCoordenada(origem) === chaveCoordenada(destino)) return recusa(400, erro('TROCA_SEM_EFEITO', 'Origem e destino são a mesma posição'));
      const oOrig = porPosicao.get(chavePosicao(t.id, origem));
      const oDest = porPosicao.get(chavePosicao(t.id, destino));
      if (!oOrig && !oDest) return recusa(400, erro('TROCA_SEM_EFEITO', 'As duas posições estão vazias'));

      // Posições já travadas não podem ser movidas (RN-45: trava anterior)
      const travada = (c: Coordenada) =>
        existentes.find((ex) => (ex.tipo === 'ocupacao' || ex.tipo === 'vaga_turma') && ex.alvo.turma_id === t.id && chaveCoordenada(ex.alvo) === chaveCoordenada(c));
      for (const c of [origem, destino]) {
        const ex = travada(c);
        if (ex) return recusa(409, erro('POSICAO_TRAVADA', 'A posição já está bloqueada; a troca contradiria a trava (RN-45, RN-46)', { trava_id: ex.id, ...c }));
      }
      // O bloco inteiro (K aulas) muda de posição; o professor precisa ter
      // selecionado o bloco de destino (RN-16, RN-45)
      const mover = (o: Ocupacao | undefined, para: Coordenada): Ocupacao | undefined =>
        o && { ...o, dia: para.dia, turno: para.turno, indice: para.indice };
      const novoDestino = mover(oOrig, destino);
      const novaOrigem = mover(oDest, origem);
      for (const o of [novoDestino, novaOrigem]) {
        if (!o) continue;
        const p = professor(o.professor_id);
        if (!p || !p.blocos_selecionados.some((b) => chaveCoordenada(b) === chaveCoordenada(o))) {
          return recusa(409, erro('PROFESSOR_INDISPONIVEL', 'O professor não selecionou o bloco de destino (RN-16, RN-45)',
            { professor_id: o.professor_id, dia: o.dia, turno: o.turno, indice: o.indice }));
        }
        const bloqueioDocente = existentes.find((ex) => ex.tipo === 'vaga_professor' && ex.alvo.professor_id === o.professor_id && chaveCoordenada(ex.alvo) === chaveCoordenada(o));
        const travadoEmOutraTurma = existentes.find((ex) => ex.tipo === 'ocupacao' && ex.valor_fixo.professor_id === o.professor_id
          && ex.alvo.turma_id !== t.id && chaveCoordenada(ex.alvo) === chaveCoordenada(o));
        if (bloqueioDocente || travadoEmOutraTurma) {
          return recusa(409, erro('CONFLITO_TRAVA', 'O professor está bloqueado nessa coordenada (RN-55, RN-45)',
            { professor_id: o.professor_id, trava_id: (bloqueioDocente ?? travadoEmOutraTurma)!.id }));
        }
      }
      // Ao confirmar, as duas posições resultantes ficam bloqueadas (CA-109, CA-111, CA-139)
      novas = [
        novoDestino ? travaOcupacao(base, novoDestino) : travaVagaTurma(base, t.id, destino),
        novaOrigem ? travaOcupacao(base, novaOrigem) : travaVagaTurma(base, t.id, origem),
      ];
      break;
    }
  }

  // Sem duplicar travas já existentes; o conjunto resultante deve ser
  // compatível com o snapshot (sem contradições, RN-46, RN-49, CA-125)
  const existentesAss = new Set(existentes.map(assinatura));
  const unicas = novas.filter((t, i) => !existentesAss.has(assinatura(t)) && novas.findIndex((x) => assinatura(x) === assinatura(t)) === i);
  const conjunto = [...existentes, ...unicas];
  const v = validarSnapshot({ ...s, travas: conjunto }, { permitirLimiteDeTeste: true });
  const contraditorias = v.diagnosticos.filter((d) => d.codigo.startsWith('TRAVA') || d.codigo === 'TRAVAS_CONTRADITORIAS');
  if (contraditorias.length) return recusa(409, ...contraditorias);
  return { ok: true, novas: unicas, ignoradas: novas.length - unicas.length };
}
