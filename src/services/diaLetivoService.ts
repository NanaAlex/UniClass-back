import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as diaLetivoRepository from '../repositories/diaLetivoRepository';
import { DiaLetivo } from '../repositories/diaLetivoRepository';
import { DIAS_SEMANA, lerTurno } from '../utils/validacoes';

export interface DiasDoTurno {
    turno: string;
    dias: DiaLetivo[];
}

function validarTurno(valor: unknown): string {
    const turno = lerTurno(valor);
    if (!turno) throw new ErroAplicacao(400, 'Turno inválido');
    return turno;
}

export async function listarDias(idAdmin: number, turnoInformado: unknown): Promise<DiasDoTurno> {
    const turno = validarTurno(turnoInformado);
    return { turno, dias: await diaLetivoRepository.listarPorTurno(idAdmin, turno) };
}

// CU-015: adiciona um dia letivo ao turno (coluna "+" da tela)
export async function adicionarDia(idAdmin: number, turnoInformado: unknown, diaInformado: unknown): Promise<DiasDoTurno> {
    const turno = validarTurno(turnoInformado);
    const diaSemana = typeof diaInformado === 'string' ? diaInformado.toUpperCase() : null;

    if (!diaSemana || !DIAS_SEMANA.includes(diaSemana)) {
      throw new ErroAplicacao(400, 'Dia inválido; use de SEGUNDA a SABADO');
    }

    if (!(await diaLetivoRepository.inserir(idAdmin, diaSemana, turno))) {
      throw new ErroAplicacao(409, 'Este dia já está cadastrado neste turno');
    }

    return { turno, dias: await diaLetivoRepository.listarPorTurno(idAdmin, turno) };
}

// CU-015: remove um dia letivo do turno, se ainda nao for usado
export async function excluirDia(idAdmin: number, idDiaLetivo: number): Promise<DiasDoTurno> {
    const turno = Number.isInteger(idDiaLetivo) ? await diaLetivoRepository.buscarTurno(idAdmin, idDiaLetivo) : null;

    if (!turno) {
      throw new ErroAplicacao(404, 'Dia letivo não encontrado');
    }

    const diaEmUso = (await diaLetivoRepository.listarPorTurno(idAdmin, turno))
        .some((dia) => dia.id === idDiaLetivo && dia.emUso);

    if (diaEmUso) {
      throw new ErroAplicacao(409,
        'Este dia já é usado em respostas de professores ou em horários gerados e não pode ser excluído');
    }

    await diaLetivoRepository.excluir(idDiaLetivo);

    return { turno, dias: await diaLetivoRepository.listarPorTurno(idAdmin, turno) };
}
