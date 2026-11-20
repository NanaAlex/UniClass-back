import pool from '../database/connection';

// Consultas e calculos da configuracao do administrador (aba Dados, CU-015 a
// CU-022). Usados pelos controllers de cada assunto (dias, blocos, semestres,
// disciplinas) e pela rota unica da aba (dadosController), no formato que as
// rotas devolvem ao front.

export const MINUTOS_NO_DIA = 24 * 60;

// O escalonador (motor Prolog) usa um tamanho de bloco unico, igual em todos os
// turnos (K); com tamanhos diferentes ele recusa a geracao (K_NAO_GLOBAL)
export const ERRO_TAMANHO_UNICO = 'Todos os turnos devem ter a mesma quantidade de aulas por bloco';

// Quantidades de aulas por bloco usadas pelos turnos do admin, menos o turno informado
export async function tamanhosDosOutrosTurnos(consulta: any, idAdmin: number, turno: string): Promise<number[]> {
    const [rows]: any = await consulta.query(
        'SELECT DISTINCT qtd_aulas FROM bloco_aula WHERE id_admin = ? AND turno <> ?',
        [idAdmin, turno]
    );
    return rows.map((linha: any) => linha.qtd_aulas);
}

// 'HH:MM' ou 'HH:MM:SS' (TIME do MySQL) -> minutos desde 00:00
export function paraMinutos(hora: string): number {
    const [h, m] = hora.split(':').map(Number);
    return h * 60 + m;
}

export function paraHora(minutos: number): string {
    const h = String(Math.floor(minutos / 60)).padStart(2, '0');
    const m = String(minutos % 60).padStart(2, '0');
    return `${h}:${m}`;
}

export function horaValida(hora: any): boolean {
    return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}

export function inteiroPositivo(valor: any): boolean {
    return Number.isInteger(valor) && valor > 0;
}

// Horarios das aulas em sequencia, a partir do inicio do bloco
export function calcularAulas(inicio: number, duracaoAula: number, qtdAulas: number) {
    return Array.from({ length: qtdAulas }, (_, i) => ({
        numero: i + 1,
        inicio: inicio + i * duracaoAula,
        fim: inicio + (i + 1) * duracaoAula,
    }));
}

// Configuracao do turno no formato devolvido ao front
export async function montarBlocosDoTurno(idAdmin: number, turno: string) {
    const [rows]: any = await pool.query(
        `SELECT b.id_bloco, b.ordem, b.qtd_aulas, b.hora_inicio AS bloco_inicio, b.hora_fim AS bloco_fim,
                s.id_slot, s.numero_aula, s.hora_inicio, s.hora_fim,
                (EXISTS (SELECT 1 FROM disponibilidade_horario d WHERE d.id_slot = s.id_slot)
                 OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_slot = s.id_slot)) AS slot_em_uso
           FROM bloco_aula b
           LEFT JOIN slot_aula s ON s.id_bloco = b.id_bloco
          WHERE b.id_admin = ?
            AND b.turno = ?
          ORDER BY b.ordem, s.numero_aula`,
        [idAdmin, turno]
    );

    const blocos: any[] = [];

    for (const linha of rows) {
        let bloco = blocos.find((item) => item.id === linha.id_bloco);

        if (!bloco) {
            bloco = {
                id: linha.id_bloco,
                ordem: linha.ordem,
                qtdAulas: linha.qtd_aulas,
                inicio: linha.bloco_inicio,
                fim: linha.bloco_fim,
                emUso: false,
                aulas: [],
            };
            blocos.push(bloco);
        }

        if (linha.id_slot !== null) {
            bloco.aulas.push({
                id: linha.id_slot,
                aula: linha.numero_aula,
                inicio: linha.hora_inicio,
                fim: linha.hora_fim,
            });
            bloco.emUso = bloco.emUso || linha.slot_em_uso === 1;
        }
    }

    return blocos;
}
