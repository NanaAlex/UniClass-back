import { Request, Response, NextFunction } from 'express';
import multer                              from 'multer';
import pool                                from '../database/connection';

/*
   Perfil do professor (task 20): telefone e foto, informados pelo proprio professor.
   A foto fica no banco (professor.foto, MEDIUMBLOB) e nunca vai no JSON:
   o JSON traz so a versao (MD5), e a imagem tem rota propria.
*/

export const TAMANHO_MAXIMO_FOTO = 2 * 1024 * 1024; // 2 MB, o mesmo CHECK do banco

// Em memoria: a imagem vai direto para o banco; com o limite, no maximo 2 MB por requisicao
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANHO_MAXIMO_FOTO, files: 1, fields: 0 },
});

const ERROS_UPLOAD: Record<string, string> = {
    LIMIT_FILE_SIZE:       'A foto deve ter até 2 MB',
    LIMIT_FILE_COUNT:      'Envie uma única foto',
    LIMIT_UNEXPECTED_FILE: 'Envie a foto no campo "foto"',
    LIMIT_FIELD_COUNT:     'Envie apenas a foto, sem outros campos',
};

// Middleware da rota de envio: roda o multer e responde os erros dele no formato { error }
export function receberFoto(req: Request, resposta: Response, proximo: NextFunction) {
    upload.single('foto')(req, resposta, (erro: any) => {
        if (!erro) {
            return proximo();
        }
        if (erro instanceof multer.MulterError) {
            return resposta.status(400).json({ error: ERROS_UPLOAD[erro.code] ?? 'Envio da foto inválido' });
        }
        // corpo multipart mal formado (ex.: boundary errado ou corpo cortado)
        return resposta.status(400).json({ error: 'Envio da foto inválido' });
    });
}

