import { Router } from "express";
import { verificarSessao, somenteProfessor } from "../middlewares/autenticacao";
import { solicitarAlteracaoFormulario, listarSolicitacoesFormulario, solicitarAlteracaoHorario, listarSolicitacoesHorario }      from "../controllers/solicitacaoController";
import { listarFormularios, dadosDoFormulario, enviarResposta, verResposta} from "../controllers/formularioController";
import { verPreviaHorario, verHorarioDefinitivo, listarEstruturasDoProfessor } from "../controllers/horarioController";

const router = Router();

// Protecao
router.use(verificarSessao, somenteProfessor);

// Forms
router.get('/formularios', listarFormularios);
router.get('/formularios/:idFormulario', dadosDoFormulario);
router.get('/formularios/:idFormulario/resposta', verResposta);
router.get('/solicitacoes', listarSolicitacoesFormulario);
router.get('/horario/previa', verPreviaHorario);
router.get('/horario/definitivo', verHorarioDefinitivo);
router.get('/horario/solicitacoes', listarSolicitacoesHorario);
router.get('/horario/estruturas', listarEstruturasDoProfessor);

router.post('/formularios/:idFormulario/resposta', enviarResposta);
router.post('/formularios/:idFormulario/solicitacoes', solicitarAlteracaoFormulario);
router.post('/horario/solicitacoes', solicitarAlteracaoHorario);

export default router;