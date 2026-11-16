import { Request, Response }       from 'express';
import pool                        from '../database/connection';
import { montarDetalhesResposta }  from './formularioController';
import { buscarAulasDoProfessor }  from './horarioController';

/*
   Indicadores da listagem (etiquetas e filtros da tela):
   - resposta_pendente:    nao respondeu algum formulario ABERTO do admin
   - alteracao_formulario: tem pedido PENDENTE de alteracao de resposta
   - alteracao_horario:    tem pedido PENDENTE e ainda nao lido sobre a previa atual do admin
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
                  AND sh.status = 'PENDENTE'
                  AND sh.data_leitura IS NULL) AS alteracao_horario`;

const FILTROS: Record<string, string> = {
    'resposta-pendente':    'HAVING resposta_pendente = 1',
    'alteracao-formulario': 'HAVING alteracao_formulario = 1',
    'alteracao-horario':    'HAVING alteracao_horario = 1',
};

// Envio da resposta ao formulario mais recente do admin (o que a tela Formulario mostra)
const DATA_RESPOSTA = `
       (SELECT DATE_FORMAT(r.data_envio, '%Y-%m-%dT%H:%i:%s')
          FROM resposta_formulario r
         WHERE r.id_professor = u.id_usuario
           AND r.id_formulario = (SELECT MAX(f2.id_formulario) FROM formulario f2
                                   WHERE f2.id_admin = v.id_admin)) AS data_resposta`;

const DATA_VINCULO = `DATE_FORMAT(v.data_vinculo, '%Y-%m-%dT%H:%i:%s') AS data_vinculo`;

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
                p.carga_horaria_semanal, p.titulacao,
                ${DATA_VINCULO},
                ${DATA_RESPOSTA},
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

/*
   Convites PENDENTES e no prazo de quem ainda nao tem vinculo ativo com o admin.
   Sem o nome: de quem ja tem conta, ele e dado de outra administracao ate o aceite
   (RF 6.4, RN-37). O convite vencido segue PENDENTE no banco ate o link ser aberto,
   por isso o filtro pela data.
*/
async function buscarConvitesPendentes(idAdmin: number, padrao: string) {
    const [linhas]: any = await pool.query(
        `SELECT c.id_convite, c.email_destino, c.tipo_convite,
                DATE_FORMAT(c.data_envio, '%Y-%m-%dT%H:%i:%s')     AS data_envio,
                DATE_FORMAT(c.data_expiracao, '%Y-%m-%dT%H:%i:%s') AS data_expiracao
           FROM convite_professor c
          WHERE c.id_admin = ?
            AND c.status = 'PENDENTE'
            AND c.data_expiracao > NOW()
            AND c.email_destino LIKE ?
            AND NOT EXISTS (SELECT 1 FROM vinculo_professor_admin v
                              JOIN usuario u ON u.id_usuario = v.id_professor
                             WHERE v.id_admin = c.id_admin
                               AND v.ativo = TRUE
                               AND u.email = c.email_destino)
          ORDER BY c.email_destino`,
        [idAdmin, padrao]
    );
    return linhas;
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
        // Professores e convites sao independentes: as duas consultas vao juntas ao banco
        const [[rows], linhasConvites]: any = await Promise.all([
            pool.query(
                `SELECT u.id_usuario, u.nome, u.email, u.ativo,
                        ${DATA_VINCULO},
                        ${DATA_RESPOSTA},
                        ${INDICADORES}
                   FROM vinculo_professor_admin v
                   JOIN usuario u ON u.id_usuario = v.id_professor
                  WHERE v.id_admin = ?
                    AND v.ativo = TRUE
                    AND (u.nome LIKE ? OR u.email LIKE ?)
                  ${filtro === '' ? '' : FILTROS[filtro]}
                  ORDER BY u.nome`,
                [id, padrao, padrao]
            ),
            // Convidado nao deve resposta nem tem pedido: com filtro, a lista vem vazia
            filtro === '' ? buscarConvitesPendentes(id, padrao) : Promise.resolve([]),
        ]);

        const professores = rows.map((linha: any) => ({
            id: linha.id_usuario,
            nome: linha.nome,
            email: linha.email,
            ativo: linha.ativo === 1,
            dataVinculo: linha.data_vinculo,
            dataResposta: linha.data_resposta,
            ...montarIndicadores(linha),
        }));

        const convites = linhasConvites.map((linha: any) => ({
            idConvite: linha.id_convite,
            email: linha.email_destino,
            tipo: linha.tipo_convite,
            dataEnvio: linha.data_envio,
            dataExpiracao: linha.data_expiracao,
        }));

        // RF 8.5: mensagem quando a busca ou o filtro nao retorna nada
        if (professores.length === 0 && convites.length === 0) {
          return resposta.json({
            professores,
            convites,
            message: termo === '' && filtro === ''
                ? 'Nenhum professor vinculado'
                : 'Nenhum professor encontrado',
          });
        }

        return resposta.json({ professores, convites });
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
                dataResposta: professor.data_resposta,
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
                    f.id_formulario, f.nome AS nome_formulario,
                    (SELECT n.mensagem FROM notificacao n
                      WHERE n.tipo = 'SOLICITACAO_DECIDIDA'
                        AND n.tipo_referencia = 'SOLICITACAO_ALTERACAO_RESPOSTA'
                        AND n.id_referencia = s.id_solicitacao
                      ORDER BY n.id_notificacao DESC
                      LIMIT 1) AS resposta
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
                    s.nome AS semestre, sh.id_aula, m.nome AS materia, d.dia_semana, d.turno,
                    sl.numero_aula,
                    -- aula contando o turno inteiro, como em montarDetalhesResposta
                    (SELECT COALESCE(SUM(b2.qtd_aulas), 0) FROM bloco_aula b2
                      WHERE b2.id_admin = b.id_admin AND b2.turno = b.turno AND b2.ordem < b.ordem)
                      + sl.numero_aula AS posicao,
                    t.nome AS turma,
                    -- numero do semestre = posicao entre os do admin, como em semestreController
                    (SELECT COUNT(*) FROM semestre s2
                      WHERE s2.id_admin = st.id_admin AND s2.id_semestre <= st.id_semestre) AS numero_semestre,
                    sh.motivo, sh.status, sh.data_envio, sh.data_leitura, sh.resposta
               FROM solicitacao_alteracao_horario sh
               JOIN geracao_horario g   ON g.id_geracao     = sh.id_geracao
               JOIN semestre s          ON s.id_semestre    = g.id_semestre
               LEFT JOIN aula_alocada a ON a.id_aula        = sh.id_aula
               LEFT JOIN materia m      ON m.id_materia     = a.id_materia
               LEFT JOIN dia_letivo d   ON d.id_dia_letivo  = a.id_dia_letivo
               LEFT JOIN slot_aula sl   ON sl.id_slot       = a.id_slot
               LEFT JOIN bloco_aula b   ON b.id_bloco       = sl.id_bloco
               LEFT JOIN turma t        ON t.id_turma       = a.id_turma
               LEFT JOIN semestre st    ON st.id_semestre   = t.id_semestre
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
                resposta: linha.status === 'PENDENTE' ? null : linha.resposta,
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
                    turno:   linha.turno,
                    posicao: Number(linha.posicao),
                    turma:   { nome: linha.turma, numeroSemestre: Number(linha.numero_semestre) },
                },
                motivo:      linha.motivo,
                status:      linha.status,
                dataEnvio:   linha.data_envio,
                dataLeitura: linha.data_leitura,
                resposta:    linha.resposta,
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

