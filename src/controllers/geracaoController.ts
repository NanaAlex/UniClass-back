import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import pool from '../database/connection';
import { aplicarAcao, lerAcao } from '../motor/edicao';
import { executarGeracao, type ExecucaoFinal } from '../motor/geracao';
import { hashTexto } from '../motor/hash';
import { resumoPainel } from '../motor/painel';
import { gradePorTurma, projecaoPorProfessor } from '../motor/projecoes';
import { publicarExecucao } from '../motor/publicacao';
import * as repo from '../motor/repositorio';
import { carregarDadosAdmin, montarSnapshotDeDados, PERIODO_VALIDO } from '../motor/snapshotMysql';
import type { CamposGrade, Diagnostico, Snapshot } from '../motor/tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const consultar = async (sql: string, params?: unknown[]) => {
    const [rows] = await pool.query(sql, params);
    return rows as any[];
};

function camposGrade(ev: any): CamposGrade {
    return {
        ocupacoes: ev.ocupacoes, C: ev.C, parcelas: ev.parcelas, aulas_por_professor: ev.aulas_por_professor,
        total_aulas_por_turma_disciplina: ev.total_aulas_por_turma_disciplina, max_M_p: ev.max_M_p,
        min_M_p: ev.min_M_p, amplitude_M: ev.amplitude_M, chave_canonica: ev.chave_canonica,
    };
}

// Hash da grade-base: identifica a grade exata (conteúdo canônico + snapshot)
const hashGrade = (snapshotHash: string, chave: string) => hashTexto(`${snapshotHash}|${chave}`);

// Execução em segundo plano, sob o supervisor (prazo único de 600 s). O
// último incumbente é guardado periodicamente como candidato recuperável.
async function executarEmSegundoPlano(runId: string, snapshot: Snapshot, avisos: Diagnostico[]) {
    let salvoEm = 0;
    try {
        const final = await executarGeracao(snapshot, {
            aoEvento: (ev) => {
                if (ev.tipo === 'incumbente' && Date.now() - salvoEm > 5000) {
                    salvoEm = Date.now();
                    repo.salvarCandidato(pool, runId, camposGrade(ev)).catch((e) => console.error('Erro ao salvar candidato:', runId, e));
                }
            },
        });
        final.diagnosticos = [...final.diagnosticos, ...avisos];
        await repo.concluirExecucao(pool, runId, final);
    } catch (error) {
        console.error('Erro na execução da geração:', runId, error);
        const falha: ExecucaoFinal = {
            run_id: runId, snapshot_hash: snapshot.snapshot_hash, status_final: 'ERRO_EXECUCAO', motivo_termino: 'ERRO_BACKEND',
            resultado: null, resultado_motor: null, validacao: null, grade_validada: false, candidato_recuperavel: null,
            encerrado_por_prazo: false, duracao_execucao_ms: 0, tempo_primeira_grade_ms: null, detalhe_tecnico: null,
            diagnosticos: [{
                categoria: 'falha_tecnica', codigo: 'ERRO_BACKEND', severidade: 'erro', etapa: 'supervisao', entidades: {},
                natureza_evidencia: 'falha_tecnica', mensagem: 'Falha técnica do backend durante a geração; não se trata de inviabilidade',
            }],
        };
        await repo.concluirExecucao(pool, runId, falha).catch(() => undefined);
    }
}

function reconstruirFinal(exec: repo.ExecucaoRegistrada): ExecucaoFinal | null {
    if (exec.status === 'EM_PROCESSAMENTO') return null;
    return {
        run_id: exec.run_id,
        snapshot_hash: exec.snapshot_hash ?? '',
        status_final: exec.status,
        motivo_termino: exec.motivo_termino ?? exec.status,
        resultado: exec.status === 'ERRO_EXECUCAO' ? null : exec.resultado,
        resultado_motor: exec.resultado,
        validacao: exec.validacao,
        grade_validada: exec.grade_validada,
        diagnosticos: exec.diagnosticos,
        candidato_recuperavel: exec.candidato_recuperavel,
        encerrado_por_prazo: exec.motivo_termino === 'LIMITE_TEMPO_SUPERVISOR',
        duracao_execucao_ms: exec.duracao_ms ?? 0,
        tempo_primeira_grade_ms: exec.tempo_primeira_grade_ms,
        detalhe_tecnico: null,
    };
}

function corpoEstrito(corpo: unknown, permitidos: string[]): string | null {
    if (corpo === undefined || corpo === null) return null;
    if (typeof corpo !== 'object' || Array.isArray(corpo)) return 'Corpo da requisição inválido';
    const extras = Object.keys(corpo).filter((k) => !permitidos.includes(k));
    return extras.length ? `Campos não previstos: ${extras.join(', ')}` : null;
}

