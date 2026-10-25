import { Request, Response } from "express";
import pool from "../database/connection";

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