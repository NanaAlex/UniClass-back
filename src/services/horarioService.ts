import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as horarioRepository from '../repositories/horarioRepository';
import { AulaDoProfessor } from '../repositories/horarioRepository';
import { TURNOS } from '../utils/validacoes';

export interface EstruturaDoTurno {
    turno: string;
    dias: string[];
    blocos: { ordem: number; aulas: { posicao: number; inicio: string; fim: string }[] }[];
}

// CU-041, RF 3.16: previa do horario do professor.
// CU-052, RF 3.13: 404 com mensagem quando nao ha previa liberada
export async function verPrevia(idProfessor: number): Promise<AulaDoProfessor[]> {
    const aulas = await horarioRepository.listarAulasDoProfessor(idProfessor, 'PREVIA');

    if (aulas.length === 0) {
      throw new ErroAplicacao(404, 'Nenhuma prévia de horário disponível no momento');
    }
    return aulas;
}

// CU-049, RF 3.12: horario definitivo do professor
export async function verDefinitivo(idProfessor: number): Promise<AulaDoProfessor[]> {
    const aulas = await horarioRepository.listarAulasDoProfessor(idProfessor, 'DEFINITIVO');

    // Nenhuma aula: o horario definitivo ainda nao foi publicado
    if (aulas.length === 0) {
      throw new ErroAplicacao(404, 'O horário definitivo ainda não foi publicado');
    }
    return aulas;
}

/*
   RF 2.3, RF 3.12: dias e blocos de aula de cada turno
   O front precisa dessa estrutura para desenhar a grade do
   horario (colunas = dias, linhas = aulas de cada bloco).
   Vem dos administradores com quem o professor tem vinculo
   ativo (RF 6.3: o professor nao acessa as rotas /admin).

   Se o professor tiver mais de um administrador:
   - dias: junta os dias de todos
   - blocos: usa os do primeiro administrador que tiver blocos
     naquele turno (cada admin pode ter horarios diferentes)
*/
export async function listarEstruturas(idProfessor: number): Promise<EstruturaDoTurno[]> {
    const dias = await horarioRepository.listarDiasDosAdminsDoProfessor(idProfessor);
    const aulas = await horarioRepository.listarAulasDosBlocosDosAdmins(idProfessor);

    const estruturas: EstruturaDoTurno[] = [];

    for (const turno of TURNOS) {
      const diasDoTurno = dias.filter((d) => d.turno === turno).map((d) => d.diaSemana);

      const primeiroAdmin = aulas.find((a) => a.turno === turno)?.idAdmin;
      const aulasDoTurno  = aulas.filter((a) => a.turno === turno && a.idAdmin === primeiroAdmin);

      if (diasDoTurno.length === 0 || aulasDoTurno.length === 0) continue;

      // Agrupa as aulas por bloco; a posicao conta o turno inteiro
      const blocos: EstruturaDoTurno['blocos'] = [];
      let posicao = 0;
      for (const aula of aulasDoTurno) {
        let bloco = blocos.find((b) => b.ordem === aula.ordem);
        if (!bloco) {
          bloco = { ordem: aula.ordem, aulas: [] };
          blocos.push(bloco);
        }
        posicao += 1;
        bloco.aulas.push({ posicao, inicio: aula.inicio, fim: aula.fim });
      }

      estruturas.push({ turno, dias: diasDoTurno, blocos });
    }

    return estruturas;
}
