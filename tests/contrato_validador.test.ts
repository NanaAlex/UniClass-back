// Pré-validação do snapshot (RN-24, CA-04, CA-16, CA-27, CA-28, CA-49,
// CA-103 a CA-105, CA-121, CA-122, CA-174, CA-200, CA-201) e validação
// independente do resultado (RN-28, RN-67, CA-56, CA-133, CA-147, CA-173,
// CA-174, CA-215).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validarSnapshot } from '../src/motor/contrato';
import { POLICY_VERSION } from '../src/motor/politica';
import type { ResultadoMotor, Snapshot, Trava } from '../src/motor/tipos';
import { recomputar, validarGrade, validarResultado } from '../src/motor/validador';
import { comHash, montarSnapshot, prof, todos } from './apoio/fabrica';
import { resolver } from './apoio/motor';

const base = (travas: Trava[] = []) =>
  montarSnapshot({
    K: 2,
    blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'NOITE', 2]],
    turmas: [['T1', 'S1', 'NOITE'], ['T2', 'S1', 'NOITE']],
    disciplinas: [['D1', 'S1', 2], ['D2', 'S1', 2]],
    professores: [
      prof('P1', [['D1', 5], ['D2', 3]], [...todos('SEGUNDA', 'NOITE', 2), ...todos('TERCA', 'NOITE', 2)]),
      prof('P2', [['D2', 4], ['D1', 1]], [...todos('SEGUNDA', 'NOITE', 2), ...todos('TERCA', 'NOITE', 2)], 3),
    ],
    travas,
  });

const codigos = (s: unknown, opts = { permitirLimiteDeTeste: false }) =>
  validarSnapshot(s, opts).diagnosticos.map((d) => d.codigo);

