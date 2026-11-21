// Integração com o backend sem banco: mapeamento linhas → snapshot (ET-01,
// RN-09, RN-16, RN-20, RN-37, RN-50), painel técnico (RN-59, RN-60, ET-12,
// CA-156 a CA-166, CA-192, CA-204), projeções (RN-57, RN-69, CA-113,
// CA-150, CA-155, CA-190, CA-191) e ambiente (RN-72, CA-200).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validarAmbiente } from '../src/config/ambiente';
import { validarSnapshot } from '../src/motor/contrato';
import type { ExecucaoFinal } from '../src/motor/geracao';
import { diagnosticoPublico, justificativa, resumoPainel } from '../src/motor/painel';
import { gradePorTurma, projecaoPorProfessor } from '../src/motor/projecoes';
import { montarSnapshotDeDados, type DadosAdmin } from '../src/motor/snapshotMysql';
import type { Ocupacao, ResultadoMotor, StatusFinal } from '../src/motor/tipos';
import { montarSnapshot, prof, todos } from './apoio/fabrica';
import { resolver } from './apoio/motor';

const dados = (): DadosAdmin => ({
  idAdmin: 1,
  cursos: [],
  formulario: { id_formulario: 10, status: 'ENCERRADO' },
  semestres: [{ id_semestre: 1, periodo_letivo: null }, { id_semestre: 3, periodo_letivo: '2027/1' }],
  turmas: [{ id_turma: 11, id_semestre: 1, turno: 'NOITE' }, { id_turma: 12, id_semestre: 2, turno: 'NOITE' }, { id_turma: 13, id_semestre: 3, turno: 'NOITE' }],
  materias: [
    { id_materia: 21, id_semestre: 1, qtd_aulas_semana: 4, qtd_professores: 1 },
    { id_materia: 22, id_semestre: 1, qtd_aulas_semana: 2, qtd_professores: 2 },
    { id_materia: 23, id_semestre: 3, qtd_aulas_semana: 2, qtd_professores: 1 },
  ],
  dias: [
    { id_dia_letivo: 31, dia_semana: 'SEGUNDA', turno: 'NOITE' },
    { id_dia_letivo: 32, dia_semana: 'TERCA', turno: 'NOITE' },
    { id_dia_letivo: 33, dia_semana: 'SEGUNDA', turno: 'MANHA' },
  ],
  blocos: [{ id_bloco: 41, turno: 'NOITE', ordem: 1, qtd_aulas: 2 }, { id_bloco: 42, turno: 'NOITE', ordem: 2, qtd_aulas: 2 }],
  slots: [
    { id_slot: 411, id_bloco: 41, numero_aula: 1 }, { id_slot: 412, id_bloco: 41, numero_aula: 2 },
    { id_slot: 421, id_bloco: 42, numero_aula: 1 }, { id_slot: 422, id_bloco: 42, numero_aula: 2 },
  ],
  professores: [{ id_usuario: 51, nome: 'Ana' }, { id_usuario: 52, nome: 'Bruno' }, { id_usuario: 53, nome: 'Carla' }],
  respostas: [
    { id_resposta: 61, id_professor: 51, status: 'ENVIADA' },
    { id_resposta: 62, id_professor: 52, status: 'ENVIADA' },
    { id_resposta: 63, id_professor: 53, status: 'LIBERADA_PARA_ALTERACAO' },
  ],
  interesses: [
    { id_resposta: 61, id_materia: 21, nota_interesse: 5 }, { id_resposta: 61, id_materia: 22, nota_interesse: 4 },
    { id_resposta: 61, id_materia: 23, nota_interesse: 3 }, { id_resposta: 62, id_materia: 22, nota_interesse: 5 },
    { id_resposta: 62, id_materia: 23, nota_interesse: 5 }, { id_resposta: 62, id_materia: 99, nota_interesse: 5 },
  ],
  disponibilidades: [
    { id_resposta: 61, id_dia_letivo: 31, id_slot: 411, disponivel: 1 }, { id_resposta: 61, id_dia_letivo: 31, id_slot: 412, disponivel: 1 },
    { id_resposta: 61, id_dia_letivo: 31, id_slot: 421, disponivel: 1 }, { id_resposta: 61, id_dia_letivo: 31, id_slot: 422, disponivel: 0 },
    { id_resposta: 61, id_dia_letivo: 32, id_slot: 411, disponivel: 1 }, { id_resposta: 61, id_dia_letivo: 32, id_slot: 412, disponivel: 1 },
    { id_resposta: 61, id_dia_letivo: 32, id_slot: 421, disponivel: 1 }, { id_resposta: 61, id_dia_letivo: 32, id_slot: 422, disponivel: 1 },
    { id_resposta: 62, id_dia_letivo: 32, id_slot: 411, disponivel: 1 }, { id_resposta: 62, id_dia_letivo: 32, id_slot: 412, disponivel: 1 },
    { id_resposta: 62, id_dia_letivo: 32, id_slot: 421, disponivel: 1 }, { id_resposta: 62, id_dia_letivo: 32, id_slot: 422, disponivel: 1 },
    { id_resposta: 62, id_dia_letivo: 31, id_slot: 411, disponivel: 0 },
  ],
  preferencias: [
    { id_resposta: 61, id_dia_letivo: 31, nota: 5 }, { id_resposta: 61, id_dia_letivo: 32, nota: 3 },
    { id_resposta: 61, id_dia_letivo: 33, nota: 4 }, { id_resposta: 62, id_dia_letivo: 32, nota: 4 },
  ],
  travas: [],
});

