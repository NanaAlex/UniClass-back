import * as formularioRepository from '../repositories/formularioRepository';

// RF 2.8: abre os formularios programados que chegaram ao inicio e encerra os
// abertos que passaram do termino (horario do MySQL, RNF 9)
export async function atualizarStatusFormularios() {
    await formularioRepository.atualizarStatusPelaData();
}

// Confere a cada minuto
export function iniciarAgendaFormularios(intervalo = 60 * 1000) {
    const executar = () =>
        atualizarStatusFormularios().catch((error) =>
            console.error('Erro ao atualizar o status dos formulários:', error)
        );

    executar();
    setInterval(executar, intervalo);
}
