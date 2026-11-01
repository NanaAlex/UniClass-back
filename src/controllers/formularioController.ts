import { Request, Response } from "express";
import pool from "../database/connection";

// Confere acesso
async function buscarFormularioAcessivel(idProfessor: number, idFormulario: number) {
    const [rows]: any = await pool.query(
        `SELECT f.id_formulario, f.nome, f.data_fim, f.id_admin, f.id_semestre
             FROM formulario f
             JOIN vinculo_professor_admin v
               ON v.id_admin = f.id_admin
              AND v.id_professor = ?
              AND v.ativo = TRUE
            WHERE f.id_formulario = ?
              AND f.status = 'ABERTO'
              AND (f.data_fim IS NULL OR f.data_fim > NOW())`,
        [idProfessor, idFormulario]
    );

  return rows.length > 0 ? rows[0] : null;
}

function validarCorpoResposta(corpo: any): string | null {
    const { disponibilidades, preferenciasTurno, interesses } = corpo;

    if (!Array.isArray(disponibilidades) || disponibilidades.length === 0) {
      return 'Informe sua disponibilidade';
    }
    if (!Array.isArray(preferenciasTurno) || preferenciasTurno.length === 0) {
      return 'Informe a prioridade dos turnos';
    }
    if (!Array.isArray(interesses) || interesses.length === 0) {
      return 'Selecione pelo menos uma matéria';
    }

    // notas
    const notaValida = (nota: any) => Number.isInteger(nota) && nota >= 1 && nota <= 5;

    if (!preferenciasTurno.every((item: any) => notaValida(item.nota))) {
      return 'As notas dos turnos devem ser de 1 a 5';
    }
    if (!interesses.every((item: any) => notaValida(item.nota))) {
      return 'As notas das matérias devem ser de 1 a 5';
    }

    if (!disponibilidades.every((item: any) => typeof item.disponivel === 'boolean')) {
      return 'Disponibilidade inválida';
    }

    return null;
}

export async function listarFormularios(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const [rows]: any = await pool.query(
            `SELECT f.id_formulario, f.nome, f.data_inicio, f.data_fim,
                    r.id_resposta, r.status AS status_resposta, r.data_envio
               FROM formulario f
               JOIN vinculo_professor_admin v
                 ON v.id_admin = f.id_admin
                AND v.id_professor = ?
                AND v.ativo = TRUE
               LEFT JOIN resposta_formulario r
                 ON r.id_formulario = f.id_formulario
                AND r.id_professor = ?
              WHERE f.status = 'ABERTO'
                AND (f.data_fim IS NULL OR f.data_fim > NOW())`,
            [id, id]
        );

        const formularios = rows.map((linha: any) => ({
            id: linha.id_formulario,
            nome: linha.nome,
            dataInicio: linha.data_inicio,
            dataFim: linha.data_fim,
            respondido: linha.id_resposta !== null,
            podeResponder: linha.id_resposta === null || linha.status_resposta === 'LIBERADA_PARA_ALTERACAO',
            dataEnvio: linha.data_envio,
    }));

    return resposta.json({ formularios });

    } catch (error) {
        console.error('Erro ao listar formulários:', error);
        return resposta.status(500).json({ error: 'Erro ao listar formulários' });
    }
}

export async function dadosDoFormulario(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idFormulario = Number(req.params.idFormulario);

    try {
        const formulario = await buscarFormularioAcessivel(id, idFormulario);

        if (!formulario) {
            return resposta.status(404).json({ error: 'Formulário indisponível' });
        }

        // Dias letivos adm
        const [dias]: any = await pool.query(
          `SELECT id_dia_letivo, dia_semana, turno
             FROM dia_letivo
            WHERE id_admin = ?
            ORDER BY turno, FIELD(dia_semana, 'SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO')`,
          [formulario.id_admin]
        );

        // aulas com blocos
        const [slots]: any = await pool.query(
          `SELECT s.id_slot, s.numero_aula, s.hora_inicio, s.hora_fim,
                  b.turno, b.ordem AS ordem_bloco
             FROM slot_aula s
             JOIN bloco_aula b ON b.id_bloco = s.id_bloco
            WHERE b.id_admin = ?
            ORDER BY b.turno, b.ordem, s.numero_aula`,
          [formulario.id_admin]
        );

        const [materias]: any = await pool.query(
          `SELECT id_materia, nome, turno
             FROM materia
            WHERE id_semestre = ?
              AND ativo = TRUE
            ORDER BY nome`,
          [formulario.id_semestre]
        );

          return resposta.json({
            formulario: {
                id: formulario.id_formulario,
                nome: formulario.nome,
                dataFim: formulario.data_fim,
            },

            dias: dias.map((dia: any) => ({
                id: dia.id_dia_letivo,
                diaSemana: dia.dia_semana,
                turno: dia.turno,
            })),

            slots: slots.map((slot: any) => ({
                id: slot.id_slot,
                turno: slot.turno,
                bloco: slot.ordem_bloco,
                aula: slot.numero_aula,
                inicio: slot.hora_inicio,
                fim: slot.hora_fim,
            })),

            materias: materias.map((materia: any) => ({
                id: materia.id_materia,
                nome: materia.nome,
                turno: materia.turno,
            })),

          });

        } catch (error) {
          console.error('Erro ao buscar dados do formulário:', error);
          return resposta.status(500).json({ error: 'Erro ao buscar dados do formulário' });
        }
}

