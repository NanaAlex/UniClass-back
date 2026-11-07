import { Router }          from 'express';
import { verificarSessao } from '../middlewares/autenticacao';
import { login, registro, usuarioLogado, logout, alterarSenha } from '../controllers/authController';
import { verConvite, aceitarVinculo } from '../controllers/conviteController';

const router = Router();

router.post('/login', login);
router.post('/register', registro);

// convites (link enviado por e-mail)
router.get('/convites/:token', verConvite);
router.post('/convites/:token/aceitar', aceitarVinculo);
router.post('/logout', verificarSessao, logout);

router.get('/eu', verificarSessao, usuarioLogado);
router.put('/senha', verificarSessao, alterarSenha);

export default router;