import { Request, Response } from 'express';
import pool from '../database/connection';

const TURNOS = ['MANHA', 'TARDE', 'NOITE', 'INTEGRAL'];
const MINUTOS_NO_DIA = 24 * 60;

// 'HH:MM' ou 'HH:MM:SS' (TIME do MySQL) -> minutos desde 00:00
function paraMinutos(hora: string): number {
    const [h, m] = hora.split(':').map(Number);
    return h * 60 + m;
}

function paraHora(minutos: number): string {
    const h = String(Math.floor(minutos / 60)).padStart(2, '0');
    const m = String(minutos % 60).padStart(2, '0');
    return `${h}:${m}`;
}

function horaValida(hora: any): boolean {
    return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}

function inteiroPositivo(valor: any): boolean {
    return Number.isInteger(valor) && valor > 0;
}

// Horarios das aulas em sequencia, a partir do inicio do bloco
function calcularAulas(inicio: number, duracaoAula: number, qtdAulas: number) {
    return Array.from({ length: qtdAulas }, (_, i) => ({
        numero: i + 1,
        inicio: inicio + i * duracaoAula,
        fim: inicio + (i + 1) * duracaoAula,
    }));
}

function validarCorpoBloco(corpo: any): string | null {
    const { horaInicio, duracaoAula } = corpo;

    if (!horaValida(horaInicio)) {
      return 'Informe o horário de início no formato HH:MM';
    }
    if (!inteiroPositivo(duracaoAula)) {
      return 'A duração da aula deve ser um número inteiro de minutos maior que zero';
    }

    return null;
}

// Blocos do turno, em ordem, com a duracao da aula (deduzida da 1a aula)
async function buscarBlocosDoTurno(idAdmin: number, turno: string) {
    const [rows]: any = await pool.query(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio, b.hora_fim,
                TIME_TO_SEC(TIMEDIFF(s.hora_fim, s.hora_inicio)) DIV 60 AS duracao_aula
           FROM bloco_aula b
           LEFT JOIN slot_aula s
             ON s.id_bloco = b.id_bloco
            AND s.numero_aula = 1
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem`,
        [idAdmin, turno]
    );

    return rows;
}

async function buscarBlocoDoAdmin(idAdmin: number, idBloco: number) {
    if (!Number.isInteger(idBloco)) {
      return null;
    }

    const [rows]: any = await pool.query(
        `SELECT id_bloco, turno, ordem, qtd_aulas, hora_inicio, hora_fim
           FROM bloco_aula
          WHERE id_bloco = ?
            AND id_admin = ?`,
        [idBloco, idAdmin]
    );

    return rows.length > 0 ? rows[0] : null;
}

// Aulas ja usadas em respostas de professores ou em horarios gerados
async function blocosEmUso(idsBlocos: number[]): Promise<boolean> {
    if (idsBlocos.length === 0) {
      return false;
    }

    const [rows]: any = await pool.query(
        `SELECT 1
           FROM slot_aula s
          WHERE s.id_bloco IN (?)
            AND (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
             OR  EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot))
          LIMIT 1`,
        [idsBlocos]
    );

    return rows.length > 0;
}

// Configuracao do turno no formato devolvido ao front
async function montarBlocosDoTurno(idAdmin: number, turno: string) {
    const [rows]: any = await pool.query(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio AS bloco_inicio, b.hora_fim AS bloco_fim,
                s.id_slot, s.numero_aula, s.hora_inicio, s.hora_fim,
                (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
                 OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot)) AS slot_em_uso
           FROM bloco_aula b
           LEFT JOIN slot_aula s ON s.id_bloco = b.id_bloco
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem, s.numero_aula`,
        [idAdmin, turno]
    );

    const blocos: any[] = [];

    for (const linha of rows) {
        let bloco = blocos.find((item) => item.id === linha.id_bloco);

        if (!bloco) {
            bloco = {
                id: linha.id_bloco,
                ordem: linha.ordem,
                qtdAulas: linha.qtd_aulas,
                inicio: linha.bloco_inicio,
                fim: linha.bloco_fim,
                emUso: false,
                aulas: [],
            };
            blocos.push(bloco);
        }

        if (linha.id_slot !== null) {
            bloco.aulas.push({
                id: linha.id_slot,
                aula: linha.numero_aula,
                inicio: linha.hora_inicio,
                fim: linha.hora_fim,
            });
            bloco.emUso = bloco.emUso || linha.slot_em_uso === 1;
        }
    }

    return blocos;
}

