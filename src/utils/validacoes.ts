// Validacao de Senha
const regrasSenha = [/.{8,}/, /[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];

export const senhaValida = (senha: string): boolean =>
  regrasSenha.every((regra) => regra.test(senha));

// Turnos aceitos em dia_letivo, bloco_aula e materia
export const TURNOS = ['MANHA', 'TARDE', 'NOITE'];