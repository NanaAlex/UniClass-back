import { PoolConnection } from 'mysql2/promise';
import { chaveDuplicada, emTransacao } from '../database/transacao';
import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as administradorRepository from '../repositories/administradorRepository';
import * as blocoRepository from '../repositories/blocoRepository';
import * as diaLetivoRepository from '../repositories/diaLetivoRepository';
import * as materiaRepository from '../repositories/materiaRepository';
import * as semestreRepository from '../repositories/semestreRepository';
import * as turmaRepository from '../repositories/turmaRepository';
import { calcularAulas, paraHora, paraMinutos } from '../utils/horas';
import { TURNOS } from '../utils/validacoes';
import { ERRO_TAMANHO_UNICO } from './blocoService';
import { Dados, TurmaDados, TurnoDados, validarCorpoDados } from './dadosValidacao';
import * as semestreService from './semestreService';

// Aba Dados inteira (CU-015 a CU-022), no mesmo formato das rotas de cada assunto:
// os tres turnos com dias e blocos, os semestres com turmas e as disciplinas
export async function montarDados(idAdmin: number) {
    const [turnos, semestres, materias] = await Promise.all([
        Promise.all(TURNOS.map(async (turno) => ({
            turno,
            dias: await diaLetivoRepository.listarPorTurno(idAdmin, turno),
            blocos: await blocoRepository.listarPorTurno(idAdmin, turno),
        }))),
        semestreService.listarSemestres(idAdmin),
        materiaRepository.listarPorAdmin(idAdmin),
    ]);

    return { turnos, semestres, materias };
}

// Botao "Salvar dados": grava a aba inteira, tudo ou nada (D1 da spec 08.02)
export async function salvarDados(idAdmin: number, corpo: unknown) {
    const { erro, status, dados } = validarCorpoDados(corpo);

    if (!dados) {
      throw new ErroAplicacao(status ?? 400, erro!);
    }

    try {
        await emTransacao(async (conexao) => {
            await administradorRepository.travar(idAdmin, conexao);
            await sincronizar(conexao, idAdmin, dados);
        });
    } catch (erroGravacao) {
        // Chave unica (id_semestre, nome): nomes trocados entre si num mesmo salvamento
        if (chaveDuplicada(erroGravacao)) {
          throw new ErroAplicacao(409, 'Já existe uma disciplina ou turma com este nome neste semestre');
        }
        throw erroGravacao;
    }

    return montarDados(idAdmin);
}

