import { Request, Response }       from 'express';
import pool                        from '../database/connection';
import { montarDetalhesResposta }  from './formularioController';
import { buscarAulasDoProfessor }  from './horarioController';

/*
   Indicadores da listagem (etiquetas e filtros da tela):
   - resposta_pendente:    nao respondeu algum formulario ABERTO do admin
   - alteracao_formulario: tem pedido PENDENTE de alteracao de resposta
   - alteracao_horario:    tem pedido PENDENTE sobre a previa atual do admin
     (o pedido de horario e so descritivo, entao some quando a previa e substituida)
*/
const INDICADORES = `
       EXISTS (SELECT 1 FROM formulario f
                WHERE f.id_admin = v.id_admin
                  AND f.status = 'ABERTO'
                  AND (f.data_fim IS NULL OR f.data_fim > NOW())
                  AND NOT EXISTS (SELECT 1 FROM resposta_formulario r
                                   WHERE r.id_formulario = f.id_formulario
                                     AND r.id_professor = u.id_usuario)) AS resposta_pendente,
       EXISTS (SELECT 1 FROM solicitacao_alteracao_resposta sr
                 JOIN resposta_formulario r ON r.id_resposta = sr.id_resposta
                 JOIN formulario f          ON f.id_formulario = r.id_formulario
                WHERE f.id_admin = v.id_admin
                  AND r.id_professor = u.id_usuario
                  AND sr.status = 'PENDENTE') AS alteracao_formulario,
       EXISTS (SELECT 1 FROM solicitacao_alteracao_horario sh
                 JOIN geracao_horario g ON g.id_geracao = sh.id_geracao
                WHERE g.id_admin = v.id_admin
                  AND g.status = 'PREVIA'
                  AND sh.id_professor = u.id_usuario
                  AND sh.status = 'PENDENTE') AS alteracao_horario`;

const FILTROS: Record<string, string> = {
    'resposta-pendente':    'HAVING resposta_pendente = 1',
    'alteracao-formulario': 'HAVING alteracao_formulario = 1',
    'alteracao-horario':    'HAVING alteracao_horario = 1',
};

const montarIndicadores = (linha: any) => ({
    respostaPendente:             linha.resposta_pendente === 1,
    solicitouAlteracaoFormulario: linha.alteracao_formulario === 1,
    solicitouAlteracaoHorario:    linha.alteracao_horario === 1,
});

// RF 6.4: o admin so enxerga professores com vinculo ativo com ele
async function buscarProfessorVinculado(idAdmin: number, idProfessor: number) {
    if (!Number.isInteger(idProfessor)) {
      return null;
    }

    const [rows]: any = await pool.query(
        `SELECT u.id_usuario, u.nome, u.email, u.ativo,
                p.carga_horaria_semanal, p.titulacao, v.data_vinculo,
                ${INDICADORES}
           FROM vinculo_professor_admin v
           JOIN usuario u   ON u.id_usuario = v.id_professor
           JOIN professor p ON p.id_usuario = v.id_professor
          WHERE v.id_admin = ?
            AND v.id_professor = ?
            AND v.ativo = TRUE`,
        [idAdmin, idProfessor]
    );

    return rows.length > 0 ? rows[0] : null;
}

