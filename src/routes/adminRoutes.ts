import { Router } from "express";
import { verificarSessao, somenteAdministrador } from "../middlewares/autenticacao";

import { listarBlocos, criarBloco, editarBloco, alterarTamanhoBlocos, excluirBloco } from "../controllers/blocoController";
import { listarDias, adicionarDia, excluirDia }                                      from "../controllers/diaLetivoController";
import { listarSemestres, criarSemestre, excluirSemestre }                           from "../controllers/semestreController";
import { convidarProfessores }                                                        from "../controllers/conviteController";
import {
  listarProfessores, dadosProfessor, verRespostaProfessor, verHorarioProfessor, listarSolicitacoesProfessor,
  verSolicitacaoFormulario, decidirSolicitacaoFormulario, alterarStatusConta,
} from "../controllers/gestaoProfessorController";
import { adicionarTurma, alterarTurnoTurma, retirarTurma }                          from "../controllers/turmaController";
import { listarMaterias, criarMateria, editarMateria, excluirMateria }              from "../controllers/materiaController";
import { lerDados, salvarDados }                                                     from "../controllers/dadosController";
import { listarFormulariosDoAdmin, lancarFormulario, editarDatasFormulario,
         abrirFormulario, encerrarFormulario, listarProfessoresDoFormulario }                                      from "../controllers/publicacaoController"


const router = Router();

// Protecao
router.use(verificarSessao, somenteAdministrador);

// aba Dados inteira (tela "Dados do curso")
router.get('/dados', lerDados);
router.put('/dados', salvarDados);

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

// semestres
router.get('/semestres', listarSemestres);
router.post('/semestres', criarSemestre);
router.delete('/semestres/:idSemestre', excluirSemestre);

// gestao de professores
router.get('/professores', listarProfessores);
router.get('/professores/:idProfessor', dadosProfessor);
router.get('/professores/:idProfessor/formularios/:idFormulario/resposta', verRespostaProfessor);
router.get('/professores/:idProfessor/horario', verHorarioProfessor);
router.get('/professores/:idProfessor/solicitacoes', listarSolicitacoesProfessor);

router.post('/convites', convidarProfessores);

router.put('/professores/:idProfessor/status', alterarStatusConta);

// solicitacoes de alteracao do formulario
router.get('/solicitacoes/formulario/:idSolicitacao', verSolicitacaoFormulario);
router.put('/solicitacoes/formulario/:idSolicitacao', decidirSolicitacaoFormulario);
// turmas do semestre
router.post('/semestres/:idSemestre/turmas', adicionarTurma);
router.put('/turmas/:idTurma', alterarTurnoTurma);
router.delete('/turmas/:idTurma', retirarTurma);

// disciplinas
router.get('/materias', listarMaterias);
router.post('/materias', criarMateria);
router.put('/materias/:idMateria', editarMateria);
router.delete('/materias/:idMateria', excluirMateria);

// publicacao do formulario
router.get('/formularios', listarFormulariosDoAdmin);
router.post('/formularios', lancarFormulario);
router.put('/formularios/:idFormulario/datas', editarDatasFormulario);
router.post('/formularios/:idFormulario/abrir', abrirFormulario);
router.post('/formularios/:idFormulario/encerrar', encerrarFormulario);
router.get('/formularios/:idFormulario/professores', listarProfessoresDoFormulario);

export default router;