describe('Mapeamento das linhas do banco para o snapshot', () => {
  it('monta snapshot válido com escopo do admin, período, participantes e avisos', () => {
    const m = montarSnapshotDeDados(dados(), { runId: 'r1', periodoLetivo: '2027/1' });
    assert.deepEqual(m.erros, []);
    const s = m.snapshot!;
    assert.equal(validarSnapshot(s).valido, true, JSON.stringify(validarSnapshot(s).diagnosticos));
    assert.equal(s.K, 2);
    assert.equal(s.curso_id, 'adm-1');
    assert.equal(s.form_version, '10');
    assert.deepEqual(s.blocos_por_dia_turno, [{ dia: 'SEGUNDA', turno: 'NOITE', quantidade: 2 }, { dia: 'TERCA', turno: 'NOITE', quantidade: 2 }]);
    assert.deepEqual(s.turmas.map((t) => t.id), ['11', '13']); // semestre de outro período fica fora (RN-70)
    assert.deepEqual(s.professores_participantes.map((p) => p.id), ['51', '52']); // só ENVIADA (RN-20)
    const ana = s.professores_participantes[0];
    assert.deepEqual(ana.blocos_selecionados, [
      { dia: 'SEGUNDA', turno: 'NOITE', indice: 1 }, { dia: 'TERCA', turno: 'NOITE', indice: 1 }, { dia: 'TERCA', turno: 'NOITE', indice: 2 },
    ]);
    assert.deepEqual(ana.notas_dia_turno, [{ dia: 'SEGUNDA', turno: 'NOITE', nota: 5 }, { dia: 'TERCA', turno: 'NOITE', nota: 3 }]);
    assert.deepEqual(s.professores_participantes[1].disciplinas_selecionadas_e_notas.map((x) => x.disciplina_id), ['22', '23']);
    assert.ok(m.avisos.some((a) => a.codigo === 'BLOCO_PARCIALMENTE_SELECIONADO' && a.entidades.indice === 2));
    assert.ok(m.avisos.some((a) => a.codigo === 'CODOCENCIA_IGNORADA' && a.entidades.disciplina_id === '22'));
    assert.deepEqual(m.formulario, {
      professores_ativos: 3, respostas_enviadas: 2, pendentes: 1,
      professores_pendentes: [{ id: '53', nome: 'Carla' }], geracao_antecipada_confirmada: false,
    });
  });

  it('RN-09: K diferente entre turnos é rejeitado', () => {
    const d = dados();
    d.blocos.push({ id_bloco: 43, turno: 'MANHA', ordem: 1, qtd_aulas: 3 });
    d.slots.push({ id_slot: 431, id_bloco: 43, numero_aula: 1 }, { id_slot: 432, id_bloco: 43, numero_aula: 2 }, { id_slot: 433, id_bloco: 43, numero_aula: 3 });
    const m = montarSnapshotDeDados(d, { runId: 'r1', periodoLetivo: '2027/1' });
    assert.equal(m.snapshot, null);
    assert.ok(m.erros.some((e) => e.codigo === 'K_NAO_GLOBAL'));
  });

  it('RN-35: índices de bloco com lacuna são rejeitados; sem formulário não há geração', () => {
    const d = dados();
    d.blocos[1].ordem = 3;
    d.formulario = null;
    const codigos = montarSnapshotDeDados(d, { runId: 'r1', periodoLetivo: '2027/1' }).erros.map((e) => e.codigo);
    assert.ok(codigos.includes('ORDEM_BLOCOS_INVALIDA'));
    assert.ok(codigos.includes('FORMULARIO_INEXISTENTE'));
  });

  it('RN-50/CA-130: travas vêm só do período e viram travas do snapshot', () => {
    const d = dados();
    d.travas = [{ id_trava: 7, tipo: 'vaga_turma', grade_base_hash: 'h', dados: { alvo: { turma_id: '11', dia: 'SEGUNDA', turno: 'NOITE', indice: 2 }, valor_fixo: null } }];
    const s = montarSnapshotDeDados(d, { runId: 'r1', periodoLetivo: '2027/1' }).snapshot!;
    assert.deepEqual(s.travas, [{ id: '7', tipo: 'vaga_turma', origem_versao: 'h', alvo: { turma_id: '11', dia: 'SEGUNDA', turno: 'NOITE', indice: 2 }, valor_fixo: null }]);
  });

  it('o snapshot montado do banco é resolvido e validado pelo motor', async () => {
    const s = montarSnapshotDeDados(dados(), { runId: 'r1', periodoLetivo: '2027/1' }).snapshot!;
    const e = await resolver(s, 30);
    assert.ok(['OTIMA_COMPROVADA', 'INVIAVEL_COMPROVADA'].includes(e.status_final), e.status_final);
    if (e.status_final === 'OTIMA_COMPROVADA') assert.equal(e.grade_validada, true);
  });
});