// RN-24, RN-37, ET-01: congela o snapshot, pede confirmação quando há
// professores pendentes e dispara a geração (resposta 202, status por run_id)
export async function gerarHorario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const corpo = req.body ?? {};
    const erroCorpo = corpoEstrito(corpo, ['periodoLetivo', 'confirmarGeracaoAntecipada', 'gradeBaseRunId']);
    if (erroCorpo) return resposta.status(400).json({ error: erroCorpo });
    if (typeof corpo.periodoLetivo !== 'string' || !PERIODO_VALIDO.test(corpo.periodoLetivo)) {
        return resposta.status(400).json({ error: 'Informe periodoLetivo no formato AAAA/1 ou AAAA/2' });
    }
    if (corpo.confirmarGeracaoAntecipada !== undefined && typeof corpo.confirmarGeracaoAntecipada !== 'boolean') {
        return resposta.status(400).json({ error: 'confirmarGeracaoAntecipada deve ser booleano' });
    }
    if (corpo.gradeBaseRunId !== undefined && (typeof corpo.gradeBaseRunId !== 'string' || !UUID.test(corpo.gradeBaseRunId))) {
        return resposta.status(400).json({ error: 'gradeBaseRunId inválido' });
    }
    const periodo: string = corpo.periodoLetivo;

    try {
        if (await repo.existeEmProcessamento(pool, id)) {
            return resposta.status(409).json({ error: 'Já existe uma geração em processamento; aguarde a conclusão' });
        }
        const runId = randomUUID();
        const dados = await carregarDadosAdmin(consultar, id, periodo);
        const montado = montarSnapshotDeDados(dados, { runId, periodoLetivo: periodo });

        // RN-37, CA-83: sem confirmação explícita, a geração não começa
        if (montado.formulario.pendentes > 0 && corpo.confirmarGeracaoAntecipada !== true) {
            return resposta.status(409).json({
                error: 'Há professores ativos sem resposta enviada; confirme a geração antecipada',
                codigo: 'CONFIRMACAO_GERACAO_ANTECIPADA',
                pendentes: montado.formulario.pendentes,
                professores_pendentes: montado.formulario.professores_pendentes,
                consequencias: 'Os professores pendentes ficam fora desta geração: não recebem aulas e não entram no mínimo de uma disciplina. ' +
                    'Nenhuma seleção ou disponibilidade é presumida para eles.',
            });
        }
        const contexto = { ...montado.formulario, geracao_antecipada_confirmada: montado.formulario.pendentes > 0 };

        let gradeBase: string | null = corpo.gradeBaseRunId ?? null;
        if (gradeBase) {
            const base = await repo.buscarExecucao(pool, id, gradeBase);
            if (!base || !base.grade_validada) return resposta.status(409).json({ error: 'A grade-base precisa ser uma grade completa validada (CA-135)' });
        } else {
            const travas = await repo.listarTravas(pool, id, periodo);
            gradeBase = travas.length ? travas[travas.length - 1].grade_base_run_id : null;
        }

        const comum = {
            run_id: runId, id_admin: id, periodo_letivo: periodo, id_formulario: dados.formulario?.id_formulario ?? null,
            contexto_formulario: contexto, confirmacao_antecipada: contexto.geracao_antecipada_confirmada,
            grade_base_run_id: gradeBase, id_responsavel: id,
            curso_id: dados.cursos.length === 1 ? String(dados.cursos[0].id_curso) : `adm-${id}`,
        };

        if (!montado.snapshot) {
            const diagnosticos = [...montado.erros, ...montado.avisos];
            await repo.inserirExecucao(pool, { ...comum, snapshot: null, status: 'ENTRADA_INVALIDA', diagnosticos });
            return resposta.status(201).json({ runId, status: 'ENTRADA_INVALIDA', diagnosticos });
        }

        await repo.inserirExecucao(pool, { ...comum, snapshot: montado.snapshot, status: 'EM_PROCESSAMENTO', diagnosticos: montado.avisos });
        void executarEmSegundoPlano(runId, montado.snapshot, montado.avisos);

        return resposta.status(202).json({
            runId,
            status: 'EM_PROCESSAMENTO',
            snapshotHash: montado.snapshot.snapshot_hash,
            limiteExecucaoSegundos: montado.snapshot.limite_execucao_segundos,
        });
    } catch (error) {
        console.error('Erro ao iniciar a geração:', error);
        return resposta.status(500).json({ error: 'Erro interno ao iniciar a geração do horário' });
    }
}

export async function listarGeracoes(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const periodo = req.query.periodoLetivo;
    if (periodo !== undefined && (typeof periodo !== 'string' || !PERIODO_VALIDO.test(periodo))) {
        return resposta.status(400).json({ error: 'periodoLetivo inválido' });
    }
    try {
        return resposta.json({ geracoes: await repo.listarExecucoes(pool, id, (periodo as string) ?? null) });
    } catch (error) {
        console.error('Erro ao listar gerações:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar as gerações' });
    }
}