export async function enviarResposta(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idFormulario = Number(req.params.idFormulario);

    const erroValidacao = validarCorpoResposta(req.body);
    if (erroValidacao) {
      return resposta.status(400).json({ error: erroValidacao });
    }

    try {
        const formulario = await buscarFormularioAcessivel(id, idFormulario);
        if (!formulario) {
          return resposta.status(404).json({ error: 'Formulário indisponível' });
        }

        const [respostas]: any = await pool.query(
            `SELECT id_resposta, status
               FROM resposta_formulario
              WHERE id_formulario = ? AND id_professor = ?`,
            [idFormulario, id]
        );

        const respostaExistente = respostas.length > 0 ? respostas[0] : null;

        if (respostaExistente && respostaExistente.status !== 'LIBERADA_PARA_ALTERACAO') {
          return resposta.status(409).json({
            error: 'Você já respondeu este formulário. Para alterar, envie uma solicitação.',
          });
        }

        // verificacao de id pertencentes ao formulário
        const [diasValidos]: any = await pool.query(
          'SELECT id_dia_letivo, turno FROM dia_letivo WHERE id_admin = ?',
          [formulario.id_admin]
        );

        const [slotsValidos]: any = await pool.query(
          `SELECT s.id_slot, b.turno
             FROM slot_aula s
             JOIN bloco_aula b ON b.id_bloco = s.id_bloco
            WHERE b.id_admin = ?`,
          [formulario.id_admin]
        );

        const [materiasValidas]: any = await pool.query(
          'SELECT id_materia FROM materia WHERE id_semestre = ? AND ativo = TRUE',
          [formulario.id_semestre]
        );

        const { disponibilidades, preferenciasTurno, interesses } = req.body;

        const disponibilidadesOk = disponibilidades.every((item: any) => {
            const dia = diasValidos.find((d: any) => d.id_dia_letivo === item.idDiaLetivo);
            const slot = slotsValidos.find((s: any) => s.id_slot === item.idSlot);
            return dia && slot && dia.turno === slot.turno;
        });

        const preferenciasOk = preferenciasTurno.every((item: any) =>
            diasValidos.some((d: any) => d.id_dia_letivo === item.idDiaLetivo)
        );

        const interessesOk = interesses.every((item: any) =>
            materiasValidas.some((m: any) => m.id_materia === item.idMateria)
        );

        if (!disponibilidadesOk || !preferenciasOk || !interessesOk) {
            return resposta.status(400).json({
            error: 'A resposta contém dias, horários ou matérias que não pertencem a este formulário',
          });
        }

         const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            let idResposta: number;

            if (respostaExistente) {
            // Reenvio liberado pelo adm
                idResposta = respostaExistente.id_resposta;

                await conexao.query(
                  `UPDATE resposta_formulario
                      SET status = 'ENVIADA', data_envio = NOW()
                    WHERE id_resposta = ?`,
                  [idResposta]
                );

                await conexao.query('DELETE FROM disponibilidade_horario WHERE id_resposta = ?', [idResposta]);
                await conexao.query('DELETE FROM preferencia_turno WHERE id_resposta = ?', [idResposta]);
                await conexao.query('DELETE FROM interesse_materia WHERE id_resposta = ?', [idResposta]);
            } else {
                const [resultado]: any = await conexao.query(
                    `INSERT INTO resposta_formulario (id_formulario, id_professor, data_envio, status)
                     VALUES (?, ?, NOW(), 'ENVIADA')`,
                    [idFormulario, id]
                );
                idResposta = resultado.insertId;
            }

            await conexao.query(
                'INSERT INTO disponibilidade_horario (id_resposta, id_dia_letivo, id_slot, disponivel) VALUES ?',
                [disponibilidades.map((item: any) => [idResposta, item.idDiaLetivo, item.idSlot, item.disponivel])]
            );

            await conexao.query(
                'INSERT INTO preferencia_turno (id_resposta, id_dia_letivo, nota) VALUES ?',
                [preferenciasTurno.map((item: any) => [idResposta, item.idDiaLetivo, item.nota])]
            );

            await conexao.query(
                'INSERT INTO interesse_materia (id_resposta, id_materia, nota_interesse) VALUES ?',
                [interesses.map((item: any) => [idResposta, item.idMateria, item.nota])]
            );

            await conexao.commit();

            return resposta.status(201).json({ message: 'Resposta enviada com sucesso', idResposta });

            } catch (erroTransacao) {
                await conexao.rollback();
                throw erroTransacao;
            } finally {
                conexao.release();
            }

    } catch (error) {
        console.error('Erro ao enviar resposta:', error);
        return resposta.status(500).json({ error: 'Erro ao enviar resposta' });
    }
}

