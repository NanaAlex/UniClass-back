import { Router } from "express";
import { verificarSessao, somenteAdministrador } from "../middlewares/autenticacao";
import { listarBlocos, criarBloco, editarBloco, alterarTamanhoBlocos, excluirBloco } from "../controllers/blocoController";

const router = Router();

// Protecao
router.use(verificarSessao, somenteAdministrador);

// blocos de aulas
router.get('/turnos/:turno/blocos', listarBlocos);

router.post('/turnos/:turno/blocos', criarBloco);

router.put('/turnos/:turno/blocos/tamanho', alterarTamanhoBlocos);
router.put('/blocos/:idBloco', editarBloco);

router.delete('/blocos/:idBloco', excluirBloco);

export default router;
