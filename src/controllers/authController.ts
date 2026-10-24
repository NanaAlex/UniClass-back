import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../database/connection';

export async function registro(req: Request, resposta: Response) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return resposta.status(400).json({ error: 'Preencha email e senha' });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);

    await pool.query(
      'INSERT INTO professores (email, senha) VALUES (?, ?)',
      [email, senhaHash]
    );

    return resposta.status(201).json({ message: 'Professor cadastrado com sucesso' });
    
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return resposta.status(409).json({ error: 'Email já existe' });
    }
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
      'SELECT * FROM professores WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return resposta.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const professor = rows[0];
    const senhaCorreta = await bcrypt.compare(senha, professor.senha);

    if (!senhaCorreta) {
      return resposta.status(401).json({ error: 'Email ou senha inválidos' });
    }

    return resposta.json({
      message: 'Login realizado com sucesso',
      aluno: { id: professor.id, email: professor.email },
    });
  } catch (error) {
    return resposta.status(500).json({ error: 'Erro ao fazer login' });
  }
}