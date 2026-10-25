import { Router } from "express";
import { listarFormularios, dadosDoFormulario} from "../controllers/formularioController";
import { verificarSessao, somenteProfessor }   from "../middlewares/autenticacao";

const router = Router();

// Protecao
router.use(verificarSessao, somenteProfessor);

//forms
router.get('/formularios', listarFormularios);
router.get('/formularios/:idFormulario', dadosDoFormulario);

export default router;