describe('Pré-validação do snapshot → ENTRADA_INVALIDA (RN-24, CA-49)', () => {
  it('snapshot correto é aceito', () => {
    assert.deepEqual(validarSnapshot(base()).diagnosticos, []);
  });

  it('CA-16: carga não múltipla de K', () => {
    const s = base();
    s.disciplinas[0].carga_aulas = 5;
    assert.ok(codigos(s).includes('CARGA_INCOMPATIVEL_COM_K'));
  });

  it('CA-04: turma sem turno', () => {
    const s = base() as any;
    s.turmas[0].turno = null;
    assert.ok(codigos(s).includes('TURNO_OBRIGATORIO'));
  });

  it('CA-28: notas ausentes, 0, 6 ou não inteiras', () => {
    for (const nota of [0, 6, 2.5, null]) {
      const s = base() as any;
      s.professores_participantes[0].disciplinas_selecionadas_e_notas[0].nota = nota;
      assert.ok(codigos(s).includes('NOTA_INVALIDA'), `nota ${nota}`);
    }
  });

  it('CA-27: dia/turno com bloco selecionado e sem nota não vira nota 1', () => {
    const s = base();
    s.professores_participantes[0].notas_dia_turno = s.professores_participantes[0].notas_dia_turno.filter((n) => n.dia !== 'TERCA');
    const ds = validarSnapshot(s).diagnosticos;
    const d = ds.find((x) => x.codigo === 'NOTA_DIA_TURNO_AUSENTE');
    assert.ok(d);
    assert.deepEqual(d!.entidades, { professor_id: 'P1', dia: 'TERCA', turno: 'NOITE' });
  });

  it('CA-121: referência inexistente é identificada', () => {
    const s = base();
    s.professores_participantes[1].disciplinas_selecionadas_e_notas.push({ disciplina_id: 'D99', nota: 5 });
    const d = validarSnapshot(s).diagnosticos.find((x) => x.codigo === 'DISCIPLINA_INEXISTENTE');
    assert.equal(d?.entidades.disciplina_id, 'D99');
  });

  it('CA-11: bloco selecionado inexistente', () => {
    const s = base();
    s.professores_participantes[0].blocos_selecionados.push({ dia: 'SEGUNDA', turno: 'NOITE', indice: 3 });
    assert.ok(codigos(s).includes('BLOCO_INEXISTENTE'));
  });

  it('CA-201: campo não previsto é rejeitado', () => {
    const s = { ...base(), peso_extra: 7 };
    assert.ok(codigos(s).includes('CAMPO_DESCONHECIDO'));
  });

  it('CA-200/RN-51: limite diferente de 600 s é rejeitado fora da suíte de testes', () => {
    const s = { ...base(), limite_execucao_segundos: 900 };
    assert.ok(codigos(s).includes('LIMITE_EXECUCAO_INVALIDO'));
    assert.ok(codigos({ ...base(), limite_execucao_segundos: 30 }).includes('LIMITE_EXECUCAO_INVALIDO'));
  });

  it('CA-174: política diferente da homologada é rejeitada', () => {
    const s = base();
    s.politica = { ...s.politica, peso_dia_turno: 4 };
    assert.ok(codigos(s).includes('POLITICA_INCOMPATIVEL'));
  });

  const ocup = (id: string, turma: string, dia: 'SEGUNDA' | 'TERCA', indice: number, d: string, p: string): Trava => ({
    id, tipo: 'ocupacao', origem_versao: 'base-1', alvo: { turma_id: turma, dia, turno: 'NOITE', indice }, valor_fixo: { disciplina_id: d, professor_id: p },
  });

  it('CA-105: trava de professor que não selecionou a disciplina', () => {
    const s = base([ocup('tr1', 'T1', 'SEGUNDA', 1, 'D1', 'P2')]);
    s.professores_participantes[1].disciplinas_selecionadas_e_notas = [{ disciplina_id: 'D2', nota: 4 }];
    assert.ok(codigos(comHash(s)).includes('TRAVA_INCOMPATIVEL'));
  });

  it('CA-103/CA-104/CA-125: travas contraditórias', () => {
    const fix: Trava = { id: 'fx', tipo: 'fixacao_disciplina_professor', origem_versao: 'base-1', alvo: { semestre_id: 'S1', disciplina_id: 'D1' }, valor_fixo: { professor_id: 'P1' } };
    assert.ok(codigos(base([fix, ocup('tr1', 'T2', 'SEGUNDA', 1, 'D1', 'P2')])).includes('TRAVAS_CONTRADITORIAS'));
    assert.ok(codigos(base([ocup('a', 'T1', 'SEGUNDA', 1, 'D1', 'P1'), ocup('b', 'T2', 'SEGUNDA', 1, 'D2', 'P1')])).includes('TRAVAS_CONTRADITORIAS'));
    const vaga: Trava = { id: 'v', tipo: 'vaga_turma', origem_versao: 'base-1', alvo: { turma_id: 'T1', dia: 'SEGUNDA', turno: 'NOITE', indice: 1 }, valor_fixo: null };
    assert.ok(codigos(base([ocup('a', 'T1', 'SEGUNDA', 1, 'D1', 'P1'), vaga])).includes('TRAVAS_CONTRADITORIAS'));
  });

  it('CA-122: trava em bloco que não existe mais na estrutura', () => {
    const t: Trava = { id: 'v', tipo: 'vaga_turma', origem_versao: 'base-1', alvo: { turma_id: 'T1', dia: 'SEGUNDA', turno: 'NOITE', indice: 9 }, valor_fixo: null };
    assert.ok(codigos(base([t])).includes('TRAVA_INCOMPATIVEL'));
  });

  it('CA-49: a geração com entrada inválida não executa o motor', async () => {
    const s = base();
    s.disciplinas[0].carga_aulas = 3;
    const e = await resolver(comHash(s), 10);
    assert.equal(e.status_final, 'ENTRADA_INVALIDA');
    assert.equal(e.resultado_motor, null);
    assert.ok(e.diagnosticos.some((d) => d.codigo === 'CARGA_INCOMPATIVEL_COM_K' && d.entidades.disciplina_id === 'D1'));
  });

  it('CA-121 (lado Prolog): o motor também rejeita referência inexistente', async () => {
    const { executarMotor } = await import('../src/motor/supervisor');
    const s = base();
    s.professores_participantes[0].disciplinas_selecionadas_e_notas.push({ disciplina_id: 'DX', nota: 3 });
    const bruta = await executarMotor(comHash({ ...s, limite_execucao_segundos: 10 }), { limiteMs: 10_000 });
    assert.equal(bruta.resultado?.status, 'ENTRADA_INVALIDA');
    assert.ok(bruta.resultado?.diagnosticos.some((d) => d.codigo === 'DISCIPLINA_INEXISTENTE'));
  });
});

