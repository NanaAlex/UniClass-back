import { PoolConnection } from 'mysql2/promise';
import { emTransacao } from '../database/transacao';
import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as blocoRepository from '../repositories/blocoRepository';
import { Bloco } from '../repositories/blocoRepository';
import { MINUTOS_NO_DIA, calcularAulas, horaValida, paraHora, paraMinutos } from '../utils/horas';
import { TURNOS, inteiroPositivo, lerTurno } from '../utils/validacoes';

// O escalonador (motor Prolog) usa um tamanho de bloco unico, igual em todos os
// turnos (K); com tamanhos diferentes ele recusa a geracao (K_NAO_GLOBAL)
export const ERRO_TAMANHO_UNICO = 'Todos os turnos devem ter a mesma quantidade de aulas por bloco';

const ERRO_QTD_AULAS = 'A quantidade de aulas deve ser um número inteiro maior que zero';
const ERRO_DEPOIS_DO_ANTERIOR = 'O bloco deve começar depois do fim do bloco anterior, com um intervalo entre eles';
const ERRO_MEIA_NOITE = 'O bloco deve terminar antes da meia-noite';

export interface BlocosDoTurno {
    turno: string;
    blocos: Bloco[];
}

function validarTurno(valor: unknown): string {
    const turno = lerTurno(valor);
    if (!turno) throw new ErroAplicacao(400, 'Turno inválido');
    return turno;
}

// Horario de inicio e duracao da aula, enviados na criacao e na edicao
function validarCorpoBloco(corpo: any): { horaInicio: string; duracaoAula: number } {
    const { horaInicio, duracaoAula } = corpo ?? {};

    if (!horaValida(horaInicio)) {
      throw new ErroAplicacao(400, 'Informe o horário de início no formato HH:MM');
    }
    if (!inteiroPositivo(duracaoAula)) {
      throw new ErroAplicacao(400, 'A duração da aula deve ser um número inteiro de minutos maior que zero');
    }

    return { horaInicio, duracaoAula };
}

async function blocosDoTurno(idAdmin: number, turno: string): Promise<BlocosDoTurno> {
    return { turno, blocos: await blocoRepository.listarPorTurno(idAdmin, turno) };
}

// Bloco do admin; id invalido ou de outro admin e 404
async function buscarBlocoDoAdmin(idAdmin: number, idBloco: number) {
    const bloco = Number.isInteger(idBloco) ? await blocoRepository.buscarDoAdmin(idAdmin, idBloco) : null;

    if (!bloco) {
      throw new ErroAplicacao(404, 'Bloco não encontrado');
    }
    return bloco;
}

// Apaga as aulas do bloco e grava novamente com os horarios calculados
async function regravarAulas(conexao: PoolConnection, idBloco: number, inicio: number, duracaoAula: number, qtdAulas: number) {
    const aulas = calcularAulas(inicio, duracaoAula, qtdAulas);

    await blocoRepository.excluirAulas(idBloco, conexao);
    await blocoRepository.inserirAulas(idBloco,
        aulas.map((aula) => ({ numero: aula.numero, inicio: paraHora(aula.inicio), fim: paraHora(aula.fim) })), conexao);
    await blocoRepository.atualizarHorario(idBloco, qtdAulas, paraHora(inicio), paraHora(aulas[aulas.length - 1].fim), conexao);
}

export async function listarBlocos(idAdmin: number, turnoInformado: unknown): Promise<BlocosDoTurno> {
    return blocosDoTurno(idAdmin, validarTurno(turnoInformado));
}

// CU-017: adiciona um bloco no fim do turno, com intervalo em relacao ao anterior
export async function criarBloco(idAdmin: number, turnoInformado: unknown, corpo: any): Promise<BlocosDoTurno> {
    const turno = validarTurno(turnoInformado);
    const { horaInicio, duracaoAula } = validarCorpoBloco(corpo);
    const { qtdAulas } = corpo ?? {};

    if (qtdAulas !== undefined && !inteiroPositivo(qtdAulas)) {
      throw new ErroAplicacao(400, ERRO_QTD_AULAS);
    }

    const blocos = await blocoRepository.listarComDuracao(idAdmin, turno);
    const anterior = blocos.length > 0 ? blocos[blocos.length - 1] : null;

    // Todos os blocos do turno tem a mesma quantidade de aulas
    let qtd: number | undefined = qtdAulas;
    if (anterior) {
        if (qtdAulas !== undefined && qtdAulas !== anterior.qtdAulas) {
          throw new ErroAplicacao(400,
            `Os blocos deste turno têm ${anterior.qtdAulas} aulas; altere o tamanho do turno para mudar a quantidade`);
        }
        qtd = anterior.qtdAulas;
    } else {
        // Primeiro bloco do turno: o tamanho e o dos outros turnos (escalonador, K unico)
        const [tamanho] = await blocoRepository.tamanhosDosOutrosTurnos(idAdmin, turno);
        if (tamanho !== undefined) {
            if (qtdAulas !== undefined && qtdAulas !== tamanho) {
              throw new ErroAplicacao(400, `${ERRO_TAMANHO_UNICO}; os outros turnos têm ${tamanho}`);
            }
            qtd = tamanho;
        } else if (qtd === undefined) {
            throw new ErroAplicacao(400, 'Informe a quantidade de aulas do bloco');
        }
    }

    const quantidade = qtd as number;
    const inicio = paraMinutos(horaInicio);
    const fim = inicio + quantidade * duracaoAula;

    if (fim >= MINUTOS_NO_DIA) {
      throw new ErroAplicacao(400, ERRO_MEIA_NOITE);
    }
    if (anterior && inicio <= paraMinutos(anterior.horaFim)) {
      throw new ErroAplicacao(400, ERRO_DEPOIS_DO_ANTERIOR);
    }

    await emTransacao(async (conexao) => {
        const idBloco = await blocoRepository.inserir(idAdmin, turno, anterior ? anterior.ordem + 1 : 1, quantidade,
            paraHora(inicio), paraHora(fim), conexao);
        await regravarAulas(conexao, idBloco, inicio, duracaoAula, quantidade);
    });

    return blocosDoTurno(idAdmin, turno);
}