// CU-037: aprova (libera a resposta para reenvio) ou recusa; o professor e notificado (RF 5.8).
// A resposta do admin e opcional nas duas decisoes; sem ela, vai a mensagem padrao.
export async function decidirSolicitacaoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idSolicitacao = Number(req.params.idSolicitacao);
    const { decisao } = req.body;
    const textoResposta = typeof req.body.resposta === 'string' ? req.body.resposta.trim() : '';

    if (decisao !== 'APROVADA' && decisao !== 'REJEITADA') {
      return resposta.status(400).json({ error: 'Decisão inválida; use APROVADA ou REJEITADA' });
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
                : aprovada
                    ? `Sua solicitação de alteração do formulário "${solicitacao.nome_formulario}" foi aprovada. Você já pode reenviar a resposta.`
                    : `Sua solicitação de alteração do formulário "${solicitacao.nome_formulario}" foi recusada.`;

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

/*
   RF 9.5 / RF 3.4: o pedido de horario e so descritivo (nao e aprovado nem
   rejeitado); o admin o marca como lido e pode deixar uma resposta
*/
export async function marcarSolicitacaoHorarioComoLida(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idSolicitacao = Number(req.params.idSolicitacao);
    const entrada = req.body.resposta;

    if (entrada !== undefined && entrada !== null && typeof entrada !== 'string') {
      return resposta.status(400).json({ error: 'A resposta deve ser um texto' });
    }

    const textoResposta = typeof entrada === 'string' ? entrada.trim() : '';

    if (textoResposta.length > 500) {
      return resposta.status(400).json({ error: 'A resposta deve ter no máximo 500 caracteres' });
    }

    try {
        if (!Number.isInteger(idSolicitacao)) {
          return resposta.status(404).json({ error: 'Solicitação não encontrada' });
        }

        // RN-06: so pedidos sobre geracoes do proprio admin
        const [pedidos]: any = await pool.query(
            `SELECT sh.data_leitura
               FROM solicitacao_alteracao_horario sh
               JOIN geracao_horario g ON g.id_geracao = sh.id_geracao
              WHERE sh.id_solicitacao = ?
                AND g.id_admin = ?`,
            [idSolicitacao, id]
        );

        if (pedidos.length === 0) {
          return resposta.status(404).json({ error: 'Solicitação não encontrada' });
        }

        // Grava so se ainda nao foi lido: dois cliques ao mesmo tempo nao gravam duas vezes
        const [atualizacao]: any = await pool.query(
            `UPDATE solicitacao_alteracao_horario
                SET data_leitura = NOW(), resposta = ?
              WHERE id_solicitacao = ?
                AND data_leitura IS NULL`,
            [textoResposta === '' ? null : textoResposta, idSolicitacao]
        );

        if (pedidos[0].data_leitura !== null || atualizacao.affectedRows === 0) {
          return resposta.status(409).json({ error: 'Esta solicitação já foi lida' });
        }

        return resposta.json({ message: 'Solicitação marcada como lida' });
    } catch (error) {
        console.error('Erro ao marcar solicitação como lida:', error);
        return resposta.status(500).json({ error: 'Erro interno ao marcar a solicitação como lida' });
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
