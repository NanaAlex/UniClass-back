// Pré-validação do snapshot antes de executar o Prolog (RN-24, ET-06, CA-49,
// CA-121). Entrada malformada ou travas contraditórias → ENTRADA_INVALIDA,
// com os campos e vínculos rejeitados identificados (CA-165). O motor repete
// as verificações essenciais por defesa em profundidade.

import { chaveCoordenada, DIA_ISO, TURNO_CODIGO } from './canonico';
import { jsonCanonico } from './hash';
import {
  LIMITE_EXECUCAO_SEGUNDOS,
  politicaDoSnapshot,
  SCHEMA_SNAPSHOT,
  TETO_AULAS_PROFESSOR,
} from './politica';
import type { Coordenada, Diagnostico, Snapshot } from './tipos';

export interface OpcoesValidacao {
  // Somente a suíte de testes usa prazos menores; a API sempre envia 600 s.
  permitirLimiteDeTeste?: boolean;
}

export interface ResultadoValidacaoEntrada {
  valido: boolean;
  diagnosticos: Diagnostico[];
}

const CAMPOS: Record<string, readonly string[]> = {
  raiz: [
    'schema_version', 'run_id', 'curso_id', 'periodo_letivo_id', 'form_version', 'snapshot_hash', 'K',
    'turnos', 'dias_letivos', 'blocos_por_dia_turno', 'turmas', 'disciplinas', 'professores_participantes',
    'travas', 'politica', 'limite_execucao_segundos',
  ],
  bloco: ['dia', 'turno', 'quantidade'],
  turma: ['id', 'semestre_id', 'turno'],
  disciplina: ['id', 'semestre_id', 'carga_aulas'],
  professor: ['id', 'disciplinas_selecionadas_e_notas', 'blocos_selecionados', 'notas_dia_turno'],
  trava: ['id', 'tipo', 'origem_versao', 'alvo', 'valor_fixo'],
};

const TIPOS_TRAVA = new Set(['ocupacao', 'vaga_turma', 'vaga_professor', 'fixacao_disciplina_professor']);
const RESERVADOS = new Set(['true', 'false', 'null']);

const ehObjeto = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const idValido = (v: unknown): v is string => typeof v === 'string' && v !== '' && !RESERVADOS.has(v);
const inteiro = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const notaValida = (v: unknown) => inteiro(v, 1, 5);
const diaValido = (v: unknown) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIA_ISO, v);
const turnoValido = (v: unknown) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(TURNO_CODIGO, v);

function erro(codigo: string, mensagem: string, entidades: Record<string, unknown> = {}): Diagnostico {
  return {
    categoria: 'entrada_invalida',
    codigo,
    severidade: 'erro',
    etapa: 'pre_validacao_backend',
    mensagem,
    entidades,
    natureza_evidencia: 'comprovada',
  };
}

function camposDoObjeto(obj: Record<string, any>, esperado: readonly string[], local: string, erros: Diagnostico[]) {
  for (const c of esperado) {
    if (!(c in obj)) erros.push(erro('CAMPO_AUSENTE', `Campo obrigatório ausente em ${local}: ${c}`, { campo: c, local }));
  }
  for (const c of Object.keys(obj)) {
    if (!esperado.includes(c)) {
      erros.push(erro('CAMPO_DESCONHECIDO', `Campo não previsto no contrato em ${local}: ${c} (CA-201)`, { campo: c, local }));
    }
  }
}

function coordenadaBemFormada(c: unknown): c is Coordenada & Record<string, any> {
  return ehObjeto(c) && diaValido(c.dia) && turnoValido(c.turno) && inteiro(c.indice, 1);
}

