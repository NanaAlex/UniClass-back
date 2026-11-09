import express        from 'express';
import cors           from 'cors';
import dotenv         from 'dotenv';
import rotasAuto      from './routes/authRoutes';
import rotasProfessor from './routes/professorRoutes';
import rotasAdmin     from './routes/adminRoutes';
import { iniciarAgendaFormularios } from './utils/agendaFormulario';
import { validarAmbiente } from './config/ambiente';
import { saude } from './controllers/saudeController';
import { encerrarExecucoesOrfas } from './motor/repositorio';
import pool from './database/connection';

dotenv.config();

// RN-72, CA-200: parâmetros inválidos impedem a subida em produção
const problemasAmbiente = validarAmbiente();
if (problemasAmbiente.length > 0) {
  problemasAmbiente.forEach((p) => console.error(`Configuração inválida (${p.variavel}): ${p.mensagem}`));
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

const aplicacao = express();
const PORTA = process.env.PORT || 3333;

aplicacao.use(cors());
aplicacao.use(express.json());

// -- Rotas
aplicacao.get('/', (req, resp) => {
  resp.json({ message: 'API está rodando' });
});

// Saúde real das dependências críticas (RN-72, CA-199)
aplicacao.get('/api/saude', saude);

aplicacao.use('/auth', rotasAuto);
aplicacao.use('/professor', rotasProfessor);
aplicacao.use('/admin', rotasAdmin);

aplicacao.listen(PORTA, () => {
  console.log(`Server esta rodando em http://localhost:${PORTA}`);
  iniciarAgendaFormularios();
  // Gerações interrompidas por reinício viram falha técnica (RN-66)
  encerrarExecucoesOrfas(pool).catch((error) =>
    console.error('Não foi possível encerrar gerações interrompidas:', error instanceof Error ? error.message : error));
});