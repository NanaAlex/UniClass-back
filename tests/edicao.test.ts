// Edição e bloqueios sobre grade-base validada (RN-40 a RN-45, RN-53 a RN-58,
// RN-64, ET-08 a ET-11, CA-93, CA-94, CA-97, CA-98, CA-102, CA-105 a CA-111,
// CA-127, CA-128, CA-139, CA-141, CA-142, CA-145, CA-146, CA-153, CA-185,
// CA-186, AUD-003).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aplicarAcao, lerAcao, type GradeBase } from '../src/motor/edicao';
import { hashTexto } from '../src/motor/hash';
import type { Trava } from '../src/motor/tipos';
import { comHash, montarSnapshot, prof, todos } from './apoio/fabrica';
import { resolver, resumoOcupacoes } from './apoio/motor';

const snap = () =>
  montarSnapshot({
    K: 2,
    blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'NOITE', 2]],
    turmas: [['TA', 'S1', 'NOITE'], ['TB', 'S1', 'NOITE']],
    disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
    professores: [
      prof('P1', [['D1', 5], ['D2', 4]], [...todos('SEGUNDA', 'NOITE', 2), ...todos('TERCA', 'NOITE', 2)]),
      prof('P2', [['D1', 3], ['D2', 5]], [...todos('SEGUNDA', 'NOITE', 2), ['TERCA', 'NOITE', 1]], 4),
    ],
  });

async function gradeBase(): Promise<GradeBase> {
  const s = comHash({ ...snap(), limite_execucao_segundos: 30 });
  const e = await resolver(s, 30);
  assert.equal(e.status_final, 'OTIMA_COMPROVADA');
  return { run_id: s.run_id, snapshot: s, ocupacoes: e.resultado!.ocupacoes, hash_grade: hashTexto(e.resultado!.chave_canonica!) };
}