export function validarSnapshot(entrada: unknown, opcoes: OpcoesValidacao = {}): ResultadoValidacaoEntrada {
  const erros: Diagnostico[] = [];

  if (!ehObjeto(entrada)) {
    return { valido: false, diagnosticos: [erro('JSON_INVALIDO', 'O snapshot não é um objeto JSON')] };
  }
  const s = entrada as Record<string, any>;
  camposDoObjeto(s, CAMPOS.raiz, 'snapshot', erros);
  if (erros.some((e) => e.codigo === 'CAMPO_AUSENTE')) return { valido: false, diagnosticos: erros };

  if (s.schema_version !== SCHEMA_SNAPSHOT) {
    erros.push(erro('SCHEMA_INCOMPATIVEL', `schema_version deve ser ${SCHEMA_SNAPSHOT}`, { campo: 'schema_version' }));
  }
  for (const c of ['run_id', 'curso_id', 'periodo_letivo_id', 'form_version', 'snapshot_hash']) {
    if (!idValido(s[c])) erros.push(erro('IDENTIFICADOR_INVALIDO', `O campo ${c} deve ser um texto não vazio`, { campo: c }));
  }
  if (!inteiro(s.K, 1)) {
    erros.push(erro('K_INVALIDO', 'K deve ser um inteiro positivo de aulas por bloco (RN-09)', { campo: 'K' }));
  }
  const limiteOk = opcoes.permitirLimiteDeTeste
    ? inteiro(s.limite_execucao_segundos, 1, LIMITE_EXECUCAO_SEGUNDOS)
    : s.limite_execucao_segundos === LIMITE_EXECUCAO_SEGUNDOS;
  if (!limiteOk) {
    erros.push(erro('LIMITE_EXECUCAO_INVALIDO',
      `limite_execucao_segundos deve ser ${LIMITE_EXECUCAO_SEGUNDOS} (RN-51, CA-200)`, { campo: 'limite_execucao_segundos' }));
  }
  if (jsonCanonico(s.politica) !== jsonCanonico(politicaDoSnapshot())) {
    erros.push(erro('POLITICA_INCOMPATIVEL',
      'A política de preferências difere da homologada (CP-02, CP-03, CA-174)', { campo: 'politica' }));
  }
  for (const c of ['turnos', 'dias_letivos', 'blocos_por_dia_turno', 'turmas', 'disciplinas', 'professores_participantes', 'travas']) {
    if (!Array.isArray(s[c])) erros.push(erro('TIPO_INVALIDO', `O campo ${c} deve ser uma lista`, { campo: c }));
  }
  if (erros.length > 0) return { valido: false, diagnosticos: erros };

  const K: number = s.K;

  // Calendário ordinal (RN-10, RN-35): índices 1..quantidade por dia/turno
  const turnos = new Set<string>();
  for (const t of s.turnos) {
    if (!turnoValido(t) || turnos.has(t)) erros.push(erro('TURNO_INVALIDO', 'Turno inválido ou repetido em turnos', { turno: t }));
    turnos.add(t);
  }
  const dias = new Set<string>();
  for (const d of s.dias_letivos) {
    if (!diaValido(d) || dias.has(d)) erros.push(erro('DIA_INVALIDO', 'Dia inválido ou repetido em dias_letivos', { dia: d }));
    dias.add(d);
  }
  const quantidade = new Map<string, number>();
  for (const b of s.blocos_por_dia_turno) {
    if (!ehObjeto(b)) {
      erros.push(erro('TIPO_INVALIDO', 'Item de blocos_por_dia_turno não é objeto'));
      continue;
    }
    camposDoObjeto(b, CAMPOS.bloco, 'blocos_por_dia_turno', erros);
    if (!diaValido(b.dia) || !turnoValido(b.turno) || !dias.has(b.dia) || !turnos.has(b.turno) || !inteiro(b.quantidade, 1)) {
      erros.push(erro('BLOCOS_INVALIDOS', 'Blocos exigem dia e turno letivos válidos e quantidade inteira positiva', { dia: b.dia, turno: b.turno }));
      continue;
    }
    const chave = `${b.dia}|${b.turno}`;
    if (quantidade.has(chave)) erros.push(erro('BLOCOS_DUPLICADOS', 'Combinação dia/turno repetida', { dia: b.dia, turno: b.turno }));
    quantidade.set(chave, b.quantidade);
  }
  const coordenadaExiste = (c: Coordenada) => (quantidade.get(`${c.dia}|${c.turno}`) ?? 0) >= c.indice;
  const turnoTemBlocos = (t: string) => [...quantidade.keys()].some((k) => k.endsWith(`|${t}`));

  // Turmas (RN-04, RN-05, CA-04)
  const turmas = new Map<string, { semestre_id: string; turno: string }>();
  for (const t of s.turmas) {
    if (!ehObjeto(t)) {
      erros.push(erro('TIPO_INVALIDO', 'Item de turmas não é objeto'));
      continue;
    }
    camposDoObjeto(t, CAMPOS.turma, 'turmas', erros);
    if (!idValido(t.id)) {
      erros.push(erro('IDENTIFICADOR_INVALIDO', 'Turma com id inválido', { turma_id: t.id }));
      continue;
    }
    if (turmas.has(t.id)) erros.push(erro('IDENTIFICADOR_DUPLICADO', 'Turma repetida no snapshot (CA-03)', { turma_id: t.id }));
    if (!idValido(t.semestre_id)) erros.push(erro('IDENTIFICADOR_INVALIDO', 'Turma com semestre_id inválido', { turma_id: t.id }));
    if (!turnoValido(t.turno)) {
      erros.push(erro('TURNO_OBRIGATORIO', 'Turma sem turno válido (RN-05, CA-04)', { turma_id: t.id }));
    } else if (!turnoTemBlocos(t.turno)) {
      erros.push(erro('TURNO_SEM_BLOCOS', 'O turno da turma não possui blocos letivos (RN-05)', { turma_id: t.id, turno: t.turno }));
    }
    turmas.set(t.id, { semestre_id: t.semestre_id, turno: t.turno });
  }

  // Disciplinas e cargas (RN-06, RN-13, CA-16)
  const disciplinas = new Map<string, { semestre_id: string; carga: number }>();
  for (const d of s.disciplinas) {
    if (!ehObjeto(d)) {
      erros.push(erro('TIPO_INVALIDO', 'Item de disciplinas não é objeto'));
      continue;
    }
    camposDoObjeto(d, CAMPOS.disciplina, 'disciplinas', erros);
    if (!idValido(d.id)) {
      erros.push(erro('IDENTIFICADOR_INVALIDO', 'Disciplina com id inválido', { disciplina_id: d.id }));
      continue;
    }
    if (disciplinas.has(d.id)) erros.push(erro('IDENTIFICADOR_DUPLICADO', 'Disciplina repetida', { disciplina_id: d.id }));
    if (!idValido(d.semestre_id)) erros.push(erro('IDENTIFICADOR_INVALIDO', 'Disciplina com semestre_id inválido', { disciplina_id: d.id }));
    if (!inteiro(d.carga_aulas, 1)) {
      erros.push(erro('CARGA_INVALIDA', 'carga_aulas deve ser inteiro positivo (RN-06)', { disciplina_id: d.id }));
    } else if (d.carga_aulas % K !== 0) {
      erros.push(erro('CARGA_INCOMPATIVEL_COM_K',
        `Carga de ${d.carga_aulas} aulas não é múltipla de K=${K} (RN-13, CA-16)`,
        { disciplina_id: d.id, carga_aulas: d.carga_aulas, K }));
    }
    disciplinas.set(d.id, { semestre_id: d.semestre_id, carga: d.carga_aulas });
  }

  // Professores participantes e respostas (RN-15 a RN-18, RN-22, CA-26 a CA-28)
  const professores = new Map<string, { disciplinas: Map<string, number>; blocos: Set<string> }>();
  for (const p of s.professores_participantes) {
    if (!ehObjeto(p)) {
      erros.push(erro('TIPO_INVALIDO', 'Item de professores_participantes não é objeto'));
      continue;
    }
    camposDoObjeto(p, CAMPOS.professor, 'professores_participantes', erros);
    if (!idValido(p.id)) {
      erros.push(erro('IDENTIFICADOR_INVALIDO', 'Professor com id inválido', { professor_id: p.id }));
      continue;
    }
    if (professores.has(p.id)) erros.push(erro('IDENTIFICADOR_DUPLICADO', 'Professor repetido', { professor_id: p.id }));
    const selecao = { disciplinas: new Map<string, number>(), blocos: new Set<string>() };
    professores.set(p.id, selecao);

    for (const sel of Array.isArray(p.disciplinas_selecionadas_e_notas) ? p.disciplinas_selecionadas_e_notas : []) {
      if (!ehObjeto(sel) || !idValido(sel.disciplina_id)) {
        erros.push(erro('IDENTIFICADOR_INVALIDO', 'Seleção de disciplina sem disciplina_id válido', { professor_id: p.id }));
        continue;
      }
      if (!notaValida(sel.nota)) {
        erros.push(erro('NOTA_INVALIDA', 'Nota de disciplina ausente ou fora do intervalo inteiro 1..5 (CA-28)',
          { professor_id: p.id, disciplina_id: sel.disciplina_id }));
      }
      if (!disciplinas.has(sel.disciplina_id)) {
        erros.push(erro('DISCIPLINA_INEXISTENTE', 'Professor selecionou disciplina ausente do snapshot (CA-121)',
          { professor_id: p.id, disciplina_id: sel.disciplina_id }));
      }
      if (selecao.disciplinas.has(sel.disciplina_id)) {
        erros.push(erro('SELECAO_DUPLICADA', 'Disciplina selecionada mais de uma vez', { professor_id: p.id, disciplina_id: sel.disciplina_id }));
      }
      selecao.disciplinas.set(sel.disciplina_id, sel.nota);
    }
    if (!Array.isArray(p.disciplinas_selecionadas_e_notas)) {
      erros.push(erro('TIPO_INVALIDO', 'disciplinas_selecionadas_e_notas deve ser lista', { professor_id: p.id }));
    }

    const diasTurnosSelecionados = new Set<string>();
    for (const b of Array.isArray(p.blocos_selecionados) ? p.blocos_selecionados : []) {
      if (!coordenadaBemFormada(b) || !coordenadaExiste(b)) {
        erros.push(erro('BLOCO_INEXISTENTE', 'Bloco selecionado não existe na estrutura ordinal do calendário (CA-11)',
          { professor_id: p.id, ...(ehObjeto(b) ? { dia: b.dia, turno: b.turno, indice: b.indice } : {}) }));
        continue;
      }
      selecao.blocos.add(chaveCoordenada(b));
      diasTurnosSelecionados.add(`${b.dia}|${b.turno}`);
    }
    if (!Array.isArray(p.blocos_selecionados)) {
      erros.push(erro('TIPO_INVALIDO', 'blocos_selecionados deve ser lista', { professor_id: p.id }));
    }

    const notas = new Set<string>();
    for (const n of Array.isArray(p.notas_dia_turno) ? p.notas_dia_turno : []) {
      if (!ehObjeto(n) || !diaValido(n.dia) || !turnoValido(n.turno)) {
        erros.push(erro('COORDENADA_INVALIDA', 'Nota de dia/turno sem dia e turno válidos', { professor_id: p.id }));
        continue;
      }
      if (!notaValida(n.nota)) {
        erros.push(erro('NOTA_INVALIDA', 'Nota de dia/turno ausente ou fora do intervalo inteiro 1..5 (CA-28)',
          { professor_id: p.id, dia: n.dia, turno: n.turno }));
      }
      const chave = `${n.dia}|${n.turno}`;
      if (!quantidade.has(chave)) {
        erros.push(erro('DIA_TURNO_INEXISTENTE', 'Nota atribuída a dia/turno sem blocos letivos', { professor_id: p.id, dia: n.dia, turno: n.turno }));
      }
      if (notas.has(chave)) erros.push(erro('NOTA_DUPLICADA', 'Nota de dia/turno repetida', { professor_id: p.id, dia: n.dia, turno: n.turno }));
      notas.add(chave);
    }
    if (!Array.isArray(p.notas_dia_turno)) {
      erros.push(erro('TIPO_INVALIDO', 'notas_dia_turno deve ser lista', { professor_id: p.id }));
    }
    for (const dt of diasTurnosSelecionados) {
      if (!notas.has(dt)) {
        const [dia, turno] = dt.split('|');
        erros.push(erro('NOTA_DIA_TURNO_AUSENTE',
          'Falta a nota de dia/turno para blocos selecionados; nenhuma nota é presumida (RN-17, CA-27)',
          { professor_id: p.id, dia, turno }));
      }
    }
  }

  validarTravas(s, K, turmas, disciplinas, professores, coordenadaExiste, erros);

  return { valido: erros.length === 0, diagnosticos: erros };
}