// CU-009 / CU-010 / CU-028: listagem com busca por nome ou e-mail e filtros
export async function listarProfessores(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const termo  = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
    const filtro = typeof req.query.filtro === 'string' ? req.query.filtro : '';

    if (filtro !== '' && !FILTROS[filtro]) {
      return resposta.status(400).json({
        error: 'Filtro inválido; use resposta-pendente, alteracao-formulario ou alteracao-horario',
      });
    }

    // % e _ digitados na busca valem como texto
    const padrao = `%${termo.replace(/[\\%_]/g, '\\$&')}%`;

    try {
        const [rows]: any = await pool.query(
            `SELECT u.id_usuario, u.nome, u.email, u.ativo,
                    ${INDICADORES}
               FROM vinculo_professor_admin v
               JOIN usuario u ON u.id_usuario = v.id_professor
              WHERE v.id_admin = ?
                AND v.ativo = TRUE
                AND (u.nome LIKE ? OR u.email LIKE ?)
              ${filtro === '' ? '' : FILTROS[filtro]}
              ORDER BY u.nome`,
            [id, padrao, padrao]
        );

        const professores = rows.map((linha: any) => ({
            id: linha.id_usuario,
            nome: linha.nome,
            email: linha.email,
            ativo: linha.ativo === 1,
            ...montarIndicadores(linha),
        }));

        // RF 8.5: mensagem quando a busca ou o filtro nao retorna nada
        if (professores.length === 0) {
          return resposta.json({
            professores,
            message: termo === '' && filtro === ''
                ? 'Nenhum professor vinculado'
                : 'Nenhum professor encontrado',
          });
        }

        return resposta.json({ professores });
    } catch (error) {
        console.error('Erro ao listar professores:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar os professores' });
    }
}

// CU-011: dados cadastrais + formularios do admin, para o botao FORMULARIO
export async function dadosProfessor(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idProfessor = Number(req.params.idProfessor);

    try {
        const professor = await buscarProfessorVinculado(id, idProfessor);

        if (!professor) {
          return resposta.status(404).json({ error: 'Professor não encontrado' });
        }

        const [formularios]: any = await pool.query(
            `SELECT f.id_formulario, f.nome, f.status, f.data_inicio, f.data_fim,
                    r.id_resposta, r.status AS status_resposta, r.data_envio
               FROM formulario f
               LEFT JOIN resposta_formulario r
                 ON r.id_formulario = f.id_formulario
                AND r.id_professor = ?
              WHERE f.id_admin = ?
                AND f.status <> 'NAO_INICIADO'
              ORDER BY f.data_inicio DESC, f.id_formulario DESC`,
            [idProfessor, id]
        );

        return resposta.json({
            professor: {
                id: professor.id_usuario,
                nome: professor.nome,
                email: professor.email,
                ativo: professor.ativo === 1,
                cargaHorariaSemanal: Number(professor.carga_horaria_semanal),
                titulacao: professor.titulacao,
                dataVinculo: professor.data_vinculo,
                ...montarIndicadores(professor),
            },
            formularios: formularios.map((linha: any) => ({
                id: linha.id_formulario,
                nome: linha.nome,
                status: linha.status,
                dataInicio: linha.data_inicio,
                dataFim: linha.data_fim,
                respondido: linha.id_resposta !== null,
                statusResposta: linha.status_resposta,
                dataEnvio: linha.data_envio,
            })),
        });
    } catch (error) {
        console.error('Erro ao buscar professor:', error);
        return resposta.status(500).json({ error: 'Erro interno ao buscar o professor' });
    }
}

// CU-012: resposta do professor a um formulario do admin
export async function verRespostaProfessor(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idProfessor  = Number(req.params.idProfessor);
    const idFormulario = Number(req.params.idFormulario);

    try {
        if (!(await buscarProfessorVinculado(id, idProfessor))) {
          return resposta.status(404).json({ error: 'Professor não encontrado' });
        }
        if (!Number.isInteger(idFormulario)) {
          return resposta.status(404).json({ error: 'Formulário não encontrado' });
        }

        const [respostas]: any = await pool.query(
            `SELECT r.id_resposta, r.status, r.data_envio, f.nome AS nome_formulario
               FROM resposta_formulario r
               JOIN formulario f ON f.id_formulario = r.id_formulario
              WHERE r.id_formulario = ?
                AND r.id_professor = ?
                AND f.id_admin = ?`,
            [idFormulario, idProfessor, id]
        );

        // CU-012 A1
        if (respostas.length === 0) {
          return resposta.status(404).json({ error: 'O professor não enviou resposta para este formulário' });
        }

        const dadosResposta = respostas[0];

        return resposta.json({
            formulario: dadosResposta.nome_formulario,
            status: dadosResposta.status,
            dataEnvio: dadosResposta.data_envio,
            ...(await montarDetalhesResposta(dadosResposta.id_resposta)),
        });
    } catch (error) {
        console.error('Erro ao buscar resposta do professor:', error);
        return resposta.status(500).json({ error: 'Erro interno ao buscar a resposta do professor' });
    }
}

