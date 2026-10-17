import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../database/connection';

export async function register(req: Request, res: Response) {
  const { nome, login, senha } = req.body;

  if (!nome || !login || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);

    await pool.query(
      'INSERT INTO alunos (nome, login, senha) VALUES (?, ?, ?)',
      [nome, login, senhaHash]
    );

    return res.status(201).json({ message: 'Usuário criado com sucesso' });
    
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Login já existe' });
    }
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
}

export async function login(req: Request, res: Response) {
  const { login, senha } = req.body;

  if (!login || !senha) {
    return res.status(400).json({ error: 'Preencha usuário e senha' });
  }

  try {
    const [rows]: any = await pool.query(
      'SELECT * FROM alunos WHERE login = ?',
      [login]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const aluno = rows[0];
    const senhaCorreta = await bcrypt.compare(senha, aluno.senha);

    if (!senhaCorreta) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    return res.json({
      message: 'Login realizado com sucesso',
      aluno: { id: aluno.id, nome: aluno.nome, login: aluno.login },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao fazer login' });
  }
}