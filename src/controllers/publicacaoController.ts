import { Request, Response } from 'express';
import pool from '../database/connection';
import { atualizarStatusFormularios } from '../utils/agendaFormulario';

// Formularios do admin, do mais recente ao mais antigo, com o total de respostas
// e de professores vinculados
async function montarFormularios(idAdmin: number) {
    const [rows]: any = await pool.query(
        `SELECT f.id_formulario, f.nome, f.periodo_letivo, f.status, f.encerrado_manualmente,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d') AS data_inicio,
                DATE_FORMAT(f.data_fim, '%Y-%m-%d') AS data_fim,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%dT%H:%i') AS inicio,
                DATE_FORMAT(f.data_fim, '%Y-%m-%dT%H:%i') AS fim,
                (SELECT COUNT(*) FROM resposta_formulario r
                  WHERE r.id_formulario = f.id_formulario) AS respostas,
                (SELECT COUNT(*) FROM vinculo_professor_admin v
                  WHERE v.id_admin = f.id_admin AND v.ativo = TRUE) AS professores
           FROM formulario f
          WHERE f.id_admin = ?
          ORDER BY f.id_formulario DESC`,
        [idAdmin]
    );

    return rows.map((linha: any) => ({
        id: linha.id_formulario,
        nome: linha.nome,
        periodoLetivo: linha.periodo_letivo,
        status: linha.status,
        // So o dia (task 07.3) e o instante com a hora (task 08.02), em Brasilia
        dataInicio: linha.data_inicio,
        dataFim: linha.data_fim,
        inicio: linha.inicio,
        fim: linha.fim,
        // Encerrado na mao (CU-025) ou pela data (RF 2.8): a tela so prorroga o segundo
        encerradoManualmente: linha.encerrado_manualmente === 1,
        respostas: Number(linha.respostas),
        professores: Number(linha.professores),
    }));
}

// Formulario do admin; id invalido ou de outro admin devolve null (404)
async function buscarFormularioDoAdmin(idAdmin: number, idFormulario: number) {
    if (!Number.isInteger(idFormulario)) return null;

    const [rows]: any = await pool.query(
        `SELECT f.id_formulario, f.status,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d') AS data_inicio,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d %H:%i') AS inicio_minuto,
                f.data_fim < NOW() AS termino_vencido,
                f.id_formulario = (SELECT MAX(id_formulario) FROM formulario
                                    WHERE id_admin = f.id_admin) AS mais_recente
           FROM formulario f
          WHERE f.id_formulario = ?
            AND f.id_admin = ?`,
        [idFormulario, idAdmin]
    );

    return rows.length > 0 ? rows[0] : null;
}

// Agora no horario de Brasilia (RNF 9), no formato do MySQL: AAAA-MM-DD HH:MM:SS
function agora() {
    const partes = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(new Date()).map((parte) => [parte.type, parte.value])
    );
    return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

// 'AAAA-MM-DD' (dia inteiro, como na task 07.3: abre as 00:00 e encerra as
// 23:59:59) ou 'AAAA-MM-DDTHH:MM' (a tela tem data e hora), no horario de
// Brasilia. Devolve o valor para o MySQL, ou null se o dia ou a hora nao
// existirem (2027-02-30, 25:00). Textos nesse formato se comparam como texto.
function lerDataHora(valor: any, fimDoDia: boolean) {
    const partes = typeof valor === 'string'
        ? /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/.exec(valor)
        : null;
    if (!partes) return null;

    const [, dia, hora, minuto] = partes;
    const data = new Date(`${dia}T00:00:00Z`);
    if (isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== dia) return null;

    if (hora === undefined) {
      return { dia, soDia: true, valor: `${dia} ${fimDoDia ? '23:59:59' : '00:00:00'}` };
    }
    return { dia, soDia: false, valor: `${dia} ${hora}:${minuto}:00` };
}

// Periodo letivo: ano e semestre do ano (ex.: 2027/1)
const PERIODO_LETIVO = /^\d{4}\/[12]$/;

