// Validação dos parâmetros de ambiente na inicialização (RN-72, ET-18,
// CA-200). Em produção, a ausência do banco obrigatório impede a subida;
// nenhum valor sensível é ecoado nas mensagens.

export interface ProblemaAmbiente {
    variavel: string;
    mensagem: string;
}

export function validarAmbiente(env: NodeJS.ProcessEnv = process.env): ProblemaAmbiente[] {
    const problemas: ProblemaAmbiente[] = [];
    const producao = env.NODE_ENV === 'production';

    if (env.PORT !== undefined && env.PORT !== '') {
        const porta = Number(env.PORT);
        if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
            problemas.push({ variavel: 'PORT', mensagem: 'PORT deve ser um inteiro entre 1 e 65535' });
        }
    }
    if (producao) {
        for (const v of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
            if (!env[v] || env[v]!.trim() === '') {
                problemas.push({ variavel: v, mensagem: `${v} é obrigatória em produção; não há banco padrão implícito` });
            }
        }
    }
    if (env.DB_SSL !== undefined && env.DB_SSL !== '' && env.DB_SSL !== 'true' && env.DB_SSL !== 'false') {
        problemas.push({ variavel: 'DB_SSL', mensagem: "DB_SSL deve ser 'true', 'false' ou vazia" });
    }
    if (env.SWIPL_PATH !== undefined && env.SWIPL_PATH.trim() === '' && env.SWIPL_PATH !== '') {
        problemas.push({ variavel: 'SWIPL_PATH', mensagem: 'SWIPL_PATH não pode ser só espaços' });
    }
    if (env.APP_URL) {
        try {
            new URL(env.APP_URL);
        } catch {
            problemas.push({ variavel: 'APP_URL', mensagem: 'APP_URL deve ser uma URL válida' });
        }
    }
    return problemas;
}
