import express    from 'express';
import cors       from 'cors';
import dotenv     from 'dotenv';
import rotasAuto from './routes/authRoutes';

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

aplicacao.listen(PORTA, () => {
  console.log(`Server esta rodando em http://localhost:${PORTA}`);
});