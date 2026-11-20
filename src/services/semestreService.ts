import { emTransacao } from '../database/transacao';
import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as semestreRepository from '../repositories/semestreRepository';
import * as turmaRepository from '../repositories/turmaRepository';
import { SemestreGravado } from '../repositories/semestreRepository';
import { Turma } from '../repositories/turmaRepository';

export interface Semestre extends SemestreGravado {
    numero: number;
    turmas: Turma[];
}

// Semestres do admin com as turmas; o numero e a posicao (1o, 2o, 3o...)
export async function listarSemestres(idAdmin: number): Promise<Semestre[]> {
    const [semestres, turmas] = await Promise.all([
        semestreRepository.listarPorAdmin(idAdmin),
        turmaRepository.listarPorAdmin(idAdmin),
    ]);

    return semestres.map((semestre, i) => ({
        id: semestre.id,
        numero: i + 1,
        nome: semestre.nome,
        periodoLetivo: semestre.periodoLetivo,
        emUso: semestre.emUso,
        exclusaoBloqueada: semestre.exclusaoBloqueada,
        turmas: turmas
            .filter((turma) => turma.idSemestre === semestre.id)
            .map(({ id, nome, turno, emUso }) => ({ id, nome, turno, emUso })),
    }));
}

// CU-018: o "+" cria o proximo semestre da sequencia (1o, 2o, 3o...)
export async function criarSemestre(idAdmin: number): Promise<Semestre[]> {
    const numero = (await semestreRepository.contarPorAdmin(idAdmin)) + 1;
    await semestreRepository.inserir(idAdmin, `${numero}º Semestre`);

    return listarSemestres(idAdmin);
}

// CU-018: exclui o ultimo semestre, junto com as turmas dele
export async function excluirSemestre(idAdmin: number, idSemestre: number): Promise<Semestre[]> {
    const semestres = await listarSemestres(idAdmin);
    const semestre = semestres.find((item) => item.id === idSemestre);

    if (!semestre) {
      throw new ErroAplicacao(404, 'Semestre não encontrado');
    }

    // Excluir do meio renumeraria semestres que ja tem materias e formularios
    if (semestre.numero !== semestres.length) {
      throw new ErroAplicacao(409, 'Apenas o último semestre pode ser excluído');
    }

    // CU-018 A2: dependencias impedem a exclusao
    if (semestre.emUso) {
      throw new ErroAplicacao(409,
        'Este semestre possui matérias, formulários, horários ou turmas em uso e não pode ser excluído');
    }

    await emTransacao(async (conexao) => {
        await turmaRepository.excluirPorSemestre(idSemestre, conexao);
        await semestreRepository.excluir(idSemestre, conexao);
    });

    return listarSemestres(idAdmin);
}