const snapProj = () =>
  montarSnapshot({
    K: 3,
    blocos: [['SEGUNDA', 'NOITE', 2], ['TERCA', 'MANHA', 1]],
    turmas: [['TA', 'S1', 'NOITE'], ['TB', 'S1', 'NOITE']],
    disciplinas: [['D1', 'S1', 3]],
    professores: [prof('P1', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2)), prof('P2', [['D1', 5]], todos('SEGUNDA', 'NOITE', 2))],
  });
const ocProj: Ocupacao[] = [
  { turma_id: 'TA', dia: 'SEGUNDA', turno: 'NOITE', indice: 2, disciplina_id: 'D1', professor_id: 'P1' },
  { turma_id: 'TB', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, disciplina_id: 'D1', professor_id: 'P1' },
];

describe('Projeções por turma e professor (mesma ocupação canônica)', () => {
  it('CA-150/RN-57: cada bloco agrupa exatamente K aulas consecutivas (K=3)', () => {
    const g = gradePorTurma(snapProj(), ocProj);
    assert.deepEqual(g[0].posicoes.map((p) => p.aulas), [[1, 2, 3], [4, 5, 6]]);
    assert.equal(g[0].posicoes[0].ocupado, false); // vaga aparece na projeção
  });

  it('CA-190/RN-69: a visão do professor mostra todas as coordenadas, ocupadas ou vagas', () => {
    const v = projecaoPorProfessor(snapProj(), ocProj);
    for (const p of v) assert.equal(p.posicoes.length, 3);
    const p2 = v.find((x) => x.professor_id === 'P2')!;
    assert.ok(p2.posicoes.every((x) => !x.ocupado));
  });

  it('CA-113/CA-155/CA-191: as duas visões coincidem e nenhum professor fica em dois lugares na mesma coordenada', () => {
    const porTurma = gradePorTurma(snapProj(), ocProj).flatMap((t) => t.posicoes.filter((p) => p.ocupado));
    const porProf = projecaoPorProfessor(snapProj(), ocProj).flatMap((p) => p.posicoes.filter((x) => x.ocupado));
    const chave = (p: { turma_id: string | null; dia: string; turno: string; indice: number; disciplina_id: string | null; professor_id: string | null }) =>
      `${p.turma_id}|${p.dia}|${p.turno}|${p.indice}|${p.disciplina_id}|${p.professor_id}`;
    assert.deepEqual(porTurma.map(chave).sort(), porProf.map(chave).sort());
  });
});