// Datas do lancamento e da edicao
function validarDatas(corpo: any) {
    const inicio = lerDataHora(corpo?.dataInicio, false);
    const fim = lerDataHora(corpo?.dataFim, true);

    if (!inicio) {
      return { erro: 'Informe uma data de início válida (AAAA-MM-DD ou AAAA-MM-DDTHH:MM)' };
    }
    if (!fim) {
      return { erro: 'Informe uma data de término válida (AAAA-MM-DD ou AAAA-MM-DDTHH:MM)' };
    }
    if (fim.valor <= inicio.valor) {
      return { erro: 'A data de término deve ser posterior à data de início' };
    }
    // So o dia: o termino de hoje (23:59:59) ainda vale, como na 07.3
    if (fim.valor <= agora()) {
      return { erro: 'A data de término não pode ser anterior a agora' };
    }

    return { datas: { inicio, fim } };
}

function validarCorpoLancamento(corpo: any) {
    const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';

    if (!nome) {
      return { erro: 'Informe o nome do formulário' };
    }
    if (nome.length > 255) {
      return { erro: 'O nome do formulário deve ter no máximo 255 caracteres' };
    }

    // CU-023 (decisao Q18 da 07.3): periodo letivo do formulario, opcional, no
    // formato da geracao do escalonador (AAAA/1 ou AAAA/2, PERIODO_VALIDO do motor)
    const { periodoLetivo } = corpo ?? {};
    const periodo = typeof periodoLetivo === 'string' ? periodoLetivo.trim() : '';
    if (periodoLetivo !== undefined && periodoLetivo !== null && (typeof periodoLetivo !== 'string' || (periodo && !PERIODO_LETIVO.test(periodo)))) {
      return { erro: 'Informe o período letivo no formato AAAA/1 ou AAAA/2' };
    }

    const { erro, datas } = validarDatas(corpo);
    return datas ? { dados: { nome, periodoLetivo: periodo || null, ...datas } } : { erro };
}

// CU-026: lista com o estado e as respostas de cada formulario
export async function listarFormulariosDoAdmin(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        await atualizarStatusFormularios();

        return resposta.json({ formularios: await montarFormularios(id) });
    } catch (error) {
        console.error('Erro ao listar formulários:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar os formulários' });
    }
}

// CU-023 e CU-024: botao "Lancar"; inicio hoje abre, inicio futuro programa
export async function lancarFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const { erro, dados } = validarCorpoLancamento(req.body);

    if (!dados) {
      return resposta.status(400).json({ error: erro });
    }

    try {
        await atualizarStatusFormularios();

        const conexao = await pool.getConnection();
        let conflito: string | null = null;

        try {
            await conexao.beginTransaction();

            // Trava o admin: dois cliques nao lancam dois formularios ativos
            await conexao.query('SELECT id_usuario FROM administrador WHERE id_usuario = ? FOR UPDATE', [id]);

            const [[estado]]: any = await conexao.query(
                `SELECT EXISTS (SELECT 1 FROM formulario
                                 WHERE id_admin = ? AND status IN ('NAO_INICIADO', 'ABERTO')) AS tem_ativo,
                        EXISTS (SELECT 1 FROM dia_letivo d
                                  JOIN bloco_aula b ON b.id_admin = d.id_admin AND b.turno = d.turno
                                 WHERE d.id_admin = ?) AS tem_grade,
                        EXISTS (SELECT 1 FROM materia m
                                  JOIN semestre s ON s.id_semestre = m.id_semestre
                                 WHERE s.id_admin = ? AND m.ativo = TRUE) AS tem_materia`,
                [id, id, id]
            );

            if (estado.tem_ativo === 1) {
              conflito = 'Já existe um formulário programado ou aberto; encerre-o antes de lançar outro';
            } else if (estado.tem_grade !== 1 || estado.tem_materia !== 1) {
              // Sem dia com bloco ou sem disciplina, o professor nao tem o que responder
              conflito = 'Cadastre os dias letivos, os blocos de aulas e as disciplinas antes de lançar o formulário';
            } else {
              // Sem id_semestre o formulario alcanca todos os semestres do admin
              // (semestre.id_admin) e as disciplinas de cada um 
              await conexao.query(
                  `INSERT INTO formulario (id_admin, nome, periodo_letivo, data_inicio, data_fim, status)
                   VALUES (?, ?, ?, ?, ?, IF(? <= NOW(), 'ABERTO', 'NAO_INICIADO'))`,
                  [id, dados.nome, dados.periodoLetivo, dados.inicio.valor, dados.fim.valor, dados.inicio.valor]
              );
            }

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        if (conflito) {
          return resposta.status(409).json({ error: conflito });
        }

        const formularios = await montarFormularios(id);

        return resposta.status(201).json({
            message: formularios[0].status === 'ABERTO' ? 'Formulário lançado e aberto para respostas' : 'Formulário programado',
            formularios,
        });
    } catch (error) {
        console.error('Erro ao lançar formulário:', error);
        return resposta.status(500).json({ error: 'Erro interno ao lançar o formulário' });
    }
}

