import { Router } from "express";
import { verificarSessao, somenteAdministrador } from "../middlewares/autenticacao";
import { listarBlocos, criarBloco, editarBloco, alterarTamanhoBlocos, excluirBloco } from "../controllers/blocoController";
import { listarDias, adicionarDia, excluirDia }                                      from "../controllers/diaLetivoController";
const router = Router();

// Protecao
router.use(verificarSessao, somenteAdministrador);

// dias letivos
router.get('/turnos/:turno/dias', listarDias);
router.post('/turnos/:turno/dias', adicionarDia);
router.delete('/dias/:idDiaLetivo', excluirDia);

// blocos de aulas
router.get('/turnos/:turno/blocos', listarBlocos);

router.post('/turnos/:turno/blocos', criarBloco);

router.put('/turnos/:turno/blocos/tamanho', alterarTamanhoBlocos);
router.put('/blocos/:idBloco', editarBloco);

router.delete('/blocos/:idBloco', excluirBloco);

export default router;
