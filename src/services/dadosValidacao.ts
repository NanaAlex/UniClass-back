import { ERRO_TAMANHO_UNICO } from './blocoService';
import { MINUTOS_NO_DIA, horaValida, paraMinutos } from '../utils/horas';
import { DIAS_SEMANA, TURNOS, inteiroPositivo, quantidadeValida } from '../utils/validacoes';

/*
   Formato do corpo do "Salvar dados" (aba Dados inteira), sem banco. As mesmas
   regras das rotas de cada assunto (07.3), para responder antes de abrir a
   transacao. Cada secao e opcional: a que nao vier nao muda.
*/

const LETRA_TURMA = /^[A-Z]$/;

const idValido = (valor: any) => valor === undefined || valor === null || (Number.isInteger(valor) && valor > 0);
const texto = (valor: any) => (typeof valor === 'string' ? valor.trim() : '');

export type BlocoDados = { inicio: number; duracaoAula: number };
export type TurnoDados = { turno: string; dias: string[]; qtdAulas: number; blocos: BlocoDados[] };
export type TurmaDados = { id: number | null; nome: string; turno: string };
export type SemestreDados = { numero: number; turmas: TurmaDados[] };
export type MateriaDados = {
    id: number | null; nome: string; qtdAulasSemana: number; qtdProfessores: number; numeroSemestre: number;
};
export type Dados = { turnos?: TurnoDados[]; semestres?: SemestreDados[]; materias?: MateriaDados[] };

export function validarTurnos(lista: any): { erro?: string; turnos?: TurnoDados[] } {
    if (!Array.isArray(lista)) return { erro: 'Envie os turnos como lista' };

    const turnos: TurnoDados[] = [];
    for (const item of lista) {
        const turno = texto(item?.turno).toUpperCase();
        if (!TURNOS.includes(turno)) return { erro: 'Turno inválido' };
        if (turnos.some((t) => t.turno === turno)) return { erro: `O turno ${turno} foi enviado mais de uma vez` };

        if (!Array.isArray(item.dias)) return { erro: `Envie os dias do turno ${turno} como lista` };
        const dias = item.dias.map((dia: any) => texto(dia).toUpperCase());
        if (dias.some((dia: string) => !DIAS_SEMANA.includes(dia))) return { erro: 'Dia inválido; use de SEGUNDA a SABADO' };
        if (new Set(dias).size !== dias.length) return { erro: `Dia repetido no turno ${turno}` };

        if (!Array.isArray(item.blocos)) return { erro: `Envie os blocos do turno ${turno} como lista` };
        // RF 7.2: todos os blocos do turno tem a mesma quantidade de aulas
        if (item.blocos.length > 0 && !quantidadeValida(item.qtdAulas)) {
          return { erro: `A quantidade de aulas por bloco do turno ${turno} deve ser um número inteiro de 1 a 99` };
        }

        const blocos: BlocoDados[] = [];
        for (const [i, bloco] of item.blocos.entries()) {
            const nome = `O bloco ${i + 1} do turno ${turno}`;
            if (!horaValida(bloco?.horaInicio)) return { erro: `Informe o horário de início do bloco ${i + 1} do turno ${turno} no formato HH:MM` };
            if (!inteiroPositivo(bloco.duracaoAula)) {
              return { erro: `A duração da aula do bloco ${i + 1} do turno ${turno} deve ser um número inteiro de minutos maior que zero` };
            }

            const inicio = paraMinutos(bloco.horaInicio);
            if (inicio + item.qtdAulas * bloco.duracaoAula >= MINUTOS_NO_DIA) return { erro: `${nome} deve terminar antes da meia-noite` };

            // RF 7.3: intervalo obrigatorio entre blocos
            const anterior = blocos[blocos.length - 1];
            if (anterior && inicio <= anterior.inicio + item.qtdAulas * anterior.duracaoAula) {
              return { erro: `${nome} deve começar depois do fim do bloco anterior, com um intervalo entre eles` };
            }
            blocos.push({ inicio, duracaoAula: bloco.duracaoAula });
        }

        turnos.push({ turno, dias, qtdAulas: blocos.length ? item.qtdAulas : 0, blocos });
    }

    // O escalonador usa um tamanho de bloco unico em todos os turnos (K)
    if (new Set(turnos.filter((t) => t.blocos.length).map((t) => t.qtdAulas)).size > 1) {
      return { erro: ERRO_TAMANHO_UNICO };
    }
    return { turnos };
}