// CU-024: botao "EDITAR DATA"
export async function editarDatasFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const { erro, datas } = validarDatas(req.body);

    if (!datas) {
      return resposta.status(400).json({ error: erro });
    }

    try {
        await atualizarStatusFormularios();

        const formulario = await buscarFormularioDoAdmin(id, Number(req.params.idFormulario));

        if (!formulario) {
          return resposta.status(404).json({ error: 'Formulário não encontrado' });
        }

        if (formulario.status === 'NAO_INICIADO') {
          await pool.query(
              'UPDATE formulario SET data_inicio = ?, data_fim = ? WHERE id_formulario = ?',
              [datas.inicio.valor, datas.fim.valor, formulario.id_formulario]
          );
          // Inicio hoje ou antes: o programado abre agora
          await atualizarStatusFormularios();
        } else {
          // Professores ja receberam o formulario com esse inicio. So o dia
          // (07.3): compara o dia; com a hora: compara o minuto
          const mesmoInicio = datas.inicio.soDia
              ? datas.inicio.dia === formulario.data_inicio
              : datas.inicio.valor.slice(0, 16) === formulario.inicio_minuto;

          if (!mesmoInicio) {
            return resposta.status(409).json({ error: 'O formulário já foi aberto; a data de início não pode mudar' });
          }

          await pool.query(
              'UPDATE formulario SET data_fim = ? WHERE id_formulario = ?',
              [datas.fim.valor, formulario.id_formulario]
          );
        }

        return resposta.json({
            message: 'Datas do formulário atualizadas',
            formularios: await montarFormularios(id),
        });
    } catch (error) {
        console.error('Erro ao editar datas do formulário:', error);
        return resposta.status(500).json({ error: 'Erro interno ao editar as datas do formulário' });
    }
}

// CU-023: abre agora um programado ou reabre o encerrado (botao "ABRIR")
export async function abrirFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        await atualizarStatusFormularios();

        const formulario = await buscarFormularioDoAdmin(id, Number(req.params.idFormulario));

        if (!formulario) {
          return resposta.status(404).json({ error: 'Formulário não encontrado' });
        }

        // CU-023 A1
        if (formulario.status === 'ABERTO') {
          return resposta.status(409).json({ error: 'O período de respostas já está em andamento' });
        }

        if (formulario.status === 'NAO_INICIADO') {
          await pool.query(
              `UPDATE formulario
                  SET status = 'ABERTO', data_inicio = DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:00'), iniciado_manualmente = TRUE
                WHERE id_formulario = ?`,
              [formulario.id_formulario]
          );

          return resposta.json({ message: 'Formulário aberto', formularios: await montarFormularios(id) });
        }

        // Encerrado: so o mais recente volta, para nao haver dois ativos
        if (formulario.mais_recente !== 1) {
          return resposta.status(409).json({ error: 'Apenas o formulário mais recente pode ser reaberto' });
        }
        
        if (formulario.termino_vencido === 1) {
          return resposta.status(409).json({ error: 'A data de término já passou; edite a data antes de reabrir' });
        }

        await pool.query(
            `UPDATE formulario
                SET status = 'ABERTO', iniciado_manualmente = TRUE, encerrado_manualmente = FALSE
              WHERE id_formulario = ?`,
            [formulario.id_formulario]
        );

        return resposta.json({ message: 'Formulário reaberto', formularios: await montarFormularios(id) });
    } catch (error) {
        console.error('Erro ao abrir formulário:', error);
        return resposta.status(500).json({ error: 'Erro interno ao abrir o formulário' });
    }
}