function validarTravas(
  s: Record<string, any>,
  K: number,
  turmas: Map<string, { semestre_id: string; turno: string }>,
  disciplinas: Map<string, { semestre_id: string; carga: number }>,
  professores: Map<string, { disciplinas: Map<string, number>; blocos: Set<string> }>,
  coordenadaExiste: (c: Coordenada) => boolean,
  erros: Diagnostico[],
) {
  const ids = new Set<string>();
  const ocupacoes: { id: string; turma: string; coord: string; disc: string; prof: string }[] = [];
  const vagasTurma: { id: string; turma: string; coord: string }[] = [];
  const vagasProf: { id: string; prof: string; coord: string }[] = [];
  const fixacoes: { id: string; semestre: string; disc: string; prof: string }[] = [];

  for (const t of s.travas) {
    if (!ehObjeto(t)) {
      erros.push(erro('TIPO_INVALIDO', 'Item de travas não é objeto'));
      continue;
    }
    camposDoObjeto(t, CAMPOS.trava, 'travas', erros);
    if (!idValido(t.id)) {
      erros.push(erro('IDENTIFICADOR_INVALIDO', 'Trava com id inválido'));
      continue;
    }
    const ent = { trava_id: t.id };
    if (ids.has(t.id)) erros.push(erro('IDENTIFICADOR_DUPLICADO', 'Trava repetida', ent));
    ids.add(t.id);
    if (!TIPOS_TRAVA.has(t.tipo)) {
      erros.push(erro('TRAVA_INVALIDA', 'Tipo de trava desconhecido', ent));
      continue;
    }
    if (!idValido(t.origem_versao)) {
      erros.push(erro('TRAVA_INVALIDA', 'Trava sem origem_versao (grade-base) identificável (RN-49)', ent));
    }
    const a = t.alvo;
    const v = t.valor_fixo;

    if (t.tipo === 'fixacao_disciplina_professor') {
      if (!ehObjeto(a) || !idValido(a.semestre_id) || !idValido(a.disciplina_id) || !ehObjeto(v) || !idValido(v.professor_id)) {
        erros.push(erro('TRAVA_INVALIDA', 'Fixação exige semestre_id, disciplina_id e professor_id', ent));
        continue;
      }
      const d = disciplinas.get(a.disciplina_id);
      const p = professores.get(v.professor_id);
      if (!d || d.semestre_id !== a.semestre_id) {
        erros.push(erro('TRAVA_REFERENCIA_INEXISTENTE', 'Fixação referencia disciplina inexistente no semestre', { ...ent, disciplina_id: a.disciplina_id }));
      } else if (!p) {
        erros.push(erro('TRAVA_REFERENCIA_INEXISTENTE', 'Fixação referencia professor fora dos participantes', { ...ent, professor_id: v.professor_id }));
      } else if (!p.disciplinas.has(a.disciplina_id)) {
        erros.push(erro('TRAVA_INCOMPATIVEL', 'Fixação para professor que não selecionou a disciplina (RN-43, CA-105)',
          { ...ent, professor_id: v.professor_id, disciplina_id: a.disciplina_id }));
      }
      fixacoes.push({ id: t.id, semestre: a.semestre_id, disc: a.disciplina_id, prof: v.professor_id });
      continue;
    }

    if (!coordenadaBemFormada(a)) {
      erros.push(erro('TRAVA_INVALIDA', 'Trava com coordenada malformada', ent));
      continue;
    }
    const coord = chaveCoordenada(a);
    const entCoord = { ...ent, dia: a.dia, turno: a.turno, indice: a.indice };
    if (!coordenadaExiste(a)) {
      erros.push(erro('TRAVA_INCOMPATIVEL',
        'Trava referencia bloco inexistente na estrutura vigente; não é reinterpretada por índice (CA-122)', entCoord));
      continue;
    }

    if (t.tipo === 'vaga_professor') {
      if (!idValido(a.professor_id) || !professores.has(a.professor_id)) {
        erros.push(erro('TRAVA_REFERENCIA_INEXISTENTE', 'Trava de vaga docente referencia professor fora dos participantes',
          { ...entCoord, professor_id: a.professor_id }));
      }
      vagasProf.push({ id: t.id, prof: a.professor_id, coord });
      continue;
    }

    const turma = idValido(a.turma_id) ? turmas.get(a.turma_id) : undefined;
    if (!turma) {
      erros.push(erro('TRAVA_REFERENCIA_INEXISTENTE', 'Trava referencia turma inexistente', { ...entCoord, turma_id: a.turma_id }));
      continue;
    }
    if (turma.turno !== a.turno) {
      erros.push(erro('TRAVA_INCOMPATIVEL', 'Trava fora do turno da turma (RN-05, RN-54)', { ...entCoord, turma_id: a.turma_id }));
      continue;
    }
    if (t.tipo === 'vaga_turma') {
      vagasTurma.push({ id: t.id, turma: a.turma_id, coord });
      continue;
    }

    // ocupacao
    if (!ehObjeto(v) || !idValido(v.disciplina_id) || !idValido(v.professor_id)) {
      erros.push(erro('TRAVA_INVALIDA', 'Trava de ocupação exige disciplina_id e professor_id', entCoord));
      continue;
    }
    const entOc = { ...entCoord, turma_id: a.turma_id, disciplina_id: v.disciplina_id, professor_id: v.professor_id };
    const d = disciplinas.get(v.disciplina_id);
    const p = professores.get(v.professor_id);
    if (!d) erros.push(erro('TRAVA_REFERENCIA_INEXISTENTE', 'Trava referencia disciplina inexistente', entOc));
    else if (d.semestre_id !== turma.semestre_id) erros.push(erro('TRAVA_INCOMPATIVEL', 'Disciplina travada não pertence ao semestre da turma', entOc));
    if (!p) erros.push(erro('TRAVA_REFERENCIA_INEXISTENTE', 'Trava referencia professor fora dos participantes', entOc));
    else if (!p.disciplinas.has(v.disciplina_id)) erros.push(erro('TRAVA_INCOMPATIVEL', 'Professor travado em disciplina que não selecionou (RN-15, CA-105)', entOc));
    else if (!p.blocos.has(coord)) erros.push(erro('TRAVA_INCOMPATIVEL', 'Professor travado em bloco que não selecionou (RN-16)', entOc));
    ocupacoes.push({ id: t.id, turma: a.turma_id, coord, disc: v.disciplina_id, prof: v.professor_id });
  }

  // Contradições entre travas (RN-24, RN-46, RN-49, CA-103, CA-104, CA-125)
  const contradicao = (a: string, b: string, msg: string) =>
    erros.push(erro('TRAVAS_CONTRADITORIAS', msg, { travas: [a, b].sort() }));
  for (let i = 0; i < ocupacoes.length; i++) {
    for (let j = i + 1; j < ocupacoes.length; j++) {
      const x = ocupacoes[i];
      const y = ocupacoes[j];
      if (x.turma === y.turma && x.coord === y.coord && (x.disc !== y.disc || x.prof !== y.prof)) {
        contradicao(x.id, y.id, 'Duas travas fixam conteúdos diferentes na mesma posição da turma');
      }
      if (x.prof === y.prof && x.coord === y.coord && x.turma !== y.turma) {
        contradicao(x.id, y.id, 'Professor travado em duas turmas na mesma coordenada (RN-21)');
      }
      if (x.turma === y.turma && x.disc === y.disc && x.prof !== y.prof) {
        contradicao(x.id, y.id, 'Travas atribuem professores diferentes à mesma turma–disciplina (RN-19)');
      }
    }
    const x = ocupacoes[i];
    for (const vt of vagasTurma) {
      if (vt.turma === x.turma && vt.coord === x.coord) contradicao(x.id, vt.id, 'Posição travada ao mesmo tempo como ocupada e como vaga');
    }
    for (const vp of vagasProf) {
      if (vp.prof === x.prof && vp.coord === x.coord) contradicao(x.id, vp.id, 'Professor travado em aula e em vaga na mesma coordenada');
    }
    for (const f of fixacoes) {
      if (f.disc === x.disc && turmas.get(x.turma)?.semestre_id === f.semestre && f.prof !== x.prof) {
        contradicao(f.id, x.id, 'Fixação disciplina–professor conflita com bloco travado de outro professor (CA-104)');
      }
    }
  }
  for (let i = 0; i < fixacoes.length; i++) {
    for (let j = i + 1; j < fixacoes.length; j++) {
      const x = fixacoes[i];
      const y = fixacoes[j];
      if (x.semestre === y.semestre && x.disc === y.disc && x.prof !== y.prof) {
        contradicao(x.id, y.id, 'Fixações incompatíveis para a mesma disciplina do semestre (RN-43)');
      }
    }
  }

  // Travas que excedem a carga da obrigação ou o teto docente
  const porObrigacao = new Map<string, number>();
  const porProfessor = new Map<string, number>();
  for (const o of ocupacoes) {
    porObrigacao.set(`${o.turma}|${o.disc}`, (porObrigacao.get(`${o.turma}|${o.disc}`) ?? 0) + 1);
    porProfessor.set(o.prof, (porProfessor.get(o.prof) ?? 0) + 1);
  }
  for (const [chave, n] of porObrigacao) {
    const [turma, disc] = chave.split('|');
    const d = disciplinas.get(disc);
    if (d && n > d.carga / K) {
      erros.push(erro('TRAVAS_EXCEDEM_CARGA', `Há ${n} blocos travados para uma obrigação de ${d.carga / K} blocos (RN-08)`,
        { turma_id: turma, disciplina_id: disc }));
    }
  }
  for (const [prof, n] of porProfessor) {
    if (n * K > TETO_AULAS_PROFESSOR) {
      erros.push(erro('TRAVAS_EXCEDEM_TETO', `Travas atribuem ${n * K} aulas ao professor, acima do teto de ${TETO_AULAS_PROFESSOR} (RN-20)`,
        { professor_id: prof }));
    }
  }
}

export function comoSnapshot(s: unknown): Snapshot {
  return s as Snapshot;
}
