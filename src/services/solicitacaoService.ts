import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as solicitacaoRepository from '../repositories/solicitacaoRepository';

// Professor pede para alterar a resposta enviada ao formulario
export async function solicitarAlteracaoFormulario(idProfessor: number, idFormulario: number, motivo: unknown): Promise<number> {
    if (!motivo || typeof motivo !== 'string' || motivo.trim() === '') {
      throw new ErroAplicacao(400, 'Descreva o motivo da alteração');
    }
    if (motivo.length > 500) {
      throw new ErroAplicacao(400, 'O motivo deve ter no máximo 500 caracteres');
    }

    const respostaEnviada = await solicitacaoRepository.buscarRespostaNoPrazo(idFormulario, idProfessor);

    if (!respostaEnviada) {
      throw new ErroAplicacao(404, 'Não há resposta enviada para este formulário, ou o prazo já terminou');
    }
    if (respostaEnviada.status === 'LIBERADA_PARA_ALTERACAO') {
      throw new ErroAplicacao(409, 'Sua resposta já está liberada para alteração');
    }
    if (await solicitacaoRepository.existePendenteDaResposta(respostaEnviada.id)) {
      throw new ErroAplicacao(409, 'Você já tem uma solicitação pendente para este formulário');
    }

    return solicitacaoRepository.inserirDeResposta(respostaEnviada.id, motivo.trim());
}

export async function listarSolicitacoesFormulario(idProfessor: number) {
    return solicitacaoRepository.listarDeRespostaDoProfessor(idProfessor);
}

// CU-053: professor pede alteracao na previa do horario, de uma aula ou do horario inteiro
export async function solicitarAlteracaoHorario(idProfessor: number, corpo: any): Promise<number> {
    const { idGeracao, idAula, motivo } = corpo;

    if (typeof motivo !== 'string' || motivo.trim() === '') {
      throw new ErroAplicacao(400, 'Informe o motivo da solicitação');
    }
    if (motivo.trim().length > 500) {
      throw new ErroAplicacao(400, 'O motivo pode ter no máximo 500 caracteres');
    }
    if (!Number.isInteger(idGeracao)) {
      throw new ErroAplicacao(400, 'Informe o horário (idGeracao) da solicitação');
    }
    if (idAula !== undefined && idAula !== null && !Number.isInteger(idAula)) {
      throw new ErroAplicacao(400, 'A aula informada é inválida');
    }

    const aulaInformada: number | null = Number.isInteger(idAula) ? idAula : null;

    if (!(await solicitacaoRepository.previaLiberadaAoProfessor(idGeracao, idProfessor))) {
      throw new ErroAplicacao(404, 'Prévia de horário não encontrada ou não liberada');
    }
    if (aulaInformada !== null && !(await solicitacaoRepository.aulaDoProfessorNaGeracao(aulaInformada, idGeracao, idProfessor))) {
      throw new ErroAplicacao(400, 'A aula informada não pertence ao seu horário nesta prévia');
    }
    if (await solicitacaoRepository.existePendenteDeHorario(idProfessor, idGeracao, aulaInformada)) {
      throw new ErroAplicacao(409, 'Você já tem uma solicitação pendente igual a esta');
    }

    return solicitacaoRepository.inserirDeHorario(idProfessor, idGeracao, aulaInformada, motivo.trim());
}

// CU-054
export async function listarSolicitacoesHorario(idProfessor: number) {
    return solicitacaoRepository.listarDeHorarioDoProfessor(idProfessor);
}
