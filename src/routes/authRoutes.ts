import { Router } from 'express';
import { login, registro, usuarioLogado, logout } from '../controllers/authController';
import { verificarSessao } from '../middlewares/autenticacao';

const router = Router();

router.post('/login', login);
router.post('/register', registro);
router.get('/eu', verificarSessao, usuarioLogado);
router.post('/logout', verificarSessao, logout);

export default router;