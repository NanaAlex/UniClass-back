// Recusa prevista de uma regra de negocio (400, 404, 409...). O service lanca;
// o controller responde com o status e a mensagem, sem registrar no log.
export class ErroAplicacao extends Error {
    constructor(public readonly status: number, mensagem: string) {
        super(mensagem);
        this.name = 'ErroAplicacao';
    }
}
