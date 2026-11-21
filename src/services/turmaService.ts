import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as semestreRepository from '../repositories/semestreRepository';
import * as turmaRepository from '../repositories/turmaRepository';
import { Turma, TurmaDoSemestre } from '../repositories/turmaRepository';
import { lerTurno } from '../utils/validacoes';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface TurmasDoSemestre {
    idSemestre: number;
    turmas: Turma[];
}

function validarTurno(valor: unknown): string {
    const turno = lerTurno(valor);
    if (!turno) throw new ErroAplicacao(400, 'Turno inválido');
    return turno;
}

// Turma de um semestre do admin; id invalido ou de outro admin e 404
async function buscarTurmaDoAdmin(idAdmin: number, idTurma: number): Promise<TurmaDoSemestre> {
    const turma = Number.isInteger(idTurma) ? await turmaRepository.buscarDoAdmin(idAdmin, idTurma) : null;

    if (!turma) {
      throw new ErroAplicacao(404, 'Turma não encontrada');
    }
    return turma;
}

async function turmasDoSemestre(idSemestre: number): Promise<TurmasDoSemestre> {
    return { idSemestre, turmas: await turmaRepository.listarPorSemestre(idSemestre) };
}

// CU-019: o "+" do cartao adiciona a turma com a primeira letra livre; sem turno, MANHA
export async function adicionarTurma(idAdmin: number, idSemestre: number, turnoInformado: unknown): Promise<TurmasDoSemestre> {
    const turno = turnoInformado === undefined ? 'MANHA' : validarTurno(turnoInformado);

    // CU-019 A1
    if (!Number.isInteger(idSemestre) || !(await semestreRepository.existeDoAdmin(idAdmin, idSemestre))) {
      throw new ErroAplicacao(404, 'Semestre não encontrado');
    }

    const usadas = await turmaRepository.listarNomes(idSemestre);
    const nome = LETRAS.find((letra) => !usadas.includes(letra));

    if (!nome) {
      throw new ErroAplicacao(409, 'O semestre já tem 26 turmas (A a Z)');
    }

    // Chave unica (id_semestre, nome): dois cliques ao mesmo tempo
    if (!(await turmaRepository.inserir(idSemestre, nome, turno))) {
      throw new ErroAplicacao(409, 'Esta turma acabou de ser criada; atualize a lista');
    }

    return turmasDoSemestre(idSemestre);
}

// CU-019: seletor de turno da turma
export async function alterarTurnoTurma(idAdmin: number, idTurma: number, turnoInformado: unknown): Promise<TurmasDoSemestre> {
    const turno = validarTurno(turnoInformado);
    const turma = await buscarTurmaDoAdmin(idAdmin, idTurma);

    // CU-019 A2: a grade gerada depende do turno da turma
    if (turma.emUso) {
      throw new ErroAplicacao(409, 'Esta turma é usada em horários gerados e não pode mudar de turno');
    }

    await turmaRepository.alterarTurno(turma.id, turno);

    return turmasDoSemestre(turma.idSemestre);
}

// CU-019: retira a turma sem renomear as outras
export async function retirarTurma(idAdmin: number, idTurma: number): Promise<TurmasDoSemestre> {
    const turma = await buscarTurmaDoAdmin(idAdmin, idTurma);

    // CU-019 A2
    if (turma.emUso) {
      throw new ErroAplicacao(409, 'Esta turma é usada em horários gerados e não pode ser retirada');
    }

    await turmaRepository.excluir(turma.id);

    return turmasDoSemestre(turma.idSemestre);
}