// CU-025: encerra as respostas; libera a geracao do horario (RN-29)
export async function encerrarFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        await atualizarStatusFormularios();

        const formulario = await buscarFormularioDoAdmin(id, Number(req.params.idFormulario));

        if (!formulario) {
          return resposta.status(404).json({ error: 'Formulário não encontrado' });
        }

        // CU-025 A1
        if (formulario.status === 'ENCERRADO') {
          return resposta.status(409).json({ error: 'O formulário já está encerrado' });
        }
        if (formulario.status === 'NAO_INICIADO') {
          return resposta.status(409).json({ error: 'O formulário ainda não foi aberto' });
        }

        await pool.query(
            `UPDATE formulario
                SET status = 'ENCERRADO', encerrado_manualmente = TRUE
              WHERE id_formulario = ?`,
            [formulario.id_formulario]
        );

        return resposta.json({ message: 'Formulário encerrado', formularios: await montarFormularios(id) });
    } catch (error) {
        console.error('Erro ao encerrar formulário:', error);
        return resposta.status(500).json({ error: 'Erro interno ao encerrar o formulário' });
    }
}

// Filtro da lista de professores: CU-027 (responderam) e CU-028 (pendentes)
const SITUACOES: Record<string, string> = {
    responderam: 'AND r.id_resposta IS NOT NULL',
    pendentes: 'AND r.id_resposta IS NULL',
};

// CU-027 e CU-028: lista da tela "Formulario Criado" ("Nome do professor que
// respondeu" e "Data da resposta") e o filtro de quem ainda nao respondeu
export async function listarProfessoresDoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const situacao = req.query.situacao;

    // So as chaves proprias: "constructor" e afins nao sao filtros
    if (situacao !== undefined && (typeof situacao !== 'string' || !Object.prototype.hasOwnProperty.call(SITUACOES, situacao))) {
      return resposta.status(400).json({ error: 'Filtro de situação inválido; use responderam ou pendentes' });
    }

    try {
        const formulario = await buscarFormularioDoAdmin(id, Number(req.params.idFormulario));

        if (!formulario) {
          return resposta.status(404).json({ error: 'Formulário não encontrado' });
        }

        // Vinculados ao admin, mais quem respondeu e depois foi desvinculado
        const [rows]: any = await pool.query(
            `SELECT u.id_usuario, u.nome, r.status AS status_resposta,
                    DATE_FORMAT(r.data_envio, '%Y-%m-%dT%H:%i:%s') AS data_envio
               FROM (SELECT v.id_professor
                       FROM vinculo_professor_admin v
                      WHERE v.id_admin = ? AND v.ativo = TRUE
                     UNION
                     SELECT rf.id_professor
                       FROM resposta_formulario rf
                      WHERE rf.id_formulario = ?) p
               JOIN usuario u ON u.id_usuario = p.id_professor
               LEFT JOIN resposta_formulario r
                 ON r.id_formulario = ? AND r.id_professor = p.id_professor
              WHERE TRUE ${situacao ? SITUACOES[situacao as string] : ''}
              ORDER BY u.nome`,
            [id, formulario.id_formulario, formulario.id_formulario]
        );

        return resposta.json({
            idFormulario: formulario.id_formulario,
            situacao: situacao ?? 'todos',
            professores: rows.map((linha: any) => ({
                id: linha.id_usuario,
                nome: linha.nome,
                respondeu: linha.status_resposta !== null,
                dataEnvio: linha.data_envio,
                statusResposta: linha.status_resposta,
            })),
        });
    } catch (error) {
        console.error('Erro ao listar professores do formulário:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar os professores do formulário' });
    }
}
