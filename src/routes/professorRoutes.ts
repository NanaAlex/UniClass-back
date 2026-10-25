import { Router } from "express";
import { listarFormularios }                 from "../controllers/formularioController";
import { verificarSessao, somenteProfessor } from "../middlewares/autenticacao";

const router = Router();

// Protecao
router.use(verificarSessao, somenteProfessor);

//forms
router.get('/formularios', listarFormularios);

export default router;