describe('Ações de edição → travas', async () => {
  const base = await gradeBase();
  const ocA = base.ocupacoes.filter((o) => o.turma_id === 'TA');

  it('CA-201: ação com campos extras ou ação desconhecida é rejeitada', () => {
    assert.equal(lerAcao({ acao: 'desbloquear', turma_id: 'TA' }).erro?.codigo, 'ACAO_DESCONHECIDA');
    assert.equal(lerAcao({ acao: 'bloquear_grade_turma', turma_id: 'TA', peso: 1 }).erro?.codigo, 'CAMPO_DESCONHECIDO');
  });

  it('ET-11: troca recebe coordenada completa do bloco, nunca aula interna', () => {
    const r = lerAcao({ acao: 'trocar_posicoes', origem: { turma_id: 'TA', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, aula: 2 }, destino: { turma_id: 'TA', dia: 'TERCA', turno: 'NOITE', indice: 1 } });
    assert.equal(r.erro?.codigo, 'COORDENADA_INVALIDA');
  });

  it('CA-93/CA-148: bloqueio integral da turma fixa ocupações e vagas de todas as posições', () => {
    const r = aplicarAcao(base, [], { acao: 'bloquear_grade_turma', turma_id: 'TA' });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.novas.length, 4);
    assert.equal(r.novas.filter((t) => t.tipo === 'ocupacao').length, ocA.length);
    assert.equal(r.novas.filter((t) => t.tipo === 'vaga_turma').length, 4 - ocA.length);
    assert.ok(r.novas.every((t) => t.origem_versao === base.hash_grade));
  });

  it('CA-94: bloqueio integral do professor fixa aulas e vagas em todas as coordenadas', () => {
    const r = aplicarAcao(base, [], { acao: 'bloquear_grade_professor', professor_id: 'P1' });
    assert.ok(r.ok);
    if (!r.ok) return;
    const aulas = base.ocupacoes.filter((o) => o.professor_id === 'P1').length;
    assert.equal(r.novas.filter((t) => t.tipo === 'ocupacao').length, aulas);
    assert.equal(r.novas.filter((t) => t.tipo === 'vaga_professor').length, 4 - aulas);
  });

  it('CA-97/CA-128/CA-141: bloqueio pontual de vaga da turma; posição inexistente é recusada', () => {
    const vazia = (['SEGUNDA', 'TERCA'] as const).flatMap((dia) => [1, 2].map((indice) => ({ dia, indice })))
      .find((c) => !ocA.some((o) => o.dia === c.dia && o.indice === c.indice))!;
    const r = aplicarAcao(base, [], { acao: 'bloquear_bloco_turma', turma_id: 'TA', dia: vazia.dia, turno: 'NOITE', indice: vazia.indice });
    assert.ok(r.ok && r.novas[0].tipo === 'vaga_turma');
    const x = aplicarAcao(base, [], { acao: 'bloquear_bloco_turma', turma_id: 'TA', dia: 'SEGUNDA', turno: 'NOITE', indice: 9 });
    assert.ok(!x.ok && x.erros[0].codigo === 'POSICAO_INEXISTENTE');
  });

  it('CA-98/CA-142: bloqueio pontual na visão docente (aula espelhada ou vaga do professor)', () => {
    const aula = base.ocupacoes.find((o) => o.professor_id === 'P2')!;
    const r1 = aplicarAcao(base, [], { acao: 'bloquear_bloco_professor', professor_id: 'P2', dia: aula.dia, turno: aula.turno, indice: aula.indice });
    assert.ok(r1.ok && r1.novas[0].tipo === 'ocupacao' && r1.novas[0].alvo.turma_id === aula.turma_id);
  });

  it('AUD-003/CA-127/CA-185: troca entre turmas é recusada sem gerar travas', () => {
    const r = aplicarAcao(base, [], {
      acao: 'trocar_posicoes',
      origem: { turma_id: 'TA', dia: 'SEGUNDA', turno: 'NOITE', indice: 1 },
      destino: { turma_id: 'TB', dia: 'SEGUNDA', turno: 'NOITE', indice: 1 },
    });
    assert.ok(!r.ok && r.status === 409 && r.erros[0].codigo === 'TROCA_ENTRE_TURMAS');
  });

  it('CA-109/CA-145/CA-146/CA-153: troca com vaga move o bloco inteiro e bloqueia as duas posições', () => {
    const o = ocA.find((x) => x.professor_id === 'P1') ?? ocA[0];
    const vazia = (['SEGUNDA', 'TERCA'] as const).flatMap((dia) => [1, 2].map((indice) => ({ dia, indice })))
      .find((c) => !ocA.some((x) => x.dia === c.dia && x.indice === c.indice) && (o.professor_id === 'P1' || c.dia === 'SEGUNDA' || c.indice === 1));
    if (!vazia) return;
    const r = aplicarAcao(base, [], {
      acao: 'trocar_posicoes',
      origem: { turma_id: 'TA', dia: o.dia, turno: 'NOITE', indice: o.indice },
      destino: { turma_id: 'TA', dia: vazia.dia, turno: 'NOITE', indice: vazia.indice },
    });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.erros));
    if (!r.ok) return;
    const [dest, orig] = r.novas;
    assert.equal(dest.tipo, 'ocupacao');
    assert.deepEqual(dest.tipo === 'ocupacao' && dest.valor_fixo, { disciplina_id: o.disciplina_id, professor_id: o.professor_id });
    assert.equal(orig.tipo, 'vaga_turma');
  });

  it('RN-45: destino que o professor não selecionou é recusado', () => {
    const o = base.ocupacoes.find((x) => x.professor_id === 'P2' && x.turma_id === 'TA');
    if (!o) return;
    const r = aplicarAcao(base, [], {
      acao: 'trocar_posicoes',
      origem: { turma_id: 'TA', dia: o.dia, turno: 'NOITE', indice: o.indice },
      destino: { turma_id: 'TA', dia: 'TERCA', turno: 'NOITE', indice: 2 },
    });
    if (!(o.dia === 'TERCA' && o.indice === 2)) assert.ok(!r.ok);
  });

  it('CA-105: fixação para professor que não selecionou a disciplina falha', () => {
    const s2 = { ...base, snapshot: { ...base.snapshot, professores_participantes: base.snapshot.professores_participantes.map((p) => p.id === 'P2' ? { ...p, disciplinas_selecionadas_e_notas: [{ disciplina_id: 'D2', nota: 5 }] } : p) } };
    const r = aplicarAcao(s2, [], { acao: 'fixar_disciplina_professor_semestre', semestre_id: 'S1', disciplina_id: 'D1', professor_id: 'P2' });
    assert.ok(!r.ok && r.erros[0].codigo === 'DISCIPLINA_NAO_SELECIONADA');
  });

  it('CA-103/CA-104: fixação conflitante com bloco travado de outro professor é recusada', () => {
    const o = base.ocupacoes.find((x) => x.disciplina_id === 'D1')!;
    const outro = o.professor_id === 'P1' ? 'P2' : 'P1';
    const existente: Trava = { id: 'oc', tipo: 'ocupacao', origem_versao: base.hash_grade, alvo: { turma_id: o.turma_id, dia: o.dia, turno: o.turno, indice: o.indice }, valor_fixo: { disciplina_id: 'D1', professor_id: o.professor_id } };
    const r = aplicarAcao(base, [existente], { acao: 'fixar_disciplina_professor_semestre', semestre_id: 'S1', disciplina_id: 'D1', professor_id: outro });
    assert.ok(!r.ok && r.erros.some((e) => e.codigo === 'CONFLITO_TRAVA'));
  });

  it('CA-111/CA-112: travas da troca valem na regeneração (grade só muda após nova geração)', async () => {
    const r = aplicarAcao(base, [], { acao: 'bloquear_grade_turma', turma_id: 'TB' });
    assert.ok(r.ok);
    if (!r.ok) return;
    const e = await resolver(comHash({ ...base.snapshot, travas: r.novas }), 30);
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    const tb = (x: string[]) => x.filter((l) => l.startsWith('TB:'));
    assert.deepEqual(tb(resumoOcupacoes(e)), tb(base.ocupacoes.map((o) => `${o.turma_id}:${o.dia}:${o.turno}:${o.indice}=${o.disciplina_id}/${o.professor_id}`)));
  });
});
