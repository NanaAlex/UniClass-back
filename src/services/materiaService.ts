import { chaveDuplicada } from '../database/transacao';
import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as materiaRepository from '../repositories/materiaRepository';
import { DadosMateria, Materia } from '../repositories/materiaRepository';
import * as semestreRepository from '../repositories/semestreRepository';
import { quantidadeValida } from '../utils/validacoes';

const ERRO_NOME_REPETIDO = 'Já existe uma disciplina com este nome neste semestre';

// Formato do cadastro e da edicao (400)
function validarCorpoMateria(corpo: any): DadosMateria {
    const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';
    const { qtdAulasSemana, qtdProfessores, idSemestre } = corpo ?? {};

    if (!nome) {
      throw new ErroAplicacao(400, 'Informe o nome da disciplina');
    }
    if (nome.length > 255) {
      throw new ErroAplicacao(400, 'O nome da disciplina deve ter no máximo 255 caracteres');
    }
    if (!quantidadeValida(qtdAulasSemana)) {
      throw new ErroAplicacao(400, 'A quantidade de aulas por semana deve ser um número inteiro de 1 a 99');
    }
    if (!quantidadeValida(qtdProfessores)) {
      throw new ErroAplicacao(400, 'A quantidade de professores deve ser um número inteiro de 1 a 99');
    }
    if (!Number.isInteger(idSemestre) || idSemestre < 1) {
      throw new ErroAplicacao(400, 'Informe o semestre');
    }

    return { nome, qtdAulasSemana, qtdProfessores, idSemestre };
}

async function exigirSemestreDoAdmin(idAdmin: number, idSemestre: number) {
    // CU-020 A2
    if (!(await semestreRepository.existeDoAdmin(idAdmin, idSemestre))) {
      throw new ErroAplicacao(400, 'Semestre inválido');
    }
}

// Disciplina do admin; id invalido ou de outro admin e 404
async function buscarMateriaDoAdmin(idAdmin: number, idMateria: number) {
    const materia = Number.isInteger(idMateria) ? await materiaRepository.buscarDoAdmin(idAdmin, idMateria) : null;

    if (!materia) {
      throw new ErroAplicacao(404, 'Disciplina não encontrada');
    }
    return materia;
}

// Lista, com filtro opcional ?semestres=1,3
export async function listarMaterias(idAdmin: number, filtro: unknown): Promise<Materia[]> {
    if (filtro !== undefined && (typeof filtro !== 'string' || !/^\d+(,\d+)*$/.test(filtro))) {
      throw new ErroAplicacao(400, 'Filtro de semestres inválido');
    }

    const semestres = filtro === undefined ? null : filtro.split(',').map(Number);
    return materiaRepository.listarPorAdmin(idAdmin, semestres);
}

// Botao "Criar" da secao de disciplinas
export async function criarMateria(idAdmin: number, corpo: unknown): Promise<Materia[]> {
    const dados = validarCorpoMateria(corpo);
    await exigirSemestreDoAdmin(idAdmin, dados.idSemestre);

    try {
        await materiaRepository.inserir(dados);
    } catch (erro) {
        if (chaveDuplicada(erro)) throw new ErroAplicacao(409, ERRO_NOME_REPETIDO);
        throw erro;
    }

    return materiaRepository.listarPorAdmin(idAdmin);
}

// Edita todos os campos do cadastro
export async function editarMateria(idAdmin: number, idMateria: number, corpo: unknown): Promise<Materia[]> {
    const dados = validarCorpoMateria(corpo);
    const materia = await buscarMateriaDoAdmin(idAdmin, idMateria);

    // RN-11: respostas e horarios dependem dos dados da disciplina
    if (materia.emUso) {
      throw new ErroAplicacao(409,
        'Esta disciplina já é usada em respostas de professores ou em horários e não pode ser alterada');
    }

    await exigirSemestreDoAdmin(idAdmin, dados.idSemestre);

    try {
        await materiaRepository.atualizar(materia.id, dados);
    } catch (erro) {
        if (chaveDuplicada(erro)) throw new ErroAplicacao(409, ERRO_NOME_REPETIDO);
        throw erro;
    }

    return materiaRepository.listarPorAdmin(idAdmin);
}

// Botao "Deletar"
export async function excluirMateria(idAdmin: number, idMateria: number): Promise<Materia[]> {
    const materia = await buscarMateriaDoAdmin(idAdmin, idMateria);

    if (materia.emUso) {
      throw new ErroAplicacao(409,
        'Esta disciplina já é usada em respostas de professores ou em horários e não pode ser excluída');
    }

    await materiaRepository.excluir(materia.id);

    return materiaRepository.listarPorAdmin(idAdmin);
}
