import { Request, Response } from 'express';
import pool from '../database/connection';
import { TURNOS } from '../utils/validacoes';
import {
    ERRO_TAMANHO_UNICO, MATERIA_EM_USO, MINUTOS_NO_DIA, calcularAulas, horaValida, inteiroPositivo,
    montarBlocosDoTurno, montarDiasDoTurno, montarMaterias, montarSemestres, paraHora, paraMinutos,
} from '../utils/dadosAcademicos';

// Domingo fica de fora: nao ha aula aos domingos
const DIAS_SEMANA = ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
const LETRA_TURMA = /^[A-Z]$/;

const quantidadeValida = (valor: any) => Number.isInteger(valor) && valor >= 1 && valor <= 99;
const idValido = (valor: any) => valor === undefined || valor === null || (Number.isInteger(valor) && valor > 0);
const texto = (valor: any) => (typeof valor === 'string' ? valor.trim() : '');

// Recusa durante a gravacao: desfaz a transacao e responde com o status
class ErroDados extends Error {
    constructor(public status: number, mensagem: string) {
        super(mensagem);
    }
}

type BlocoDados = { inicio: number; duracaoAula: number };
type TurnoDados = { turno: string; dias: string[]; qtdAulas: number; blocos: BlocoDados[] };
type TurmaDados = { id: number | null; nome: string; turno: string };
type SemestreDados = { numero: number; turmas: TurmaDados[] };
type MateriaDados = {
    id: number | null; nome: string; qtdAulasSemana: number; qtdProfessores: number; numeroSemestre: number;
};
type Dados = { turnos?: TurnoDados[]; semestres?: SemestreDados[]; materias?: MateriaDados[] };

// Aba Dados inteira (CU-015 a CU-022), no mesmo formato das rotas de cada assunto:
// os tres turnos com dias e blocos, os semestres com turmas e as disciplinas
async function montarDados(idAdmin: number) {
    const [turnos, semestres, materias] = await Promise.all([
        Promise.all(TURNOS.map(async (turno) => ({
            turno,
            dias: await montarDiasDoTurno(idAdmin, turno),
            blocos: await montarBlocosDoTurno(idAdmin, turno),
        }))),
        montarSemestres(idAdmin),
        montarMaterias(idAdmin),
    ]);

    return { turnos, semestres, materias };
}

