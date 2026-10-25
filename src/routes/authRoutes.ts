import { Router } from 'express';
import { login, registro, usuarioLogado } from '../controllers/authController';
import { verificarSessao } from '../middlewares/autenticacao';

const router = Router();

router.post('/login', login);
router.post('/register', registro);
router.get('/eu', verificarSessao, usuarioLogado);

export default router;