/*
   Gravacao (dentro da transacao). Primeiro o que sai, depois o que muda e
   o que entra, para que nada dependa do que ainda vai ser apagado. Em uso =
   ja usado por respostas de professores ou horarios gerados (RN-11,
   constituicao Artigo 6.4): nao sai nem muda (409).
*/
async function sincronizar(conexao: PoolConnection, idAdmin: number, dados: Dados) {
    // Estado atual do admin
    const semestresBanco = await semestreRepository.listarIds(idAdmin, conexao);
    const turmasBanco = await turmaRepository.listarParaSincronizar(idAdmin, conexao);
    const materiasBanco = await materiaRepository.listarParaSincronizar(idAdmin, conexao);

    // A numeracao do semestre e a posicao por id (07.3)
    const numeroDoSemestre = new Map(semestresBanco.map((id, i) => [id, i + 1]));
    const turmaPorId = new Map(turmasBanco.map((t) => [t.id, t]));
    const materiaPorId = new Map(materiasBanco.map((m) => [m.id, m]));
    const totalSemestres = dados.semestres ? dados.semestres.length : semestresBanco.length;

    // Pertencimento dos ids enviados (400)
    for (const semestre of dados.semestres ?? []) {
        for (const turma of semestre.turmas) {
            if (turma.id === null) continue;
            const banco = turmaPorId.get(turma.id);
            if (!banco) throw new ErroAplicacao(400, 'Turma inválida');
            if (numeroDoSemestre.get(banco.idSemestre) !== semestre.numero) {
              throw new ErroAplicacao(400, `A turma ${banco.nome} não pertence ao ${semestre.numero}º semestre`);
            }
            if (banco.nome !== turma.nome) throw new ErroAplicacao(400, `A turma ${banco.nome} não pode ser renomeada`);
        }
    }
    for (const materia of dados.materias ?? []) {
        if (materia.id !== null && !materiaPorId.has(materia.id)) throw new ErroAplicacao(400, 'Disciplina inválida');
        if (materia.numeroSemestre > totalSemestres) throw new ErroAplicacao(400, 'Semestre inválido');
    }

    // Tamanho unico tambem com os turnos que nao vieram no corpo (ficam como estao)
    if (dados.turnos) {
        const enviados = new Set(dados.turnos.map((t) => t.turno));
        const doBanco = await blocoRepository.tamanhosPorTurno(idAdmin, conexao);
        const tamanhos = new Set<number>([
            ...dados.turnos.filter((t) => t.blocos.length).map((t) => t.qtdAulas),
            ...doBanco.filter((linha) => !enviados.has(linha.turno)).map((linha) => linha.qtdAulas),
        ]);
        if (tamanhos.size > 1) throw new ErroAplicacao(400, ERRO_TAMANHO_UNICO);
    }

    // 1. Disciplinas que saem
    if (dados.materias) {
        const mantidas = new Set(dados.materias.map((m) => m.id));
        for (const banco of materiasBanco) {
            if (mantidas.has(banco.id)) continue;
            if (banco.emUso) {
              throw new ErroAplicacao(409, `A disciplina "${banco.nome}" já é usada em respostas de professores ou em horários e não pode ser excluída`);
            }
            await materiaRepository.excluir(banco.id, conexao);
        }
    }

    // 2. Turmas que saem ou mudam de turno
    if (dados.semestres) {
        const enviadas = new Map<number, TurmaDados>();
        dados.semestres.forEach((s) => s.turmas.forEach((t) => t.id !== null && enviadas.set(t.id, t)));

        for (const banco of turmasBanco) {
            const enviada = enviadas.get(banco.id);
            const numero = numeroDoSemestre.get(banco.idSemestre);
            if (!enviada) {
                if (banco.emUso) {
                  throw new ErroAplicacao(409, `A turma ${banco.nome} do ${numero}º semestre é usada em horários gerados e não pode ser retirada`);
                }
                await turmaRepository.excluir(banco.id, conexao);
            } else if (enviada.turno !== banco.turno) {
                if (banco.emUso) {
                  throw new ErroAplicacao(409, `A turma ${banco.nome} do ${numero}º semestre é usada em horários gerados e não pode mudar de turno`);
                }
                await turmaRepository.alterarTurno(banco.id, enviada.turno, conexao);
            }
        }
    }

    // 3. Semestres: so os ultimos saem (D4); os novos entram no fim
    const idsSemestres = [...semestresBanco];
    if (dados.semestres) {
        while (idsSemestres.length > dados.semestres.length) {
            const idSemestre = idsSemestres.pop()!;
            const numero = idsSemestres.length + 1;
            // As disciplinas e turmas que saem ja foram apagadas nesta transacao
            if (await semestreRepository.temDependencias(idSemestre, conexao)) {
              throw new ErroAplicacao(409, `O ${numero}º semestre possui disciplinas, formulários, horários ou turmas em uso e não pode ser excluído`);
            }
            await semestreRepository.excluir(idSemestre, conexao);
        }
        while (idsSemestres.length < dados.semestres.length) {
            idsSemestres.push(await semestreRepository.inserir(idAdmin, `${idsSemestres.length + 1}º Semestre`, conexao));
        }

        // 4. Turmas novas, com a letra que a tela mostrou (R8)
        const novas = dados.semestres.flatMap((s) =>
            s.turmas.filter((t) => t.id === null).map((t): [number, string, string] => [idsSemestres[s.numero - 1], t.nome, t.turno])
        );
        if (novas.length) await turmaRepository.inserirVarias(novas, conexao);
    }

    // 5. Disciplinas que mudam e as novas
    for (const materia of dados.materias ?? []) {
        const idSemestre = idsSemestres[materia.numeroSemestre - 1];
        const gravar = { idSemestre, nome: materia.nome, qtdAulasSemana: materia.qtdAulasSemana, qtdProfessores: materia.qtdProfessores };
        if (materia.id === null) {
            await materiaRepository.inserir(gravar, conexao);
            continue;
        }

        const banco = materiaPorId.get(materia.id)!;
        const mudou = banco.nome !== materia.nome || banco.idSemestre !== idSemestre
            || banco.qtdAulasSemana !== materia.qtdAulasSemana || banco.qtdProfessores !== materia.qtdProfessores;
        if (!mudou) continue;
        if (banco.emUso) {
          throw new ErroAplicacao(409, `A disciplina "${banco.nome}" já é usada em respostas de professores ou em horários e não pode ser alterada`);
        }
        await materiaRepository.atualizar(materia.id, gravar, conexao);
    }

    // 6. Dias e blocos de cada turno enviado
    for (const turno of dados.turnos ?? []) {
        await sincronizarDias(conexao, idAdmin, turno);
        await sincronizarBlocos(conexao, idAdmin, turno);
    }
}

