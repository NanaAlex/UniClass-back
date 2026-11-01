import { Router }          from 'express';
import { verificarSessao } from '../middlewares/autenticacao';
import { login, registro, usuarioLogado, logout, alterarSenha } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.post('/register', registro);
router.post('/logout', verificarSessao, logout);

router.get('/eu', verificarSessao, usuarioLogado);
router.put('/senha', verificarSessao, alterarSenha);

export default router;