// Apaga as aulas do bloco e grava novamente com os horarios calculados
async function regravarAulas(conexao: any, idBloco: number, inicio: number, duracaoAula: number, qtdAulas: number) {
    const aulas = calcularAulas(inicio, duracaoAula, qtdAulas);

    await conexao.query('DELETE FROM slot_aula WHERE id_bloco = ?', [idBloco]);
    await conexao.query(
        'INSERT INTO slot_aula (id_bloco, numero_aula, hora_inicio, hora_fim) VALUES ?',
        [aulas.map((aula) => [idBloco, aula.numero, paraHora(aula.inicio), paraHora(aula.fim)])]
    );
    await conexao.query(
        'UPDATE bloco_aula SET qtd_aulas = ?, hora_inicio = ?, hora_fim = ? WHERE id_bloco = ?',
        [qtdAulas, paraHora(inicio), paraHora(aulas[aulas.length - 1].fim), idBloco]
    );
}

export async function listarBlocos(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const turno = String(req.params.turno).toUpperCase();

    if (!TURNOS.includes(turno)) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }

    try {
        const blocos = await montarBlocosDoTurno(id, turno);

        return resposta.json({ turno, blocos });
    } catch (error) {
        console.error('Erro ao listar blocos:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar os blocos' });
    }
}