// Edita horario de inicio e duracao das aulas de um bloco
export async function editarBloco(idAdmin: number, idBloco: number, corpo: unknown): Promise<BlocosDoTurno> {
    const { horaInicio, duracaoAula } = validarCorpoBloco(corpo);
    const bloco = await buscarBlocoDoAdmin(idAdmin, idBloco);

    if (await blocoRepository.algumEmUso([bloco.id])) {
      throw new ErroAplicacao(409,
        'Este bloco já é usado em respostas de professores ou em horários gerados e não pode ser alterado');
    }

    const blocos = await blocoRepository.listarComDuracao(idAdmin, bloco.turno);
    const posicao = blocos.findIndex((item) => item.id === bloco.id);
    const anterior = blocos[posicao - 1];
    const proximo = blocos[posicao + 1];

    const inicio = paraMinutos(horaInicio);
    const fim = inicio + bloco.qtdAulas * duracaoAula;

    if (fim >= MINUTOS_NO_DIA) {
      throw new ErroAplicacao(400, ERRO_MEIA_NOITE);
    }
    if (anterior && inicio <= paraMinutos(anterior.horaFim)) {
      throw new ErroAplicacao(400, ERRO_DEPOIS_DO_ANTERIOR);
    }
    if (proximo && fim >= paraMinutos(proximo.horaInicio)) {
      throw new ErroAplicacao(400,
        'O bloco deve terminar antes do início do próximo bloco, com um intervalo entre eles');
    }

    await emTransacao((conexao) => regravarAulas(conexao, bloco.id, inicio, duracaoAula, bloco.qtdAulas));

    return blocosDoTurno(idAdmin, bloco.turno);
}

// CU-016: altera a quantidade de aulas de todos os blocos (o tamanho e unico em todos os turnos)
export async function alterarTamanhoBlocos(idAdmin: number, turnoInformado: unknown, qtdAulas: unknown): Promise<BlocosDoTurno> {
    const turno = validarTurno(turnoInformado);

    if (!inteiroPositivo(qtdAulas)) {
      throw new ErroAplicacao(400, ERRO_QTD_AULAS);
    }

    // O tamanho e unico em todos os turnos (escalonador, K): muda os blocos de todos
    const porTurno = await Promise.all(TURNOS.map(async (nome) => ({
        nome, blocos: await blocoRepository.listarComDuracao(idAdmin, nome),
    })));
    const blocos = porTurno.flatMap((item) => item.blocos);

    if (porTurno.find((item) => item.nome === turno)!.blocos.length === 0) {
      throw new ErroAplicacao(404, 'Não há blocos cadastrados neste turno');
    }

    if (await blocoRepository.algumEmUso(blocos.map((item) => item.id))) {
      throw new ErroAplicacao(409,
        'Há blocos usados em respostas de professores ou em horários gerados; o tamanho não pode ser alterado');
    }

    // Cada bloco mantem inicio e duracao; so o fim muda
    for (const { nome, blocos: doTurno } of porTurno) {
        for (let i = 0; i < doTurno.length; i++) {
            const fim = paraMinutos(doTurno[i].horaInicio) + qtdAulas * doTurno[i].duracaoAula;
            const proximo = doTurno[i + 1];

            if (fim >= MINUTOS_NO_DIA) {
              throw new ErroAplicacao(400,
                `Com ${qtdAulas} aulas, o bloco ${doTurno[i].ordem} do turno ${nome} terminaria depois da meia-noite`);
            }
            if (proximo && fim >= paraMinutos(proximo.horaInicio)) {
              throw new ErroAplicacao(400,
                `Com ${qtdAulas} aulas, o bloco ${doTurno[i].ordem} do turno ${nome} invadiria o intervalo antes do bloco ${proximo.ordem}`);
            }
        }
    }

    await emTransacao(async (conexao) => {
        for (const bloco of blocos) {
            await regravarAulas(conexao, bloco.id, paraMinutos(bloco.horaInicio), bloco.duracaoAula, qtdAulas);
        }
    });

    return blocosDoTurno(idAdmin, turno);
}

// CU-017: exclui um bloco e reordena os seguintes
export async function excluirBloco(idAdmin: number, idBloco: number): Promise<BlocosDoTurno> {
    const bloco = await buscarBlocoDoAdmin(idAdmin, idBloco);

    if (await blocoRepository.algumEmUso([bloco.id])) {
      throw new ErroAplicacao(409,
        'Este bloco já é usado em respostas de professores ou em horários gerados e não pode ser excluído');
    }

    await emTransacao(async (conexao) => {
        await blocoRepository.excluirAulas(bloco.id, conexao);
        await blocoRepository.excluir(bloco.id, conexao);
        await blocoRepository.reordenarApos(idAdmin, bloco.turno, bloco.ordem, conexao);
    });

    return blocosDoTurno(idAdmin, bloco.turno);
}
