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

// Dias do turno, em ordem da semana, indicando se ja sao usados
export async function montarDiasDoTurno(idAdmin: number, turno: string) {
    const [rows]: any = await pool.query(
        `SELECT d.id_dia_letivo, d.dia_semana,
                (EXISTS (SELECT 1 FROM disponibilidade_horario x WHERE x.id_dia_letivo = d.id_dia_letivo)
                 OR EXISTS (SELECT 1 FROM preferencia_turno x WHERE x.id_dia_letivo = d.id_dia_letivo)
                 OR EXISTS (SELECT 1 FROM aula_alocada x WHERE x.id_dia_letivo = d.id_dia_letivo)) AS em_uso
           FROM dia_letivo d
          WHERE d.id_admin = ?
            AND d.turno = ?
          ORDER BY FIELD(d.dia_semana, 'SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO')`,
        [idAdmin, turno]
    );

    return rows.map((linha: any) => ({
        id: linha.id_dia_letivo,
        diaSemana: linha.dia_semana,
        emUso: linha.em_uso === 1,
    }));
}

// Semestres do admin em ordem de criacao (numero = posicao)
export async function montarSemestres(idAdmin: number) {
    const [rows]: any = await pool.query(
        `SELECT s.id_semestre, s.nome, s.periodo_letivo,
                (EXISTS (SELECT 1 FROM materia m WHERE m.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM formulario f WHERE f.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM geracao_horario g WHERE g.id_semestre = s.id_semestre)
                 OR EXISTS (SELECT 1 FROM turma t
                             WHERE t.id_semestre = s.id_semestre
                               AND (EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                                    OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma)))) AS em_uso
           FROM semestre s
          WHERE s.id_admin = ?
          ORDER BY s.id_semestre`,
        [idAdmin]
    );

    // CU-019: turmas de todos os semestres numa consulta so, agrupadas abaixo
    const [turmas]: any = await pool.query(
        `SELECT t.id_turma, t.id_semestre, t.nome, t.turno,
                (EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_turma = t.id_turma)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_turma = t.id_turma)) AS em_uso
           FROM turma t
           JOIN semestre s ON s.id_semestre = t.id_semestre
          WHERE s.id_admin = ?
          ORDER BY t.nome`,
        [idAdmin]
    );

    return rows.map((linha: any, i: number) => ({
        id: linha.id_semestre,
        numero: i + 1,
        nome: linha.nome,
        periodoLetivo: linha.periodo_letivo,
        emUso: linha.em_uso === 1,
        turmas: turmas
            .filter((turma: any) => turma.id_semestre === linha.id_semestre)
            .map((turma: any) => ({
                id: turma.id_turma,
                nome: turma.nome,
                turno: turma.turno,
                emUso: turma.em_uso === 1,
            })),
    }));
}

// Disciplina em uso: interesse em resposta do formulario, aula alocada ou pendencia de geracao
export const MATERIA_EM_USO = `(EXISTS (SELECT 1 FROM interesse_materia i WHERE i.id_materia = m.id_materia)
                 OR EXISTS (SELECT 1 FROM aula_alocada a WHERE a.id_materia = m.id_materia)
                 OR EXISTS (SELECT 1 FROM pendencia_geracao p WHERE p.id_materia = m.id_materia))`;

// Disciplinas do admin, na ordem dos semestres e por nome; filtro opcional por semestres
export async function montarMaterias(idAdmin: number, semestres: number[] | null = null) {
    const [rows]: any = await pool.query(
        `SELECT m.id_materia, m.nome, m.qtd_aulas_semana, m.qtd_professores,
                s.id_semestre, s.numero, s.nome AS nome_semestre,
                ${MATERIA_EM_USO} AS em_uso
           FROM materia m
           JOIN (SELECT id_semestre, nome, ROW_NUMBER() OVER (ORDER BY id_semestre) AS numero
                   FROM semestre
                  WHERE id_admin = ?) s ON s.id_semestre = m.id_semestre
          WHERE m.ativo = TRUE
            ${semestres ? 'AND m.id_semestre IN (?)' : ''}
          ORDER BY s.numero, m.nome`,
        semestres ? [idAdmin, semestres] : [idAdmin]
    );

    return rows.map((linha: any) => ({
        id: linha.id_materia,
        nome: linha.nome,
        qtdAulasSemana: linha.qtd_aulas_semana,
        qtdProfessores: linha.qtd_professores,
        semestre: {
            id: linha.id_semestre,
            numero: Number(linha.numero),
            nome: linha.nome_semestre,
        },
        emUso: linha.em_uso === 1,
    }));
}