function execucao(status: StatusFinal, ocupacoes: Ocupacao[] = [], extras: Partial<ExecucaoFinal> = {}): ExecucaoFinal {
  const comGrade = status === 'OTIMA_COMPROVADA' || status === 'VALIDA_NAO_OTIMA';
  const provas = [1, 2, 3, 4].map((n) => ({
    nivel: n as 1, objetivo: 'x', metodo: 'y', estado: (status === 'OTIMA_COMPROVADA' || n === 1) && comGrade ? 'COMPROVADO' as const : 'NAO_COMPROVADO_LIMITE_TEMPO' as const,
    comprovado: (status === 'OTIMA_COMPROVADA' || n === 1) && comGrade, valor: null,
  }));
  const resultado = {
    ocupacoes, C: comGrade ? 10 : null, parcelas: comGrade ? { dia_turno: 6, disciplina: 4 } : null, prova_por_nivel: provas,
    max_M_p: comGrade ? { num: 5, den: 2 } : null, amplitude_M: comGrade ? { num: 1, den: 1 } : null, chave_canonica: comGrade ? 'k' : null,
    versao_motor: 'staggy-clpfd-2.7.0',
  } as unknown as ResultadoMotor;
  return {
    run_id: 'r', snapshot_hash: 'h', status_final: status, motivo_termino: status === 'VALIDA_NAO_OTIMA' ? 'LIMITE_TEMPO' : 'BUSCA_CONCLUIDA',
    resultado, resultado_motor: resultado, validacao: null, grade_validada: comGrade, diagnosticos: [], candidato_recuperavel: null,
    encerrado_por_prazo: false, duracao_execucao_ms: 1234, tempo_primeira_grade_ms: 50, detalhe_tecnico: null, ...extras,
  };
}

