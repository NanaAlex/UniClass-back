// Gera o dado simulado de execução usado pelo front-end a partir do conjunto
// de demonstração do front (src/mocks/demo/dadosDemo.json), rodando o motor
// real e montando a mesma resposta de GET /admin/geracoes/:runId.
//
//   npx ts-node -P tests/tsconfig.json scripts/execucaoDemoFront.ts <dadosDemo.json> <saida.json> [--limite S]

import { readFileSync, writeFileSync } from 'fs';
import { executarGeracao } from '../src/motor/geracao';
import { hashSnapshot } from '../src/motor/hash';
import { resumoPainel } from '../src/motor/painel';
import { LIMITE_EXECUCAO_SEGUNDOS, politicaDoSnapshot, SCHEMA_SNAPSHOT } from '../src/motor/politica';
import { gradePorTurma, projecaoPorProfessor } from '../src/motor/projecoes';
import type { Dia, Snapshot, Turno } from '../src/motor/tipos';

const DIA: Record<string, Dia> = { seg: 'SEGUNDA', ter: 'TERCA', qua: 'QUARTA', qui: 'QUINTA', sex: 'SEXTA', sab: 'SABADO' };
const TURNO: Record<string, Turno> = { manha: 'MANHA', tarde: 'TARDE', noite: 'NOITE' };

interface DadosDemo {
  periodoLetivo: string;
  aulasPorBloco: number;
  estruturas: { turno: string; dias: string[]; blocos: number }[];
  turmas: { id: string; nome: string; semestre: number; turno: string }[];
  disciplinas: { id: string; semestre: number; aulasPorSemana: number }[];
  respostas: {
    professorId: string;
    interesses: { disciplinaId: string; nivel: number }[];
    disponibilidade: string[];
    prioridadesPeriodo: Record<string, number>;
  }[];
}

async function main() {
  const [entrada, saida] = process.argv.slice(2);
  const iLim = process.argv.indexOf('--limite');
  const limite = iLim >= 0 ? Number(process.argv[iLim + 1]) : LIMITE_EXECUCAO_SEGUNDOS;
  const d = JSON.parse(readFileSync(entrada, 'utf8')) as DadosDemo;
  const runId = '5f0c2a1e-7d43-4c1b-9a8e-2027a0000001';

  const blocos = d.estruturas.flatMap((e) => e.dias.map((dia) => ({ dia: DIA[dia], turno: TURNO[e.turno], quantidade: e.blocos })));
  const s: Snapshot = {
    schema_version: SCHEMA_SNAPSHOT,
    run_id: runId,
    curso_id: 'es',
    periodo_letivo_id: d.periodoLetivo,
    form_version: 'f2027-1',
    snapshot_hash: '',
    K: d.aulasPorBloco,
    turnos: [...new Set(blocos.map((b) => b.turno))],
    dias_letivos: [...new Set(blocos.map((b) => b.dia))],
    blocos_por_dia_turno: blocos,
    turmas: d.turmas.map((t) => ({ id: t.id, semestre_id: `S${t.semestre}`, turno: TURNO[t.turno] })),
    disciplinas: d.disciplinas.map((x) => ({ id: x.id, semestre_id: `S${x.semestre}`, carga_aulas: x.aulasPorSemana })),
    professores_participantes: d.respostas.map((r) => {
      const selecionados = r.disponibilidade.map((k) => {
        const [turno, dia, indice] = k.split(':');
        return { dia: DIA[dia], turno: TURNO[turno], indice: Number(indice) };
      });
      return {
        id: r.professorId,
        disciplinas_selecionadas_e_notas: r.interesses.map((i) => ({ disciplina_id: i.disciplinaId, nota: i.nivel })),
        blocos_selecionados: selecionados,
        notas_dia_turno: Object.entries(r.prioridadesPeriodo).map(([k, nota]) => {
          const [turno, dia] = k.split(':');
          return { dia: DIA[dia], turno: TURNO[turno], nota };
        }),
      };
    }),
    travas: [],
    politica: politicaDoSnapshot(),
    limite_execucao_segundos: limite,
  };
  const snapshot = { ...s, snapshot_hash: hashSnapshot(s) };
  const inicio = new Date('2026-11-06T13:40:00Z');
  const e = await executarGeracao(snapshot, { permitirLimiteDeTeste: limite !== LIMITE_EXECUCAO_SEGUNDOS });
  const contexto = {
    professores_ativos: 10,
    respostas_enviadas: d.respostas.length,
    pendentes: 10 - d.respostas.length,
    professores_pendentes: [{ id: 'p2', nome: 'João Pereira Lima' }],
    geracao_antecipada_confirmada: true,
  };
  const resposta = {
    painel: resumoPainel(snapshot, e, { run_id: runId, curso_id: 'es', periodo_letivo_id: d.periodoLetivo }, contexto),
    grade_base_run_id: null,
    publicada_em: null,
    iniciada_em: inicio.toISOString(),
    concluida_em: new Date(inicio.getTime() + e.duracao_execucao_ms).toISOString(),
    travas_aplicadas: snapshot.travas,
    grade: e.grade_validada && e.resultado
      ? { K: snapshot.K, por_turma: gradePorTurma(snapshot, e.resultado.ocupacoes), por_professor: projecaoPorProfessor(snapshot, e.resultado.ocupacoes) }
      : null,
  };
  writeFileSync(saida, JSON.stringify(resposta, null, 1) + '\n');
  console.log(e.status_final, e.motivo_termino, `${(e.duracao_execucao_ms / 1000).toFixed(1)} s`, 'C=', e.resultado?.C,
    'provas:', (e.resultado?.prova_por_nivel ?? []).map((p) => (p.comprovado ? 'ok' : '-')).join(' '));
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