describe('Validação independente do resultado (RN-28)', async () => {
  const s = comHash({ ...base(), limite_execucao_segundos: 30 });
  const e = await resolver(s, 30);
  const bom = e.resultado as ResultadoMotor;

  it('o resultado do motor é aprovado e recomputado', () => {
    assert.equal(e.status_final, 'OTIMA_COMPROVADA');
    const v = validarResultado(s, bom);
    assert.equal(v.aprovada, true, JSON.stringify(v.erros));
    assert.equal(v.recomputo!.C, bom.C);
  });

  const adulterar = (f: (r: ResultadoMotor) => void, ctx = {}) => {
    const r = structuredClone(bom);
    f(r);
    return validarResultado(s, r, ctx).erros.map((x) => x.codigo);
  };

  it('CA-56/CA-216: custo declarado alterado', () => {
    assert.ok(adulterar((r) => { r.C = (r.C ?? 0) - 1; }).includes('CUSTO_DIVERGENTE'));
  });

  it('CA-173/CA-215: OTIMA_COMPROVADA com prova incompleta ou após prazo', () => {
    assert.ok(adulterar((r) => { r.prova_por_nivel[2].comprovado = false; r.prova_por_nivel[2].estado = 'NAO_COMPROVADO_LIMITE_TEMPO'; }).includes('OTIMO_SEM_PROVA'));
    assert.ok(adulterar(() => {}, { encerradoPorPrazo: true }).includes('PROVA_INCOMPATIVEL_COM_PRAZO'));
    assert.ok(adulterar((r) => { r.limites_atingidos = ['TEMPO']; r.motivo_termino = 'LIMITE_TEMPO'; }).includes('OTIMO_APOS_LIMITE'));
  });

  it('CA-174: política ou versão do motor divergentes', () => {
    assert.ok(adulterar((r) => { r.policy_version = POLICY_VERSION + '-x'; }).includes('POLITICA_INCOMPATIVEL'));
    assert.ok(adulterar((r) => { r.versao_motor = 'outro'; }).includes('VERSAO_MOTOR_INCOMPATIVEL'));
  });

  it('RN-61/CA-168: chave canônica divergente', () => {
    assert.ok(adulterar((r) => { r.chave_canonica = r.chave_canonica + ';x'; }).includes('CHAVE_CANONICA_DIVERGENTE'));
  });

  it('CA-35/CA-34: conflito de turma e de professor', () => {
    assert.ok(adulterar((r) => { r.ocupacoes.push({ ...r.ocupacoes[0], disciplina_id: 'D2' }); }).includes('CONFLITO_TURMA'));
    const r2 = structuredClone(bom);
    const o = r2.ocupacoes[0];
    const outra = r2.ocupacoes.find((x) => x.turma_id !== o.turma_id && x.professor_id !== o.professor_id);
    if (outra) {
      outra.professor_id = o.professor_id;
      outra.dia = o.dia;
      outra.indice = o.indice;
      assert.ok(validarResultado(s, r2).erros.some((x) => x.codigo === 'CONFLITO_PROFESSOR'));
    }
  });

  it('CA-08/CA-133: carga divergente e participante sem disciplina', () => {
    const erros = validarGrade(s, []);
    assert.ok(erros.some((x) => x.codigo === 'CARGA_DIVERGENTE'));
    assert.ok(erros.some((x) => x.codigo === 'PARTICIPANTE_SEM_DISCIPLINA'));
  });

  it('CA-147: aula em vaga travada de turma ou de professor', () => {
    const o = bom.ocupacoes[0];
    const comVaga: Snapshot = comHash({
      ...s,
      travas: [
        { id: 'vt', tipo: 'vaga_turma', origem_versao: 'b', alvo: { turma_id: o.turma_id, dia: o.dia, turno: o.turno, indice: o.indice }, valor_fixo: null },
        { id: 'vp', tipo: 'vaga_professor', origem_versao: 'b', alvo: { professor_id: o.professor_id, dia: o.dia, turno: o.turno, indice: o.indice }, valor_fixo: null },
      ],
    });
    const erros = validarGrade(comVaga, bom.ocupacoes).filter((x) => x.codigo === 'TRAVA_VIOLADA');
    assert.equal(erros.length, 2);
  });

  it('status sem grade não pode trazer custo (CA-158)', () => {
    assert.ok(adulterar((r) => { (r as any).status = 'INCONCLUSIVA'; }).includes('GRADE_EM_STATUS_SEM_GRADE'));
  });

  it('recomputar é coerente com as parcelas (CA-159)', () => {
    const rc = recomputar(s, bom.ocupacoes);
    assert.equal(rc.parcelas.dia_turno + rc.parcelas.disciplina, rc.C);
  });
});
