// Calculos de horario dos blocos de aulas, sem banco (minutos desde 00:00)

export const MINUTOS_NO_DIA = 24 * 60;

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

export function horaValida(hora: unknown): hora is string {
    return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}

export interface AulaCalculada {
    numero: number;
    inicio: number;
    fim: number;
}

// Horarios das aulas em sequencia, a partir do inicio do bloco
export function calcularAulas(inicio: number, duracaoAula: number, qtdAulas: number): AulaCalculada[] {
    return Array.from({ length: qtdAulas }, (_, i) => ({
        numero: i + 1,
        inicio: inicio + i * duracaoAula,
        fim: inicio + (i + 1) * duracaoAula,
    }));
}
