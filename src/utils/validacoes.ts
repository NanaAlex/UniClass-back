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