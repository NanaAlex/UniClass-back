import { Request, Response } from 'express';
import bcrypt                from 'bcryptjs';
import crypto                from 'crypto';
import pool                  from '../database/connection';
import { senhaValida }       from '../utils/validacoes';
import { buscarConvitePendente, MENSAGEM_CONVITE_INVALIDO } from './conviteController';

// CU-006: a conta de professor so e criada a partir de um convite de CRIACAO_CONTA
export async function registro(req: Request, resposta: Response) {
  const { token, nome, senha, confirmacaoSenha, cargaHorariaSemanal, titulacao } = req.body;

  if (!token || !nome || !senha || !confirmacaoSenha || cargaHorariaSemanal === undefined) {
    return resposta.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
  }

  if (typeof nome !== 'string' || nome.trim() === '' || nome.trim().length > 255) {
    return resposta.status(400).json({ error: 'Informe um nome com até 255 caracteres' });
  }

  if (senha !== confirmacaoSenha) {
    return resposta.status(400).json({ error: 'A confirmação não corresponde à senha' });
  }

  if (!senhaValida(senha)) {
    return resposta.status(400).json({
      error: 'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e caractere especial',
    });
  }

  // RN-32: limite legal de 44 horas semanais
  const carga = Number(cargaHorariaSemanal);
  if (!(carga > 0 && carga <= 44)) {
    return resposta.status(400).json({ error: 'A carga horária semanal deve ser maior que 0 e de no máximo 44 horas' });
  }

  if (titulacao !== undefined && titulacao !== null && (typeof titulacao !== 'string' || titulacao.length > 255)) {
    return resposta.status(400).json({ error: 'A titulação deve ter no máximo 255 caracteres' });
  }

  try {
    const convite = await buscarConvitePendente(String(token));

    if (!convite || convite.tipo_convite !== 'CRIACAO_CONTA') {
      return resposta.status(404).json({ error: MENSAGEM_CONVITE_INVALIDO });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const conexao   = await pool.getConnection();

    try {
      await conexao.beginTransaction();

      // Marca o convite primeiro: link de uso unico (RNF 8)
      const [usoConvite]: any = await conexao.query(
        `UPDATE convite_professor
            SET status = 'ACEITO', data_aceite = NOW()
          WHERE id_convite = ? AND status = 'PENDENTE'`,
        [convite.id_convite]
      );

      if (usoConvite.affectedRows === 0) {
        await conexao.rollback();
        return resposta.status(404).json({ error: MENSAGEM_CONVITE_INVALIDO });
      }

      const [novoUsuario]: any = await conexao.query(
        `INSERT INTO usuario (nome, email, senha_hash, tipo_usuario, ativo, data_criacao)
         VALUES (?, ?, ?, 'PROFESSOR', TRUE, NOW())`,
        [nome.trim(), convite.email_destino, senhaHash]
      );
      const idProfessor = novoUsuario.insertId;

      await conexao.query(
        'INSERT INTO professor (id_usuario, carga_horaria_semanal, titulacao) VALUES (?, ?, ?)',
        [idProfessor, carga, titulacao ? titulacao.trim() : null]
      );

      await conexao.query(
        `INSERT INTO vinculo_professor_admin (id_admin, id_professor, ativo, data_vinculo)
         VALUES (?, ?, TRUE, NOW())`,
        [convite.id_admin, idProfessor]
      );

      await conexao.query(
        'UPDATE convite_professor SET id_professor = ? WHERE id_convite = ?',
        [idProfessor, convite.id_convite]
      );

      await conexao.commit();
    } catch (error) {
      await conexao.rollback();
      throw error;
    } finally {
      conexao.release();
    }

    return resposta.status(201).json({ message: 'Conta criada com sucesso' });

  } catch (error: any) {
    // CU-006 A3: o e-mail ganhou conta depois do convite
    if (error.code === 'ER_DUP_ENTRY') {
      return resposta.status(409).json({
        error: 'Já existe uma conta com este e-mail. Peça ao administrador um convite de vínculo',
      });
    }
    console.error('Erro ao cadastrar professor:', error);
    return resposta.status(500).json({ error: 'Erro ao cadastrar professor' });
  }
}

export async function login(req: Request, resposta: Response) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return resposta.status(400).json({ error: 'Preencha email e senha' });
  }

  try {
    const [rows]: any = await pool.query(
      'SELECT * FROM usuario WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return resposta.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const usuario = rows[0];
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);

    if (!senhaCorreta) {
      return resposta.status(401).json({ error: 'Email ou senha inválidos' });
    }

    if (!usuario.ativo) {
      return resposta.status(403).json({ error: 'Conta desativada'});
    }

    // Cria sessão
    const token     = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await pool.query(
      `INSERT INTO sessao (id_usuario, token_hash, criado_em, ultimo_acesso, expira_em)
       VALUES (?, ?, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [usuario.id_usuario, tokenHash]
    );

    return resposta.json({
      message: 'Login realizado com sucesso',
      token,
      usuario: {
        id: usuario.id_usuario,
        nome: usuario.nome,
        email: usuario.email,
        tipoUsuario: usuario.tipo_usuario,
      },
    });

  } catch (error) {
    console.error('Erro no login:', error);
    return resposta.status(500).json({ error: 'Erro ao fazer login' });
  }
}

export async function usuarioLogado(req: Request, resposta: Response) {
  const { id } = resposta.locals.usuario;

  try {
    const [rows]: any = await pool.query(
      'SELECT id_usuario, nome, email, tipo_usuario FROM usuario WHERE id_usuario = ?',
      [id]
    );

    const usuario = rows[0];

    return resposta.json({
      usuario: {
        id: usuario.id_usuario,
        nome: usuario.nome,
        email: usuario.email,
        tipoUsuario: usuario.tipo_usuario,
      },
    });

  } catch (error) {
    console.error('Erro ao buscar usuário logado:', error);
    return resposta.status(500).json({ error: 'Erro ao buscar usuário' });
  }
}

export async function logout(req: Request, resposta: Response) {
  const { idSessao } = resposta.locals.usuario;

  try {
    await pool.query(
      `UPDATE sessao
          SET encerrada_em = NOW(),
              motivo_encerramento = 'LOGOUT'
        WHERE id_sessao = ?`,
      [idSessao]
    );

    return resposta.json({ message: 'Sessão encerrada com sucesso' });
  } catch (error) {
    console.error('Erro no logout:', error);
    return resposta.status(500).json({ error: 'Erro ao encerrar sessão' });
  }
}

export async function alterarSenha(req: Request, resposta: Response) {
  const { id, idSessao } = resposta.locals.usuario;
  const { senhaAtual, novaSenha, confirmacaoSenha } = req.body;

  if (!senhaAtual || !novaSenha || !confirmacaoSenha) {
    return resposta.status(400).json({ error: 'Preencha todos os campos' });
  }

  if (novaSenha !== confirmacaoSenha) {
    return resposta.status(400).json({ error: 'A confirmação não corresponde à nova senha' });
  }

  if (!senhaValida(novaSenha)) {
    return resposta.status(400).json({
      error: 'A nova senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e caractere especial',
    });
  }

  try {
    const [rows]: any = await pool.query(
      'SELECT senha_hash FROM usuario WHERE id_usuario = ?',
      [id]
    );

    const senhaAtualCorreta = await bcrypt.compare(senhaAtual, rows[0].senha_hash);

    if (!senhaAtualCorreta) {
      return resposta.status(401).json({ error: 'Senha atual incorreta' });
    }

    // salva nova senha
    const novoHash = await bcrypt.hash(novaSenha, 10);

    await pool.query(
      'UPDATE usuario SET senha_hash = ? WHERE id_usuario = ?',
      [novoHash, id]
    );

    // Encerra outras sessões
    await pool.query(
      `UPDATE sessao
          SET encerrada_em = NOW(),
              motivo_encerramento = 'SENHA_ALTERADA'
        WHERE id_usuario = ?
          AND id_sessao <> ?
          AND encerrada_em IS NULL`,
      [id, idSessao]
    );

    return resposta.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    return resposta.status(500).json({ error: 'Erro ao alterar senha' });
  }
}