// Painel técnico (RN-59, RN-60, ET-12) e projeções da mesma grade canônica
export async function verGeracao(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const runId = String(req.params.runId);
    if (!UUID.test(runId)) return resposta.status(404).json({ error: 'Geração não encontrada' });
    try {
        const exec = await repo.buscarExecucao(pool, id, runId);
        if (!exec) return resposta.status(404).json({ error: 'Geração não encontrada' });
        const final = reconstruirFinal(exec);
        const painel = resumoPainel(exec.snapshot, final,
            { run_id: exec.run_id, curso_id: exec.curso_id, periodo_letivo_id: exec.periodo_letivo, status: exec.status },
            exec.contexto_formulario);
        const comGrade = exec.grade_validada && exec.resultado && exec.snapshot;
        return resposta.json({
            painel,
            grade_base_run_id: exec.grade_base_run_id,
            publicada_em: exec.publicada_em,
            travas_aplicadas: exec.snapshot?.travas ?? [],
            grade: comGrade
                ? {
                    K: exec.snapshot!.K,
                    por_turma: gradePorTurma(exec.snapshot!, exec.resultado!.ocupacoes),
                    por_professor: projecaoPorProfessor(exec.snapshot!, exec.resultado!.ocupacoes),
                }
                : null,
        });
    } catch (error) {
        console.error('Erro ao consultar geração:', error);
        return resposta.status(500).json({ error: 'Erro interno ao consultar a geração' });
    }
}

export async function listarTravasDoPeriodo(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const periodo = req.query.periodoLetivo;
    if (typeof periodo !== 'string' || !PERIODO_VALIDO.test(periodo)) return resposta.status(400).json({ error: 'Informe periodoLetivo (AAAA/1 ou AAAA/2)' });
    try {
        return resposta.json({ periodoLetivo: periodo, travas: await repo.listarTravas(pool, id, periodo) });
    } catch (error) {
        console.error('Erro ao listar travas:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar as travas' });
    }
}

// ET-08: bloqueios e trocas sobre uma grade-base validada; a grade só muda
// após nova geração, validação e aprovação (RN-40, CA-112, CA-135)
export async function aplicarEdicao(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const runId = String(req.params.runId);
    if (!UUID.test(runId)) return resposta.status(404).json({ error: 'Geração não encontrada' });
    const { acao, erro } = lerAcao(req.body);
    if (!acao) return resposta.status(400).json({ error: erro!.mensagem, diagnosticos: [erro] });

    const conexao = await pool.getConnection();
    try {
        await conexao.beginTransaction();
        await conexao.query('SELECT id_usuario FROM administrador WHERE id_usuario = ? FOR UPDATE', [id]);
        const base = await repo.buscarExecucao(conexao, id, runId);
        if (!base) {
            await conexao.rollback();
            return resposta.status(404).json({ error: 'Geração não encontrada' });
        }
        if (!base.grade_validada || !base.resultado || !base.snapshot || !base.resultado.chave_canonica) {
            await conexao.rollback();
            return resposta.status(409).json({ error: 'Só uma grade completa validada pode ser base de edição (RN-40, CA-135)' });
        }
        const existentes = await repo.listarTravas(conexao, id, base.periodo_letivo);
        const r = aplicarAcao(
            { run_id: base.run_id, snapshot: base.snapshot, ocupacoes: base.resultado.ocupacoes,
              hash_grade: hashGrade(base.snapshot.snapshot_hash, base.resultado.chave_canonica) },
            existentes.map((t) => t.trava),
            acao,
        );
        if (!r.ok) {
            await conexao.rollback();
            return resposta.status(r.status).json({ error: r.erros[0]?.mensagem ?? 'Edição recusada', diagnosticos: r.erros });
        }
        await repo.inserirTravas(conexao, {
            id_admin: id, periodo: base.periodo_letivo, travas: r.novas, acao: acao.acao, id_acao: randomUUID(),
            grade_base_run_id: base.run_id, id_responsavel: id,
        });
        await conexao.commit();
        return resposta.status(201).json({
            message: 'Bloqueios registrados. A grade só muda depois de nova geração, validação e aprovação.',
            travasCriadas: r.novas.length,
            travasJaExistentes: r.ignoradas,
        });
    } catch (error) {
        await conexao.rollback();
        console.error('Erro ao aplicar edição:', error);
        return resposta.status(500).json({ error: 'Erro interno ao aplicar a edição' });
    } finally {
        conexao.release();
    }
}

export async function publicarGeracao(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const runId = String(req.params.runId);
    if (!UUID.test(runId)) return resposta.status(404).json({ error: 'Geração não encontrada' });
    // CA-216: status, custo, travas ou base nunca vêm do cliente
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        return resposta.status(400).json({ error: 'A publicação não aceita dados no corpo; ela usa somente a execução validada' });
    }
    const conexao = await pool.getConnection();
    try {
        await conexao.beginTransaction();
        const r = await publicarExecucao(conexao, id, runId, id);
        if (!r.ok) {
            await conexao.rollback();
            return resposta.status(r.status).json({ error: r.mensagem, codigo: r.codigo, diagnosticos: r.diagnosticos ?? [] });
        }
        await conexao.commit();
        return resposta.json({ message: 'Horário publicado', geracoes: r.geracoes, aulas: r.aulas });
    } catch (error) {
        await conexao.rollback();
        console.error('Erro ao publicar geração:', error);
        return resposta.status(500).json({ error: 'Erro interno ao publicar o horário' });
    } finally {
        conexao.release();
    }
}