// CU-013: aulas do professor nos semestres do admin (previa e definitivo)
export async function verHorarioProfessor(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idProfessor = Number(req.params.idProfessor);

    try {
        if (!(await buscarProfessorVinculado(id, idProfessor))) {
          return resposta.status(404).json({ error: 'Professor não encontrado' });
        }

        const previa     = await buscarAulasDoProfessor(idProfessor, 'PREVIA', id);
        const definitivo = await buscarAulasDoProfessor(idProfessor, 'DEFINITIVO', id);

        // CU-013 A1
        if (previa.length === 0 && definitivo.length === 0) {
          return resposta.json({ previa, definitivo, message: 'Não existem aulas atribuídas a este professor' });
        }

        return resposta.json({ previa, definitivo });
    } catch (error) {
        console.error('Erro ao buscar horário do professor:', error);
        return resposta.status(500).json({ error: 'Erro interno ao buscar o horário do professor' });
    }
}

// RF 8.9: solicitacoes do professor feitas no ambito do admin
export async function listarSolicitacoesProfessor(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idProfessor = Number(req.params.idProfessor);

    try {
        if (!(await buscarProfessorVinculado(id, idProfessor))) {
          return resposta.status(404).json({ error: 'Professor não encontrado' });
        }

        const [doFormulario]: any = await pool.query(
            `SELECT s.id_solicitacao, s.motivo, s.status, s.data_solicitacao, s.data_analise,
                    f.id_formulario, f.nome AS nome_formulario
               FROM solicitacao_alteracao_resposta s
               JOIN resposta_formulario r ON r.id_resposta = s.id_resposta
               JOIN formulario f          ON f.id_formulario = r.id_formulario
              WHERE r.id_professor = ?
                AND f.id_admin = ?
              ORDER BY s.data_solicitacao DESC`,
            [idProfessor, id]
        );

        const [doHorario]: any = await pool.query(
            `SELECT sh.id_solicitacao, sh.id_geracao, g.numero_versao, g.status AS status_geracao,
                    s.nome AS semestre, sh.id_aula, m.nome AS materia, d.dia_semana, sl.numero_aula,
                    sh.motivo, sh.status, sh.data_envio
               FROM solicitacao_alteracao_horario sh
               JOIN geracao_horario g   ON g.id_geracao     = sh.id_geracao
               JOIN semestre s          ON s.id_semestre    = g.id_semestre
               LEFT JOIN aula_alocada a ON a.id_aula        = sh.id_aula
               LEFT JOIN materia m      ON m.id_materia     = a.id_materia
               LEFT JOIN dia_letivo d   ON d.id_dia_letivo  = a.id_dia_letivo
               LEFT JOIN slot_aula sl   ON sl.id_slot       = a.id_slot
              WHERE sh.id_professor = ?
                AND g.id_admin = ?
              ORDER BY sh.data_envio DESC`,
            [idProfessor, id]
        );

        return resposta.json({
            formulario: doFormulario.map((linha: any) => ({
                id: linha.id_solicitacao,
                idFormulario: linha.id_formulario,
                formulario: linha.nome_formulario,
                motivo: linha.motivo,
                status: linha.status,
                dataSolicitacao: linha.data_solicitacao,
                dataAnalise: linha.data_analise,
            })),
            horario: doHorario.map((linha: any) => ({
                id:            linha.id_solicitacao,
                idGeracao:     linha.id_geracao,
                versao:        linha.numero_versao,
                statusGeracao: linha.status_geracao,
                semestre:      linha.semestre,
                aula: linha.id_aula === null ? null : {
                    idAula:  linha.id_aula,
                    materia: linha.materia,
                    dia:     linha.dia_semana,
                    aula:    linha.numero_aula,
                },
                motivo:    linha.motivo,
                status:    linha.status,
                dataEnvio: linha.data_envio,
            })),
        });
    } catch (error) {
        console.error('Erro ao listar solicitações do professor:', error);
        return resposta.status(500).json({ error: 'Erro interno ao listar as solicitações do professor' });
    }
}

