import { Router } from "express";
import { verificarSessao, somenteProfessor } from "../middlewares/autenticacao";
import { solicitarAlteracaoFormulario, listarSolicitacoesFormulario, solicitarAlteracaoHorario, listarSolicitacoesHorario }      from "../controllers/solicitacaoController";
import { listarFormularios, formularioAtual, dadosDoFormulario, enviarResposta, verResposta} from "../controllers/formularioController";
import { verPreviaHorario, verHorarioDefinitivo, listarEstruturasDoProfessor } from "../controllers/horarioController";
import { verPerfil, atualizarTelefone, receberFoto, atualizarFoto, removerFoto, verFoto } from "../controllers/perfilController";

const router = Router();

// Protecao
router.use(verificarSessao, somenteProfessor);

router.param('idFormulario', (req, resposta, proximo, valor) => {
  const idFormulario = Number(valor);
  if (!Number.isInteger(idFormulario) || idFormulario <= 0) {
    return resposta.status(404).json({ error: 'Formulário indisponível' });
  }
  proximo();
});

// Forms
router.get('/formularios', listarFormularios);
router.get('/formularios/atual', formularioAtual); // antes do /:idFormulario, senão "atual" vira um id
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

// Perfil (telefone e foto)
router.get('/perfil', verPerfil);
router.put('/perfil', atualizarTelefone);
router.get('/perfil/foto', verFoto);
router.put('/perfil/foto', receberFoto, atualizarFoto);
router.delete('/perfil/foto', removerFoto);

export default router;