async function sincronizarDias(conexao: PoolConnection, idAdmin: number, turno: TurnoDados) {
    const diasBanco = await diaLetivoRepository.listarParaSincronizar(idAdmin, turno.turno, conexao);

    for (const banco of diasBanco) {
        if (turno.dias.includes(banco.diaSemana)) continue;
        if (banco.emUso) {
          throw new ErroAplicacao(409, `${banco.diaSemana} do turno ${turno.turno} já é usada em respostas ou horários e não pode ser excluída`);
        }
        await diaLetivoRepository.excluir(banco.id, conexao);
    }

    const novos = turno.dias.filter((dia) => !diasBanco.some((banco) => banco.diaSemana === dia));
    if (novos.length) {
      await diaLetivoRepository.inserirVarios(idAdmin, turno.turno, novos, conexao);
    }
}

/*
   R7: o bloco igual ao da mesma posicao fica (o id nao muda); os outros sao
   recriados. Bloco em uso nao pode sair nem mudar de horario ou de tamanho.
*/
async function sincronizarBlocos(conexao: PoolConnection, idAdmin: number, turno: TurnoDados) {
    const blocosBanco = await blocoRepository.listarParaSincronizar(idAdmin, turno.turno, conexao);

    const mantidos = new Set<number>();
    for (const [i, banco] of blocosBanco.entries()) {
        const enviado = turno.blocos[i];
        const igual = enviado
            && banco.ordem === i + 1
            && paraMinutos(banco.horaInicio) === enviado.inicio
            && Number(banco.duracaoAula) === enviado.duracaoAula
            && banco.qtdAulas === turno.qtdAulas;
        if (igual) {
            mantidos.add(i);
            continue;
        }
        if (banco.emUso) {
          throw new ErroAplicacao(409, `O bloco ${i + 1} do turno ${turno.turno} já é usado em respostas ou horários e não pode ser alterado nem excluído`);
        }
        await blocoRepository.excluirAulas(banco.id, conexao);
        await blocoRepository.excluir(banco.id, conexao);
    }

    for (const [i, bloco] of turno.blocos.entries()) {
        if (mantidos.has(i)) continue;
        const aulas = calcularAulas(bloco.inicio, bloco.duracaoAula, turno.qtdAulas);
        const idBloco = await blocoRepository.inserir(idAdmin, turno.turno, i + 1, turno.qtdAulas,
            paraHora(bloco.inicio), paraHora(aulas[aulas.length - 1].fim), conexao);
        await blocoRepository.inserirAulas(idBloco,
            aulas.map((aula) => ({ numero: aula.numero, inicio: paraHora(aula.inicio), fim: paraHora(aula.fim) })), conexao);
    }
}