describe('Painel técnico da geração (RN-59, RN-60, ET-12)', () => {
  const s = montarSnapshot({
    K: 2, blocos: [['SEGUNDA', 'NOITE', 4]],
    turmas: [['T1', 'S1', 'NOITE'], ['T2', 'S1', 'NOITE'], ['T3', 'S1', 'NOITE'], ['T4', 'S2', 'NOITE'], ['T5', 'S2', 'NOITE']],
    disciplinas: [['D1', 'S1', 2], ['D2', 'S2', 2]],
    professores: ['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => prof(p, [['D1', 5], ['D2', 5]], todos('SEGUNDA', 'NOITE', 4))),
  });
  const meta = { run_id: 'r', curso_id: 'ES', periodo_letivo_id: '2027/1' };
  const form = { professores_ativos: 6, respostas_enviadas: 5, pendentes: 1, geracao_antecipada_confirmada: true };

  it('CA-156/CA-157: turmas concluídas e professores distintos (sem contar repetidos)', () => {
    const oc: Ocupacao[] = [
      { turma_id: 'T1', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, disciplina_id: 'D1', professor_id: 'P1' },
      { turma_id: 'T2', dia: 'SEGUNDA', turno: 'NOITE', indice: 2, disciplina_id: 'D1', professor_id: 'P1' },
      { turma_id: 'T3', dia: 'SEGUNDA', turno: 'NOITE', indice: 3, disciplina_id: 'D1', professor_id: 'P1' },
      { turma_id: 'T4', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, disciplina_id: 'D2', professor_id: 'P2' },
      { turma_id: 'T5', dia: 'SEGUNDA', turno: 'NOITE', indice: 1, disciplina_id: 'D2', professor_id: 'P3' },
    ];
    const p = resumoPainel(s, execucao('OTIMA_COMPROVADA', oc), meta, form);
    assert.equal(p.total_turmas_abrangidas, 5);
    assert.equal(p.turmas_com_grade_validada, 5);
    assert.equal(p.professores_distintos_com_aulas_atribuidas, 3);
    assert.equal(p.pendentes_de_formulario, 1);
    assert.equal(p.custo_primario_total, 10);
    assert.equal(p.publicavel, true);
  });

  it('CA-158: sem grade validada, métricas aparecem como indisponíveis', () => {
    for (const st of ['INCONCLUSIVA', 'INVIAVEL_COMPROVADA', 'ERRO_EXECUCAO', 'ENTRADA_INVALIDA'] as const) {
      const p = resumoPainel(s, execucao(st), meta, form);
      assert.equal(p.turmas_com_grade_validada, null, st);
      assert.equal(p.professores_distintos_com_aulas_atribuidas, null, st);
      assert.equal(p.custo_primario_total, null, st);
      assert.match(p.fonte_metricas, /indisponível/);
      assert.equal(p.publicavel, false);
    }
  });

  it('CA-160 a CA-165: justificativa coerente com cada status', () => {
    assert.match(justificativa(execucao('OTIMA_COMPROVADA')).texto, /validação independente/);
    const v = justificativa(execucao('VALIDA_NAO_OTIMA'));
    assert.match(v.texto, /600 segundos/);
    assert.deepEqual(v.niveis_nao_comprovados, [2, 3, 4]);
    assert.match(justificativa(execucao('INCONCLUSIVA')).texto, /não significa que montar a grade seja impossível/);
    assert.match(justificativa(execucao('ENTRADA_INVALIDA')).texto, /Não houve falha de otimização/);
    assert.match(justificativa(execucao('ERRO_EXECUCAO')).texto, /Não se trata de inviabilidade/);
  });

  it('CA-195: grade válida não ótima não é publicável', () => {
    assert.equal(resumoPainel(s, execucao('VALIDA_NAO_OTIMA', []), meta, form).publicavel, false);
  });

  it('ET-12: EM_PROCESSAMENTO é só estado de interface', () => {
    const p = resumoPainel(s, null, { ...meta, status: 'EM_PROCESSAMENTO' }, form);
    assert.equal(p.status, 'EM_PROCESSAMENTO');
    assert.equal(p.status_final, null);
  });

  it('CA-192/CA-204/CA-210: diagnóstico público sem detalhe técnico interno', () => {
    const d = diagnosticoPublico({ categoria: 'falha_tecnica', codigo: 'X', severidade: 'erro', etapa: 'resolucao', mensagem: 'm', entidades: {},
      natureza_evidencia: 'falha_tecnica', detalhe_tecnico: 'error(stack, at c:/...)' });
    assert.equal('detalhe_tecnico' in d, false);
  });
});

describe('Validação de ambiente (RN-72, CA-200)', () => {
  it('produção sem banco obrigatório é recusada; desenvolvimento aceita padrões', () => {
    const prod = validarAmbiente({ NODE_ENV: 'production' }).map((p) => p.variavel);
    assert.deepEqual(prod.sort(), ['DB_HOST', 'DB_NAME', 'DB_USER']);
    assert.deepEqual(validarAmbiente({ NODE_ENV: 'development' }), []);
  });

  it('parâmetros malformados são apontados sem ecoar valores', () => {
    const ps = validarAmbiente({ PORT: 'abc', DB_SSL: 'sim', APP_URL: 'nao-e-url' });
    assert.deepEqual(ps.map((p) => p.variavel).sort(), ['APP_URL', 'DB_SSL', 'PORT']);
    assert.ok(ps.every((p) => !p.mensagem.includes('abc') && !p.mensagem.includes('sim')));
  });
});