/*
   Formato do corpo (400), sem banco. As mesmas regras das rotas de cada
   assunto (07.3), para responder antes de abrir a transacao. Cada secao e
   opcional: a que nao vier nao muda.
*/
function validarTurnos(lista: any): { erro?: string; turnos?: TurnoDados[] } {
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

function validarSemestres(lista: any): { erro?: string; semestres?: SemestreDados[] } {
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

function validarMaterias(lista: any): { erro?: string; status?: number; materias?: MateriaDados[] } {
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

function validarCorpoDados(corpo: any): { erro?: string; status?: number; dados?: Dados } {
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

/*
   Gravacao (dentro da transacao). Primeiro o que sai, depois o que muda e
   o que entra, para que nada dependa do que ainda vai ser apagado. Em uso =
   ja usado por respostas de professores ou horarios gerados (RN-11,
   constituicao Artigo 6.4): nao sai nem muda (409).
*/
async function sincronizar(conexao: any, idAdmin: number, dados: Dados) {
    // Estado atual do admin
    const [semestresBanco]: any = await conexao.query(
        'SELECT id_semestre FROM semestre WHERE id_admin = ? ORDER BY id_semestre',
        [idAdmin]
    );
    const [turmasBanco]: any = await conexao.query(
        `SELECT t.id_turma, t.id_semestre, t.nome, t.turno,
                (EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma)) AS em_uso
           FROM turma t
           JOIN semestre s ON s.id_semestre = t.id_semestre
          WHERE s.id_admin = ?`,
        [idAdmin]
    );
    const [materiasBanco]: any = await conexao.query(
        `SELECT m.id_materia, m.id_semestre, m.nome, m.qtd_aulas_semana, m.qtd_professores, ${MATERIA_EM_USO} AS em_uso
           FROM materia m
           JOIN semestre s ON s.id_semestre = m.id_semestre
          WHERE s.id_admin = ?
            AND m.ativo = TRUE`,
        [idAdmin]
    );

    // A numeracao do semestre e a posicao por id (07.3)
    const numeroDoSemestre = new Map<number, number>(semestresBanco.map((s: any, i: number) => [s.id_semestre, i + 1]));
    const turmaPorId = new Map<number, any>(turmasBanco.map((t: any) => [t.id_turma, t]));
    const materiaPorId = new Map<number, any>(materiasBanco.map((m: any) => [m.id_materia, m]));
    const totalSemestres = dados.semestres ? dados.semestres.length : semestresBanco.length;

    // Pertencimento dos ids enviados (400)
    for (const semestre of dados.semestres ?? []) {
        for (const turma of semestre.turmas) {
            if (turma.id === null) continue;
            const banco = turmaPorId.get(turma.id);
            if (!banco) throw new ErroDados(400, 'Turma inválida');
            if (numeroDoSemestre.get(banco.id_semestre) !== semestre.numero) {
              throw new ErroDados(400, `A turma ${banco.nome} não pertence ao ${semestre.numero}º semestre`);
            }
            if (banco.nome !== turma.nome) throw new ErroDados(400, `A turma ${banco.nome} não pode ser renomeada`);
        }
    }
    for (const materia of dados.materias ?? []) {
        if (materia.id !== null && !materiaPorId.has(materia.id)) throw new ErroDados(400, 'Disciplina inválida');
        if (materia.numeroSemestre > totalSemestres) throw new ErroDados(400, 'Semestre inválido');
    }

    // Tamanho unico tambem com os turnos que nao vieram no corpo (ficam como estao)
    if (dados.turnos) {
        const enviados = new Set(dados.turnos.map((t) => t.turno));
        const [doBanco]: any = await conexao.query('SELECT DISTINCT turno, qtd_aulas FROM bloco_aula WHERE id_admin = ?', [idAdmin]);
        const tamanhos = new Set<number>([
            ...dados.turnos.filter((t) => t.blocos.length).map((t) => t.qtdAulas),
            ...doBanco.filter((linha: any) => !enviados.has(linha.turno)).map((linha: any) => linha.qtd_aulas),
        ]);
        if (tamanhos.size > 1) throw new ErroDados(400, ERRO_TAMANHO_UNICO);
    }

    // 1. Disciplinas que saem
    if (dados.materias) {
        const mantidas = new Set(dados.materias.map((m) => m.id));
        for (const banco of materiasBanco) {
            if (mantidas.has(banco.id_materia)) continue;
            if (banco.em_uso === 1) {
              throw new ErroDados(409, `A disciplina "${banco.nome}" já é usada em respostas de professores ou em horários e não pode ser excluída`);
            }
            await conexao.query('DELETE FROM materia WHERE id_materia = ?', [banco.id_materia]);
        }
    }

    // 2. Turmas que saem ou mudam de turno
    if (dados.semestres) {
        const enviadas = new Map<number, TurmaDados>();
        dados.semestres.forEach((s) => s.turmas.forEach((t) => t.id !== null && enviadas.set(t.id, t)));

        for (const banco of turmasBanco) {
            const enviada = enviadas.get(banco.id_turma);
            const numero = numeroDoSemestre.get(banco.id_semestre);
            if (!enviada) {
                if (banco.em_uso === 1) {
                  throw new ErroDados(409, `A turma ${banco.nome} do ${numero}º semestre é usada em horários gerados e não pode ser retirada`);
                }
                await conexao.query('DELETE FROM turma WHERE id_turma = ?', [banco.id_turma]);
            } else if (enviada.turno !== banco.turno) {
                if (banco.em_uso === 1) {
                  throw new ErroDados(409, `A turma ${banco.nome} do ${numero}º semestre é usada em horários gerados e não pode mudar de turno`);
                }
                await conexao.query('UPDATE turma SET turno = ? WHERE id_turma = ?', [enviada.turno, banco.id_turma]);
            }
        }
    }

    // 3. Semestres: so os ultimos saem (D4); os novos entram no fim
    const idsSemestres: number[] = semestresBanco.map((s: any) => s.id_semestre);
    if (dados.semestres) {
        while (idsSemestres.length > dados.semestres.length) {
            const idSemestre = idsSemestres.pop()!;
            const numero = idsSemestres.length + 1;
            // As disciplinas e turmas que saem ja foram apagadas nesta transacao
            const [[uso]]: any = await conexao.query(
                `SELECT (EXISTS (SELECT 1 FROM materia m WHERE m.id_semestre = ?)
                         OR EXISTS (SELECT 1 FROM formulario f WHERE f.id_semestre = ?)
                         OR EXISTS (SELECT 1 FROM geracao_horario g WHERE g.id_semestre = ?)
                         OR EXISTS (SELECT 1 FROM turma t WHERE t.id_semestre = ?)) AS em_uso`,
                [idSemestre, idSemestre, idSemestre, idSemestre]
            );
            if (uso.em_uso === 1) {
              throw new ErroDados(409, `O ${numero}º semestre possui disciplinas, formulários, horários ou turmas em uso e não pode ser excluído`);
            }
            await conexao.query('DELETE FROM semestre WHERE id_semestre = ?', [idSemestre]);
        }
        while (idsSemestres.length < dados.semestres.length) {
            const [resultado]: any = await conexao.query(
                'INSERT INTO semestre (id_admin, nome) VALUES (?, ?)',
                [idAdmin, `${idsSemestres.length + 1}º Semestre`]
            );
            idsSemestres.push(resultado.insertId);
        }

        // 4. Turmas novas, com a letra que a tela mostrou (R8)
        const novas = dados.semestres.flatMap((s) =>
            s.turmas.filter((t) => t.id === null).map((t) => [idsSemestres[s.numero - 1], t.nome, t.turno])
        );
        if (novas.length) await conexao.query('INSERT INTO turma (id_semestre, nome, turno) VALUES ?', [novas]);
    }

    // 5. Disciplinas que mudam e as novas
    for (const materia of dados.materias ?? []) {
        const idSemestre = idsSemestres[materia.numeroSemestre - 1];
        if (materia.id === null) {
            await conexao.query(
                'INSERT INTO materia (id_semestre, nome, qtd_aulas_semana, qtd_professores) VALUES (?, ?, ?, ?)',
                [idSemestre, materia.nome, materia.qtdAulasSemana, materia.qtdProfessores]
            );
            continue;
        }

        const banco = materiaPorId.get(materia.id);
        const mudou = banco.nome !== materia.nome || banco.id_semestre !== idSemestre
            || banco.qtd_aulas_semana !== materia.qtdAulasSemana || banco.qtd_professores !== materia.qtdProfessores;
        if (!mudou) continue;
        if (banco.em_uso === 1) {
          throw new ErroDados(409, `A disciplina "${banco.nome}" já é usada em respostas de professores ou em horários e não pode ser alterada`);
        }
        await conexao.query(
            'UPDATE materia SET nome = ?, id_semestre = ?, qtd_aulas_semana = ?, qtd_professores = ? WHERE id_materia = ?',
            [materia.nome, idSemestre, materia.qtdAulasSemana, materia.qtdProfessores, materia.id]
        );
    }

    // 6. Dias e blocos de cada turno enviado
    for (const turno of dados.turnos ?? []) {
        await sincronizarDias(conexao, idAdmin, turno);
        await sincronizarBlocos(conexao, idAdmin, turno);
    }
}

async function sincronizarDias(conexao: any, idAdmin: number, turno: TurnoDados) {
    const [diasBanco]: any = await conexao.query(
        `SELECT d.id_dia_letivo, d.dia_semana,
                (EXISTS (SELECT 1 FROM disponibilidade_horario x WHERE x.id_dia_letivo = d.id_dia_letivo)
                 OR EXISTS (SELECT 1 FROM preferencia_turno x WHERE x.id_dia_letivo = d.id_dia_letivo)
                 OR EXISTS (SELECT 1 FROM aula_alocada x WHERE x.id_dia_letivo = d.id_dia_letivo)) AS em_uso
           FROM dia_letivo d
          WHERE d.id_admin = ?
            AND d.turno = ?`,
        [idAdmin, turno.turno]
    );

    for (const banco of diasBanco) {
        if (turno.dias.includes(banco.dia_semana)) continue;
        if (banco.em_uso === 1) {
          throw new ErroDados(409, `${banco.dia_semana} do turno ${turno.turno} já é usada em respostas ou horários e não pode ser excluída`);
        }
        await conexao.query('DELETE FROM dia_letivo WHERE id_dia_letivo = ?', [banco.id_dia_letivo]);
    }

    const novos = turno.dias.filter((dia) => !diasBanco.some((banco: any) => banco.dia_semana === dia));
    if (novos.length) {
      await conexao.query(
          'INSERT INTO dia_letivo (id_admin, dia_semana, turno) VALUES ?',
          [novos.map((dia) => [idAdmin, dia, turno.turno])]
      );
    }
}

/*
   R7: o bloco igual ao da mesma posicao fica (o id nao muda); os outros sao
   recriados. Bloco em uso nao pode sair nem mudar de horario ou de tamanho.
*/
async function sincronizarBlocos(conexao: any, idAdmin: number, turno: TurnoDados) {
    const [blocosBanco]: any = await conexao.query(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio,
                (SELECT TIME_TO_SEC(TIMEDIFF(s.hora_fim, s.hora_inicio)) DIV 60
                   FROM slot_aula s WHERE s.id_bloco = b.id_bloco AND s.numero_aula = 1) AS duracao_aula,
                EXISTS (SELECT 1 FROM slot_aula s
                         WHERE s.id_bloco = b.id_bloco
                           AND (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
                                OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot))) AS em_uso
           FROM bloco_aula b
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem`,
        [idAdmin, turno.turno]
    );

    const mantidos = new Set<number>();
    for (const [i, banco] of blocosBanco.entries()) {
        const enviado = turno.blocos[i];
        const igual = enviado
            && banco.ordem === i + 1
            && paraMinutos(banco.hora_inicio) === enviado.inicio
            && Number(banco.duracao_aula) === enviado.duracaoAula
            && banco.qtd_aulas === turno.qtdAulas;
        if (igual) {
            mantidos.add(i);
            continue;
        }
        if (banco.em_uso === 1) {
          throw new ErroDados(409, `O bloco ${i + 1} do turno ${turno.turno} já é usado em respostas ou horários e não pode ser alterado nem excluído`);
        }
        await conexao.query('DELETE FROM slot_aula WHERE id_bloco = ?', [banco.id_bloco]);
        await conexao.query('DELETE FROM bloco_aula WHERE id_bloco = ?', [banco.id_bloco]);
    }

    for (const [i, bloco] of turno.blocos.entries()) {
        if (mantidos.has(i)) continue;
        const aulas = calcularAulas(bloco.inicio, bloco.duracaoAula, turno.qtdAulas);
        const [resultado]: any = await conexao.query(
            `INSERT INTO bloco_aula (id_admin, turno, ordem, qtd_aulas, hora_inicio, hora_fim)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [idAdmin, turno.turno, i + 1, turno.qtdAulas, paraHora(bloco.inicio), paraHora(aulas[aulas.length - 1].fim)]
        );
        await conexao.query(
            'INSERT INTO slot_aula (id_bloco, numero_aula, hora_inicio, hora_fim) VALUES ?',
            [aulas.map((aula) => [resultado.insertId, aula.numero, paraHora(aula.inicio), paraHora(aula.fim)])]
        );
    }
}

// Tela "Dados do curso": carrega as tres abas numa requisicao
export async function lerDados(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        return resposta.json(await montarDados(id));
    } catch (error) {
        console.error('Erro ao ler os dados do curso:', error);
        return resposta.status(500).json({ error: 'Erro interno ao carregar os dados do curso' });
    }
}

// Botao "Salvar dados": grava a aba inteira, tudo ou nada (D1 da spec 08.02)
export async function salvarDados(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const { erro, status, dados } = validarCorpoDados(req.body);

    if (!dados) {
      return resposta.status(status ?? 400).json({ error: erro });
    }

    try {
        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();
            // Trava o admin: dois "Salvar" ao mesmo tempo nao se misturam
            await conexao.query('SELECT id_usuario FROM administrador WHERE id_usuario = ? FOR UPDATE', [id]);
            await sincronizar(conexao, id, dados);
            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({ message: 'Dados salvos', ...(await montarDados(id)) });
    } catch (error: any) {
        if (error instanceof ErroDados) {
          return resposta.status(error.status).json({ error: error.message });
        }
        // Chave unica (id_semestre, nome): nomes trocados entre si num mesmo salvamento
        if (error?.code === 'ER_DUP_ENTRY') {
          return resposta.status(409).json({ error: 'Já existe uma disciplina ou turma com este nome neste semestre' });
        }
        console.error('Erro ao salvar os dados do curso:', error);
        return resposta.status(500).json({ error: 'Erro interno ao salvar os dados do curso' });
    }
}
