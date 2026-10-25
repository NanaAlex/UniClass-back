import { Router } from "express";
import { verificarSessao, somenteProfessor } from "../middlewares/autenticacao";
import { solicitarAlteracaoFormulario } from "../controllers/solicitacaoController";
import { listarFormularios, dadosDoFormulario, enviarResposta, verResposta} from "../controllers/formularioController";

const router = Router();

// Protecao
router.use(verificarSessao, somenteProfessor);

//forms
router.get('/formularios', listarFormularios);
router.get('/formularios/:idFormulario', dadosDoFormulario);
router.get('/formularios/:idFormulario/resposta', verResposta);

router.post('/formularios/:idFormulario/resposta', enviarResposta);
router.post('/formularios/:idFormulario/solicitacoes', solicitarAlteracaoFormulario);

export default router;