export async function verResposta(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;
    const idFormulario = Number(req.params.idFormulario);

    try {
        // Verifica de qual professor é a resposta
        const [respostas]: any = await pool.query(
          `SELECT r.id_resposta, r.status, r.data_envio, f.nome AS nome_formulario
             FROM resposta_formulario r
             JOIN formulario f ON f.id_formulario = r.id_formulario
            WHERE r.id_formulario = ? AND r.id_professor = ?`,
          [idFormulario, id]
        );

        if (respostas.length === 0) {
          return resposta.status(404).json({ error: 'Você ainda não enviou resposta para este formulário' });
        }

        const dadosResposta = respostas[0];

        const [disponibilidades]: any = await pool.query(
          `SELECT dl.dia_semana, dl.turno, b.ordem AS bloco, s.numero_aula,
                  s.hora_inicio, s.hora_fim, d.disponivel
             FROM disponibilidade_horario d
             JOIN dia_letivo dl ON dl.id_dia_letivo = d.id_dia_letivo
             JOIN slot_aula s   ON s.id_slot = d.id_slot
             JOIN bloco_aula b  ON b.id_bloco = s.id_bloco
            WHERE d.id_resposta = ?
            ORDER BY dl.turno, FIELD(dl.dia_semana, 'SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO'),
                     b.ordem, s.numero_aula`,
          [dadosResposta.id_resposta]
        );

        const [preferencias]: any = await pool.query(
          `SELECT dl.dia_semana, dl.turno, p.nota
             FROM preferencia_turno p
             JOIN dia_letivo dl ON dl.id_dia_letivo = p.id_dia_letivo
            WHERE p.id_resposta = ?
            ORDER BY dl.turno, FIELD(dl.dia_semana, 'SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO')`,
          [dadosResposta.id_resposta]
        );

        const [interesses]: any = await pool.query(
          `SELECT m.nome, i.nota_interesse
             FROM interesse_materia i
             JOIN materia m ON m.id_materia = i.id_materia
            WHERE i.id_resposta = ?
            ORDER BY i.nota_interesse DESC, m.nome`,
          [dadosResposta.id_resposta]
        );

        return resposta.json({
            formulario: dadosResposta.nome_formulario,
            status: dadosResposta.status,
            dataEnvio: dadosResposta.data_envio,
            disponibilidades: disponibilidades.map((item: any) => ({
                diaSemana: item.dia_semana,
                turno: item.turno,
                bloco: item.bloco,
                aula: item.numero_aula,
                inicio: item.hora_inicio,
                fim: item.hora_fim,
                disponivel: item.disponivel === 1,
            })),

            preferenciasTurno: preferencias.map((item: any) => ({
              diaSemana: item.dia_semana,
              turno: item.turno,
              nota: item.nota,
            })),

            interesses: interesses.map((item: any) => ({
              materia: item.nome,
              nota: item.nota_interesse,
            })),
        });

    } catch (error) {
      console.error('Erro ao buscar resposta:', error);
      return resposta.status(500).json({ error: 'Erro ao buscar resposta' });
    }
}