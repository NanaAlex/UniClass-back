import { Request, Response } from 'express';
import { responderErro } from '../erros/responderErro';
import * as horarioService from '../services/horarioService';

// O gestaoProfessorController (ainda nao migrado) importa a consulta daqui.
// Quando ele for migrado, passa a usar o horarioRepository e esta linha sai.
export { listarAulasDoProfessor as buscarAulasDoProfessor } from '../repositories/horarioRepository';

// CU-041, CU-052
export async function verPreviaHorario(req: Request, resposta: Response) {
  const { id } = resposta.locals.usuario;

  try {
    return resposta.json({ aulas: await horarioService.verPrevia(id) });
  } catch (erro) {
    return responderErro(resposta, erro, 'Erro ao buscar prévia do horário:', 'Erro ao buscar prévia do horário');
  }
}

// CU-049
export async function verHorarioDefinitivo(req: Request, resposta: Response) {
  const { id } = resposta.locals.usuario;

  try {
    return resposta.json({ aulas: await horarioService.verDefinitivo(id) });
  } catch (erro) {
    return responderErro(resposta, erro, 'Erro ao buscar horário definitivo:', 'Erro ao buscar horário definitivo');
  }
}

// RF 2.3, RF 3.12: dias e blocos de cada turno para desenhar a grade
export async function listarEstruturasDoProfessor(req: Request, resposta: Response) {
  const { id } = resposta.locals.usuario;

  try {
    return resposta.json({ estruturas: await horarioService.listarEstruturas(id) });
  } catch (erro) {
    return responderErro(resposta, erro, 'Erro ao buscar a estrutura dos turnos:', 'Erro ao buscar a estrutura dos turnos');
  }
}
