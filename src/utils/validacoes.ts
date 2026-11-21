// Validacao de Senha
const regrasSenha = [/.{8,}/, /[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];

export const senhaValida = (senha: string): boolean =>
  regrasSenha.every((regra) => regra.test(senha));

// Validacao de E-mail (formato basico: algo@dominio.ext)
export const emailValido = (email: string): boolean =>
  email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Turnos aceitos em dia_letivo, bloco_aula e materia
// Turnos aceitos pela API (dias letivos, blocos e turmas), os mesmos do ENUM do banco
export const TURNOS = ['MANHA', 'TARDE', 'NOITE'];

// Dias aceitos em dia_letivo; domingo fica de fora: nao ha aula aos domingos
export const DIAS_SEMANA = ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

// Turno recebido do front em maiusculas, ou null se invalido
export function lerTurno(valor: unknown): string | null {
  const turno = typeof valor === 'string' ? valor.toUpperCase() : null;
  return turno && TURNOS.includes(turno) ? turno : null;
}

export function inteiroPositivo(valor: unknown): valor is number {
  return Number.isInteger(valor) && (valor as number) > 0;
}

// Quantidades da tela (aulas por semana, professores, aulas por bloco): 1 a 99
export function quantidadeValida(valor: unknown): valor is number {
  return Number.isInteger(valor) && (valor as number) >= 1 && (valor as number) <= 99;
}