async function buscarSolicitacaoFormulario(idAdmin: number, idSolicitacao: number) {
    if (!Number.isInteger(idSolicitacao)) {
      return null;
    }

    const [rows]: any = await pool.query(
        `SELECT s.id_solicitacao, s.id_resposta, s.motivo, s.status, s.data_solicitacao, s.data_analise,
                f.id_formulario, f.nome AS nome_formulario,
                u.id_usuario AS id_professor, u.nome AS nome_professor, u.email AS email_professor
           FROM solicitacao_alteracao_resposta s
           JOIN resposta_formulario r ON r.id_resposta = s.id_resposta
           JOIN formulario f          ON f.id_formulario = r.id_formulario
           JOIN usuario u             ON u.id_usuario = r.id_professor
          WHERE s.id_solicitacao = ?
            AND f.id_admin = ?`,
        [idSolicitacao, idAdmin]
    );

    return rows.length > 0 ? rows[0] : null;
}

// CU-056: tela do pedido de alteracao do formulario
export async function verSolicitacaoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idSolicitacao = Number(req.params.idSolicitacao);

    try {
        const solicitacao = await buscarSolicitacaoFormulario(id, idSolicitacao);

        if (!solicitacao) {
          return resposta.status(404).json({ error: 'Solicitação não encontrada' });
        }

        return resposta.json({
            solicitacao: {
                id: solicitacao.id_solicitacao,
                motivo: solicitacao.motivo,
                status: solicitacao.status,
                dataSolicitacao: solicitacao.data_solicitacao,
                dataAnalise: solicitacao.data_analise,
                formulario: { id: solicitacao.id_formulario, nome: solicitacao.nome_formulario },
                professor: {
                    id: solicitacao.id_professor,
                    nome: solicitacao.nome_professor,
                    email: solicitacao.email_professor,
                },
            },
        });
    } catch (error) {
        console.error('Erro ao buscar solicitação:', error);
        return resposta.status(500).json({ error: 'Erro interno ao buscar a solicitação' });
    }
}

