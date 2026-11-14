import express, { Request, Response, NextFunction } from 'express';
import cors           from 'cors';
import dotenv         from 'dotenv';
import rotasAuto      from './routes/authRoutes';
import rotasProfessor from './routes/professorRoutes';
import rotasAdmin     from './routes/adminRoutes';
import { iniciarAgendaFormularios } from './utils/agendaFormulario';

dotenv.config();

const aplicacao = express();
const PORTA = process.env.PORT || 3333;

aplicacao.use(cors());
aplicacao.use(express.json());

// -- Rotas
aplicacao.get('/', (req, resp) => {
  resp.json({ message: 'API está rodando' });
});

aplicacao.use('/auth', rotasAuto);
aplicacao.use('/professor', rotasProfessor);
aplicacao.use('/admin', rotasAdmin);

// Rota inexistente: responde em JSON, no mesmo formato dos outros erros
aplicacao.use((req: Request, resposta: Response) => {
  resposta.status(404).json({ error: 'Rota não encontrada' });
});

// Erros não tratados (inclusive JSON mal formado no corpo): sem stack trace na resposta
aplicacao.use((erro: any, req: Request, resposta: Response, proximo: NextFunction) => {
  if (erro?.type === 'entity.parse.failed') {
    return resposta.status(400).json({ error: 'Corpo da requisição inválido: envie um JSON válido' });
  }
  if (erro?.type === 'entity.too.large') {
    return resposta.status(413).json({ error: 'Corpo da requisição muito grande' });
  }
  console.error('Erro não tratado:', erro);
  return resposta.status(500).json({ error: 'Erro interno do servidor' });
});


aplicacao.listen(PORTA, () => {
  console.log(`Server esta rodando em http://localhost:${PORTA}`);
  iniciarAgendaFormularios();
});