/*
   Formato pela assinatura dos primeiros bytes, nao pelo tipo informado pelo navegador
   (que pode mentir): JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP "RIFF" ???? "WEBP"
*/
function tipoDaImagem(arquivo: Buffer): string | null {
    if (arquivo.length >= 3 && arquivo[0] === 0xff && arquivo[1] === 0xd8 && arquivo[2] === 0xff) {
        return 'image/jpeg';
    }
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (arquivo.length >= 8 && PNG.every((byte, i) => arquivo[i] === byte)) {
        return 'image/png';
    }
    if (arquivo.length >= 12
        && arquivo.toString('ascii', 0, 4) === 'RIFF'
        && arquivo.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

// Devolve a imagem gravada; a URL do front leva ?v=<fotoVersao>, entao a versao nova tem outra URL
export function enviarImagem(resposta: Response, foto: Buffer, fotoTipo: string) {
    resposta.set({
        'Content-Type': fotoTipo,
        'Content-Length': String(foto.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
    });
    return resposta.end(foto);
}

async function buscarPerfil(idProfessor: number) {
    // Dados do professor e coordenacoes com vinculo ativo: consultas independentes, vao juntas ao banco
    const [[rows], [vinculos]]: any = await Promise.all([
        pool.query(
            `SELECT u.id_usuario, u.nome, u.email, p.telefone,
                    IF(p.foto IS NULL, NULL, MD5(p.foto)) AS foto_versao
               FROM usuario u
               JOIN professor p ON p.id_usuario = u.id_usuario
              WHERE u.id_usuario = ?`,
            [idProfessor]
        ),
        pool.query(
            `SELECT a.id_usuario AS id_admin, a.nome,
                    DATE_FORMAT(v.data_vinculo, '%Y-%m-%dT%H:%i:%s') AS data_vinculo
               FROM vinculo_professor_admin v
               JOIN usuario a ON a.id_usuario = v.id_admin
              WHERE v.id_professor = ?
                AND v.ativo = TRUE
              ORDER BY v.data_vinculo`,
            [idProfessor]
        ),
    ]);

    if (rows.length === 0) {
        return null;
    }

    const linha = rows[0];
    return {
        id: linha.id_usuario,
        nome: linha.nome,
        email: linha.email,
        telefone: linha.telefone,
        fotoVersao: linha.foto_versao,
        coordenacoes: vinculos.map((vinculo: any) => ({
            idAdmin: vinculo.id_admin,
            nome: vinculo.nome,
            dataVinculo: vinculo.data_vinculo,
        })),
    };
}

// null = apagar; senao, so os digitos (10 a 20, o mesmo CHECK do banco)
function validarCorpoTelefone(corpo: any): { erro: string | null; telefone: string | null } {
    if (!corpo || typeof corpo !== 'object' || !('telefone' in corpo)) {
        return { erro: 'Informe o telefone (ou null para apagar)', telefone: null };
    }

    const { telefone } = corpo;
    if (telefone === null || telefone === '') {
        return { erro: null, telefone: null };
    }
    if (typeof telefone !== 'string') {
        return { erro: 'Telefone deve ser um texto', telefone: null };
    }

    const digitos = telefone.replace(/[\s().+-]/g, '');
    if (digitos === '') {
        return { erro: null, telefone: null };
    }
    if (!/^[0-9]{10,20}$/.test(digitos)) {
        return { erro: 'Telefone inválido: informe DDD e número (de 10 a 20 dígitos)', telefone: null };
    }

    return { erro: null, telefone: digitos };
}

export async function verPerfil(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const perfil = await buscarPerfil(id);
        if (!perfil) {
            return resposta.status(404).json({ error: 'Perfil não encontrado' });
        }
        return resposta.json({ perfil });

    } catch (error) {
        console.error('Erro ao buscar o perfil:', error);
        return resposta.status(500).json({ error: 'Erro interno ao buscar o perfil' });
    }
}

export async function atualizarTelefone(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    const { erro, telefone } = validarCorpoTelefone(req.body);
    if (erro) {
        return resposta.status(400).json({ error: erro });
    }

    try {
        await pool.query('UPDATE professor SET telefone = ? WHERE id_usuario = ?', [telefone, id]);

        return resposta.json({
            message: telefone ? 'Telefone atualizado' : 'Telefone removido',
            perfil: await buscarPerfil(id),
        });

    } catch (error) {
        console.error('Erro ao atualizar o telefone:', error);
        return resposta.status(500).json({ error: 'Erro interno ao atualizar o telefone' });
    }
}

// Depois de receberFoto: o arquivo esta em req.file (memoria)
export async function atualizarFoto(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    if (!req.file) {
        return resposta.status(400).json({ error: 'Envie a foto no campo "foto" (multipart/form-data)' });
    }

    const fotoTipo = tipoDaImagem(req.file.buffer);
    if (!fotoTipo) {
        return resposta.status(400).json({ error: 'A foto deve ser uma imagem JPG, PNG ou WebP' });
    }

    try {
        await pool.query(
            'UPDATE professor SET foto = ?, foto_tipo = ? WHERE id_usuario = ?',
            [req.file.buffer, fotoTipo, id]
        );

        return resposta.json({ message: 'Foto atualizada', perfil: await buscarPerfil(id) });

    } catch (error) {
        console.error('Erro ao atualizar a foto:', error);
        return resposta.status(500).json({ error: 'Erro interno ao atualizar a foto' });
    }
}

export async function removerFoto(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const [resultado]: any = await pool.query(
            `UPDATE professor SET foto = NULL, foto_tipo = NULL
              WHERE id_usuario = ? AND foto IS NOT NULL`,
            [id]
        );

        if (resultado.affectedRows === 0) {
            return resposta.status(404).json({ error: 'Você não tem foto cadastrada' });
        }

        return resposta.json({ message: 'Foto removida', perfil: await buscarPerfil(id) });

    } catch (error) {
        console.error('Erro ao remover a foto:', error);
        return resposta.status(500).json({ error: 'Erro interno ao remover a foto' });
    }
}

export async function verFoto(req: Request, resposta: Response) {
    const { id } = resposta.locals.usuario;

    try {
        const [rows]: any = await pool.query(
            'SELECT foto, foto_tipo FROM professor WHERE id_usuario = ? AND foto IS NOT NULL',
            [id]
        );

        if (rows.length === 0) {
            return resposta.status(404).json({ error: 'Foto não encontrada' });
        }

        return enviarImagem(resposta, rows[0].foto, rows[0].foto_tipo);

    } catch (error) {
        console.error('Erro ao buscar a foto:', error);
        return resposta.status(500).json({ error: 'Erro interno ao buscar a foto' });
    }
}