export function validarSemestres(lista: any): { erro?: string; semestres?: SemestreDados[] } {
    if (!Array.isArray(lista)) return { erro: 'Envie os semestres como lista' };

    const semestres: SemestreDados[] = [];
    const idsTurmas = new Set<number>();
    for (const [i, item] of lista.entries()) {
        // A numeracao e a posicao (07.3): 1, 2, 3... sem lacunas
        if (item?.numero !== i + 1) return { erro: 'Os semestres devem ser numerados 1, 2, 3... sem lacunas' };
        if (!Array.isArray(item.turmas)) return { erro: `Envie as turmas do ${item.numero}º semestre como lista` };

        const turmas: TurmaDados[] = [];
        for (const turma of item.turmas) {
            if (!idValido(turma?.id)) return { erro: 'Turma inválida' };
            const id = turma.id ?? null;
            if (id !== null && idsTurmas.has(id)) return { erro: 'Uma turma foi enviada mais de uma vez' };
            if (id !== null) idsTurmas.add(id);

            const nome = texto(turma.nome).toUpperCase();
            if (!LETRA_TURMA.test(nome)) return { erro: 'O nome da turma deve ser uma letra de A a Z' };
            if (turmas.some((t) => t.nome === nome)) return { erro: `Turma ${nome} repetida no ${item.numero}º semestre` };

            const turno = texto(turma.turno).toUpperCase();
            if (!TURNOS.includes(turno)) return { erro: 'Turno inválido' };

            turmas.push({ id, nome, turno });
        }
        semestres.push({ numero: item.numero, turmas });
    }
    return { semestres };
}

export function validarMaterias(lista: any): { erro?: string; status?: number; materias?: MateriaDados[] } {
    if (!Array.isArray(lista)) return { erro: 'Envie as disciplinas como lista' };

    const materias: MateriaDados[] = [];
    for (const item of lista) {
        if (!idValido(item?.id)) return { erro: 'Disciplina inválida' };
        const id = item.id ?? null;
        if (id !== null && materias.some((m) => m.id === id)) return { erro: 'Uma disciplina foi enviada mais de uma vez' };

        const nome = texto(item.nome);
        if (!nome) return { erro: 'Informe o nome da disciplina' };
        if (nome.length > 255) return { erro: 'O nome da disciplina deve ter no máximo 255 caracteres' };
        if (!quantidadeValida(item.qtdAulasSemana)) return { erro: 'A quantidade de aulas por semana deve ser um número inteiro de 1 a 99' };
        if (!quantidadeValida(item.qtdProfessores)) return { erro: 'A quantidade de professores deve ser um número inteiro de 1 a 99' };
        if (!Number.isInteger(item.numeroSemestre) || item.numeroSemestre < 1) return { erro: 'Informe o semestre da disciplina' };

        // Chave unica (id_semestre, nome), sem diferenciar maiusculas: 409 como na 07.3
        if (materias.some((m) => m.numeroSemestre === item.numeroSemestre && m.nome.toLowerCase() === nome.toLowerCase())) {
          return { erro: 'Já existe uma disciplina com este nome neste semestre', status: 409 };
        }

        materias.push({ id, nome, qtdAulasSemana: item.qtdAulasSemana, qtdProfessores: item.qtdProfessores, numeroSemestre: item.numeroSemestre });
    }
    return { materias };
}

export function validarCorpoDados(corpo: any): { erro?: string; status?: number; dados?: Dados } {
    if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return { erro: 'Envie os dados da tela' };

    const dados: Dados = {};
    if (corpo.turnos !== undefined) {
        const { erro, turnos } = validarTurnos(corpo.turnos);
        if (erro) return { erro };
        dados.turnos = turnos;
    }
    if (corpo.semestres !== undefined) {
        const { erro, semestres } = validarSemestres(corpo.semestres);
        if (erro) return { erro };
        dados.semestres = semestres;
    }
    if (corpo.materias !== undefined) {
        const { erro, status, materias } = validarMaterias(corpo.materias);
        if (erro) return { erro, status };
        // A disciplina precisa estar num semestre enviado (o que sai leva as dele)
        if (dados.semestres && materias!.some((m) => m.numeroSemestre > dados.semestres!.length)) {
          return { erro: 'Semestre inválido' };
        }
        dados.materias = materias;
    }
    return { dados };
}