// CU-037: aprova (libera a resposta para reenvio) ou recusa; o professor e notificado (RF 5.8)
export async function decidirSolicitacaoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idSolicitacao = Number(req.params.idSolicitacao);
    const { decisao } = req.body;
    const textoResposta = typeof req.body.resposta === 'string' ? req.body.resposta.trim() : '';

    if (decisao !== 'APROVADA' && decisao !== 'REJEITADA') {
      return resposta.status(400).json({ error: 'Decisão inválida; use APROVADA ou REJEITADA' });
    }
    if (decisao === 'REJEITADA' && textoResposta === '') {
      return resposta.status(400).json({ error: 'Informe o motivo da recusa' });
    }
    if (textoResposta.length > 500) {
      return resposta.status(400).json({ error: 'A resposta deve ter no máximo 500 caracteres' });
    }

    try {
        const solicitacao = await buscarSolicitacaoFormulario(id, idSolicitacao);

        if (!solicitacao) {
          return resposta.status(404).json({ error: 'Solicitação não encontrada' });
        }

        const aprovada = decisao === 'APROVADA';
        const conexao  = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            // CU-037 A1: so decide o que ainda esta pendente
            const [atualizacao]: any = await conexao.query(
                `UPDATE solicitacao_alteracao_resposta
                    SET status = ?, id_admin_analise = ?, data_analise = NOW()
                  WHERE id_solicitacao = ? AND status = 'PENDENTE'`,
                [decisao, id, idSolicitacao]
            );

            if (atualizacao.affectedRows === 0) {
                await conexao.rollback();
                return resposta.status(409).json({ error: 'Esta solicitação já foi analisada' });
            }

            if (aprovada) {
                await conexao.query(
                    "UPDATE resposta_formulario SET status = 'LIBERADA_PARA_ALTERACAO' WHERE id_resposta = ?",
                    [solicitacao.id_resposta]
                );
            }

            const mensagem = textoResposta !== ''
                ? textoResposta
                : `Sua solicitação de alteração do formulário "${solicitacao.nome_formulario}" foi aprovada. Você já pode reenviar a resposta.`;

            await conexao.query(
                `INSERT INTO notificacao (id_destinatario, tipo, titulo, mensagem, data_envio, tipo_referencia, id_referencia)
                 VALUES (?, 'SOLICITACAO_DECIDIDA', ?, ?, NOW(), 'SOLICITACAO_ALTERACAO_RESPOSTA', ?)`,
                [
                    solicitacao.id_professor,
                    aprovada ? 'Solicitação de alteração aprovada' : 'Solicitação de alteração recusada',
                    mensagem.slice(0, 500),
                    idSolicitacao,
                ]
            );

            // RNF 2: aprovacao de solicitacoes fica registrada
            await conexao.query(
                `INSERT INTO registro_auditoria (id_usuario, acao, entidade, id_entidade, data_hora, detalhes)
                 VALUES (?, 'DECIDIR_SOLICITACAO_FORMULARIO', 'solicitacao_alteracao_resposta', ?, NOW(), ?)`,
                [id, idSolicitacao, JSON.stringify({ decisao })]
            );

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({ message: aprovada ? 'Solicitação aprovada' : 'Solicitação recusada' });
    } catch (error) {
        console.error('Erro ao decidir solicitação:', error);
        return resposta.status(500).json({ error: 'Erro interno ao registrar a decisão' });
    }
}

// CU-008: ativa ou desativa a conta; desativar encerra as sessoes abertas (RN-01)
export async function alterarStatusConta(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idProfessor = Number(req.params.idProfessor);
    const { ativo } = req.body;

    if (typeof ativo !== 'boolean') {
      return resposta.status(400).json({ error: 'Informe ativo como true ou false' });
    }

    try {
        const professor = await buscarProfessorVinculado(id, idProfessor);

        // CU-008 A1
        if (!professor) {
          return resposta.status(404).json({ error: 'Professor não encontrado' });
        }

        if ((professor.ativo === 1) === ativo) {
          return resposta.status(409).json({ error: ativo ? 'A conta já está ativa' : 'A conta já está desativada' });
        }

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            await conexao.query('UPDATE usuario SET ativo = ? WHERE id_usuario = ?', [ativo, idProfessor]);

            if (!ativo) {
                await conexao.query(
                    `UPDATE sessao
                        SET encerrada_em = NOW(),
                            motivo_encerramento = 'CONTA_DESATIVADA'
                      WHERE id_usuario = ?
                        AND encerrada_em IS NULL`,
                    [idProfessor]
                );
            }

            // RNF 2: alteracao de permissao fica registrada
            await conexao.query(
                `INSERT INTO registro_auditoria (id_usuario, acao, entidade, id_entidade, data_hora, detalhes)
                 VALUES (?, ?, 'usuario', ?, NOW(), NULL)`,
                [id, ativo ? 'ATIVAR_CONTA' : 'DESATIVAR_CONTA', idProfessor]
            );

            await conexao.commit();
        } catch (error) {
            await conexao.rollback();
            throw error;
        } finally {
            conexao.release();
        }

        return resposta.json({ message: ativo ? 'Conta ativada' : 'Conta desativada' });
    } catch (error) {
        console.error('Erro ao alterar status da conta:', error);
        return resposta.status(500).json({ error: 'Erro interno ao alterar o status da conta' });
    }
}