// CU-017: adiciona um bloco no fim do turno, com intervalo em relacao ao anterior
export async function criarBloco(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const turno = String(req.params.turno).toUpperCase();
    const { horaInicio, duracaoAula, qtdAulas } = req.body;

    if (!TURNOS.includes(turno)) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }

    const erro = validarCorpoBloco(req.body);
    if (erro) {
      return resposta.status(400).json({ error: erro });
    }
    if (qtdAulas !== undefined && !inteiroPositivo(qtdAulas)) {
      return resposta.status(400).json({ error: 'A quantidade de aulas deve ser um número inteiro maior que zero' });
    }

    try {
        const blocos = await buscarBlocosDoTurno(id, turno);
        const anterior = blocos.length > 0 ? blocos[blocos.length - 1] : null;

        // Todos os blocos do turno tem a mesma quantidade de aulas
        let qtd = qtdAulas;
        if (anterior) {
            if (qtdAulas !== undefined && qtdAulas !== anterior.qtd_aulas) {
              return resposta.status(400).json({
                error: `Os blocos deste turno têm ${anterior.qtd_aulas} aulas; altere o tamanho do turno para mudar a quantidade`,
              });
            }
            qtd = anterior.qtd_aulas;
        } else if (qtd === undefined) {
            return resposta.status(400).json({ error: 'Informe a quantidade de aulas do bloco' });
        }

        const inicio = paraMinutos(horaInicio);
        const fim = inicio + qtd * duracaoAula;

        if (fim >= MINUTOS_NO_DIA) {
          return resposta.status(400).json({ error: 'O bloco deve terminar antes da meia-noite' });
        }
        if (anterior && inicio <= paraMinutos(anterior.hora_fim)) {
          return resposta.status(400).json({
            error: 'O bloco deve começar depois do fim do bloco anterior, com um intervalo entre eles',
          });
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            const [resultado]: any = await conexao.query(
                `INSERT INTO bloco_aula (id_admin, turno, ordem, qtd_aulas, hora_inicio, hora_fim)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, turno, anterior ? anterior.ordem + 1 : 1, qtd, paraHora(inicio), paraHora(fim)]
            );
            await regravarAulas(conexao, resultado.insertId, inicio, duracaoAula, qtd);

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.status(201).json({
            message: 'Bloco adicionado',
            turno,
            blocos: await montarBlocosDoTurno(id, turno),
        });
    } catch (error) {
        console.error('Erro ao criar bloco:', error);
        return resposta.status(500).json({ error: 'Erro interno ao adicionar o bloco' });
    }
}

// Edita horario de inicio e duracao das aulas de um bloco
export async function editarBloco(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idBloco = Number(req.params.idBloco);
    const { horaInicio, duracaoAula } = req.body;

    const erro = validarCorpoBloco(req.body);
    if (erro) {
      return resposta.status(400).json({ error: erro });
    }

    try {
        const bloco = await buscarBlocoDoAdmin(id, idBloco);

        if (!bloco) {
          return resposta.status(404).json({ error: 'Bloco não encontrado' });
        }

        if (await blocosEmUso([idBloco])) {
          return resposta.status(409).json({
            error: 'Este bloco já é usado em respostas de professores ou em horários gerados e não pode ser alterado',
          });
        }

        const blocos = await buscarBlocosDoTurno(id, bloco.turno);
        const posicao = blocos.findIndex((item: any) => item.id_bloco === idBloco);
        const anterior = blocos[posicao - 1];
        const proximo = blocos[posicao + 1];

        const inicio = paraMinutos(horaInicio);
        const fim = inicio + bloco.qtd_aulas * duracaoAula;

        if (fim >= MINUTOS_NO_DIA) {
          return resposta.status(400).json({ error: 'O bloco deve terminar antes da meia-noite' });
        }
        if (anterior && inicio <= paraMinutos(anterior.hora_fim)) {
          return resposta.status(400).json({
            error: 'O bloco deve começar depois do fim do bloco anterior, com um intervalo entre eles',
          });
        }
        if (proximo && fim >= paraMinutos(proximo.hora_inicio)) {
          return resposta.status(400).json({
            error: 'O bloco deve terminar antes do início do próximo bloco, com um intervalo entre eles',
          });
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();
            await regravarAulas(conexao, idBloco, inicio, duracaoAula, bloco.qtd_aulas);
            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({
            message: 'Bloco alterado',
            turno: bloco.turno,
            blocos: await montarBlocosDoTurno(id, bloco.turno),
        });
    } catch (error) {
        console.error('Erro ao editar bloco:', error);
        return resposta.status(500).json({ error: 'Erro interno ao alterar o bloco' });
    }
}

// CU-016: altera a quantidade de aulas de todos os blocos do turno
export async function alterarTamanhoBlocos(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const turno = String(req.params.turno).toUpperCase();
    const { qtdAulas } = req.body;

    if (!TURNOS.includes(turno)) {
      return resposta.status(400).json({ error: 'Turno inválido' });
    }
    if (!inteiroPositivo(qtdAulas)) {
      return resposta.status(400).json({ error: 'A quantidade de aulas deve ser um número inteiro maior que zero' });
    }

    try {
        const blocos = await buscarBlocosDoTurno(id, turno);

        if (blocos.length === 0) {
          return resposta.status(404).json({ error: 'Não há blocos cadastrados neste turno' });
        }

        if (await blocosEmUso(blocos.map((item: any) => item.id_bloco))) {
          return resposta.status(409).json({
            error: 'Há blocos deste turno usados em respostas de professores ou em horários gerados; o tamanho não pode ser alterado',
          });
        }

        // Cada bloco mantem inicio e duracao; so o fim muda
        for (let i = 0; i < blocos.length; i++) {
            const fim = paraMinutos(blocos[i].hora_inicio) + qtdAulas * blocos[i].duracao_aula;
            const proximo = blocos[i + 1];

            if (fim >= MINUTOS_NO_DIA) {
              return resposta.status(400).json({ error: `Com ${qtdAulas} aulas, o bloco ${blocos[i].ordem} terminaria depois da meia-noite` });
            }
            if (proximo && fim >= paraMinutos(proximo.hora_inicio)) {
              return resposta.status(400).json({
                error: `Com ${qtdAulas} aulas, o bloco ${blocos[i].ordem} invadiria o intervalo antes do bloco ${proximo.ordem}`,
              });
            }
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            for (const bloco of blocos) {
                await regravarAulas(conexao, bloco.id_bloco, paraMinutos(bloco.hora_inicio), bloco.duracao_aula, qtdAulas);
            }

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({
            message: 'Quantidade de aulas dos blocos alterada',
            turno,
            blocos: await montarBlocosDoTurno(id, turno),
        });
    } catch (error) {
        console.error('Erro ao alterar tamanho dos blocos:', error);
        return resposta.status(500).json({ error: 'Erro interno ao alterar a quantidade de aulas' });
    }
}

// CU-017: exclui um bloco e reordena os seguintes
export async function excluirBloco(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idBloco = Number(req.params.idBloco);

    try {
        const bloco = await buscarBlocoDoAdmin(id, idBloco);

        if (!bloco) {
          return resposta.status(404).json({ error: 'Bloco não encontrado' });
        }

        if (await blocosEmUso([idBloco])) {
          return resposta.status(409).json({
            error: 'Este bloco já é usado em respostas de professores ou em horários gerados e não pode ser excluído',
          });
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            await conexao.query('DELETE FROM slot_aula WHERE id_bloco = ?', [idBloco]);
            await conexao.query('DELETE FROM bloco_aula WHERE id_bloco = ?', [idBloco]);
            // ORDER BY evita colisao na chave unica (id_admin, turno, ordem)
            await conexao.query(
                `UPDATE bloco_aula SET ordem = ordem - 1
                  WHERE id_admin = ? AND turno = ? AND ordem > ?
                  ORDER BY ordem`,
                [id, bloco.turno, bloco.ordem]
            );

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({
            message: 'Bloco excluído',
            turno: bloco.turno,
            blocos: await montarBlocosDoTurno(id, bloco.turno),
        });
    } catch (error) {
        console.error('Erro ao excluir bloco:', error);
        return resposta.status(500).json({ error: 'Erro interno ao excluir o bloco' });
    }
}
