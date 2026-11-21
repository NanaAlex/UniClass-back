import { emTransacao } from '../database/transacao';
import { ErroAplicacao } from '../erros/ErroAplicacao';
import * as administradorRepository from '../repositories/administradorRepository';
import * as formularioRepository from '../repositories/formularioRepository';
import { FILTROS_SITUACAO, FormularioDoAdmin, ProfessorDoFormulario } from '../repositories/formularioRepository';

// Periodo letivo: ano e semestre do ano (ex.: 2027/1)
const PERIODO_LETIVO = /^\d{4}\/[12]$/;

interface DataHora {
    dia: string;
    soDia: boolean;
    valor: string;
}

// Agora no horario de Brasilia (RNF 9), no formato do MySQL: AAAA-MM-DD HH:MM:SS
function agora() {
    const partes = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(new Date()).map((parte) => [parte.type, parte.value])
    );
    return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

// 'AAAA-MM-DD' (dia inteiro, como na task 07.3: abre as 00:00 e encerra as
// 23:59:59) ou 'AAAA-MM-DDTHH:MM' (a tela tem data e hora), no horario de
// Brasilia. Devolve o valor para o MySQL, ou null se o dia ou a hora nao
// existirem (2027-02-30, 25:00). Textos nesse formato se comparam como texto.
function lerDataHora(valor: unknown, fimDoDia: boolean): DataHora | null {
    const partes = typeof valor === 'string'
        ? /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/.exec(valor)
        : null;
    if (!partes) return null;

    const [, dia, hora, minuto] = partes;
    const data = new Date(`${dia}T00:00:00Z`);
    if (isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== dia) return null;

    if (hora === undefined) {
      return { dia, soDia: true, valor: `${dia} ${fimDoDia ? '23:59:59' : '00:00:00'}` };
    }
    return { dia, soDia: false, valor: `${dia} ${hora}:${minuto}:00` };
}

// Datas do lancamento e da edicao (400)
function validarDatas(corpo: any): { inicio: DataHora; fim: DataHora } {
    const inicio = lerDataHora(corpo?.dataInicio, false);
    const fim = lerDataHora(corpo?.dataFim, true);

    if (!inicio) {
      throw new ErroAplicacao(400, 'Informe uma data de início válida (AAAA-MM-DD ou AAAA-MM-DDTHH:MM)');
    }
    if (!fim) {
      throw new ErroAplicacao(400, 'Informe uma data de término válida (AAAA-MM-DD ou AAAA-MM-DDTHH:MM)');
    }
    if (fim.valor <= inicio.valor) {
      throw new ErroAplicacao(400, 'A data de término deve ser posterior à data de início');
    }
    // So o dia: o termino de hoje (23:59:59) ainda vale, como na 07.3
    if (fim.valor <= agora()) {
      throw new ErroAplicacao(400, 'A data de término não pode ser anterior a agora');
    }

    return { inicio, fim };
}

function validarCorpoLancamento(corpo: any) {
    const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';

    if (!nome) {
      throw new ErroAplicacao(400, 'Informe o nome do formulário');
    }
    if (nome.length > 255) {
      throw new ErroAplicacao(400, 'O nome do formulário deve ter no máximo 255 caracteres');
    }

    // CU-023 (decisao Q18 da 07.3): periodo letivo do formulario, opcional, no
    // formato da geracao do escalonador (AAAA/1 ou AAAA/2, PERIODO_VALIDO do motor)
    const { periodoLetivo } = corpo ?? {};
    const periodo = typeof periodoLetivo === 'string' ? periodoLetivo.trim() : '';
    if (periodoLetivo !== undefined && periodoLetivo !== null && (typeof periodoLetivo !== 'string' || (periodo && !PERIODO_LETIVO.test(periodo)))) {
      throw new ErroAplicacao(400, 'Informe o período letivo no formato AAAA/1 ou AAAA/2');
    }

    return { nome, periodoLetivo: periodo || null, ...validarDatas(corpo) };
}

// Formulario do admin; id invalido ou de outro admin e 404
async function buscarFormularioDoAdmin(idAdmin: number, idFormulario: number) {
    const formulario = Number.isInteger(idFormulario) ? await formularioRepository.buscarDoAdmin(idAdmin, idFormulario) : null;

    if (!formulario) {
      throw new ErroAplicacao(404, 'Formulário não encontrado');
    }
    return formulario;
}

// CU-026: lista com o estado e as respostas de cada formulario
export async function listarFormularios(idAdmin: number): Promise<FormularioDoAdmin[]> {
    await formularioRepository.atualizarStatusPelaData();
    return formularioRepository.listarDoAdmin(idAdmin);
}

// CU-023 e CU-024: botao "Lancar"; inicio hoje abre, inicio futuro programa
export async function lancarFormulario(idAdmin: number, corpo: unknown): Promise<FormularioDoAdmin[]> {
    const dados = validarCorpoLancamento(corpo);

    await formularioRepository.atualizarStatusPelaData();

    const conflito = await emTransacao(async (conexao) => {
        // Trava o admin: dois cliques nao lancam dois formularios ativos
        await administradorRepository.travar(idAdmin, conexao);

        const estado = await formularioRepository.estadoParaLancamento(idAdmin, conexao);

        if (estado.temAtivo) {
          return 'Já existe um formulário programado ou aberto; encerre-o antes de lançar outro';
        }
        if (!estado.temGrade || !estado.temMateria) {
          // Sem dia com bloco ou sem disciplina, o professor nao tem o que responder
          return 'Cadastre os dias letivos, os blocos de aulas e as disciplinas antes de lançar o formulário';
        }

        await formularioRepository.inserir(idAdmin, dados.nome, dados.periodoLetivo, dados.inicio.valor, dados.fim.valor, conexao);
        return null;
    });

    if (conflito) {
      throw new ErroAplicacao(409, conflito);
    }

    return formularioRepository.listarDoAdmin(idAdmin);
}

// CU-024: botao "EDITAR DATA"
export async function editarDatas(idAdmin: number, idFormulario: number, corpo: unknown): Promise<FormularioDoAdmin[]> {
    const datas = validarDatas(corpo);

    await formularioRepository.atualizarStatusPelaData();

    const formulario = await buscarFormularioDoAdmin(idAdmin, idFormulario);

    if (formulario.status === 'NAO_INICIADO') {
      await formularioRepository.atualizarDatas(formulario.id, datas.inicio.valor, datas.fim.valor);
      // Inicio hoje ou antes: o programado abre agora
      await formularioRepository.atualizarStatusPelaData();
    } else {
      // Professores ja receberam o formulario com esse inicio. So o dia
      // (07.3): compara o dia; com a hora: compara o minuto
      const mesmoInicio = datas.inicio.soDia
          ? datas.inicio.dia === formulario.dataInicio
          : datas.inicio.valor.slice(0, 16) === formulario.inicioMinuto;

      if (!mesmoInicio) {
        throw new ErroAplicacao(409, 'O formulário já foi aberto; a data de início não pode mudar');
      }

      await formularioRepository.atualizarTermino(formulario.id, datas.fim.valor);
    }

    return formularioRepository.listarDoAdmin(idAdmin);
}

// CU-023: abre agora um programado ou reabre o encerrado (botao "ABRIR")
export async function abrirFormulario(idAdmin: number, idFormulario: number) {
    await formularioRepository.atualizarStatusPelaData();

    const formulario = await buscarFormularioDoAdmin(idAdmin, idFormulario);

    // CU-023 A1
    if (formulario.status === 'ABERTO') {
      throw new ErroAplicacao(409, 'O período de respostas já está em andamento');
    }

    if (formulario.status === 'NAO_INICIADO') {
      await formularioRepository.abrirAgora(formulario.id);
      return { reaberto: false, formularios: await formularioRepository.listarDoAdmin(idAdmin) };
    }

    // Encerrado: so o mais recente volta, para nao haver dois ativos
    if (!formulario.maisRecente) {
      throw new ErroAplicacao(409, 'Apenas o formulário mais recente pode ser reaberto');
    }
    if (formulario.terminoVencido) {
      throw new ErroAplicacao(409, 'A data de término já passou; edite a data antes de reabrir');
    }

    await formularioRepository.reabrir(formulario.id);
    return { reaberto: true, formularios: await formularioRepository.listarDoAdmin(idAdmin) };
}

// CU-025: encerra as respostas; libera a geracao do horario (RN-29)
export async function encerrarFormulario(idAdmin: number, idFormulario: number): Promise<FormularioDoAdmin[]> {
    await formularioRepository.atualizarStatusPelaData();

    const formulario = await buscarFormularioDoAdmin(idAdmin, idFormulario);

    // CU-025 A1
    if (formulario.status === 'ENCERRADO') {
      throw new ErroAplicacao(409, 'O formulário já está encerrado');
    }
    if (formulario.status === 'NAO_INICIADO') {
      throw new ErroAplicacao(409, 'O formulário ainda não foi aberto');
    }

    await formularioRepository.encerrar(formulario.id);
    return formularioRepository.listarDoAdmin(idAdmin);
}

// CU-027 e CU-028: quem respondeu ("Data da resposta") e quem ainda nao respondeu
export async function listarProfessores(idAdmin: number, idFormulario: number, situacao: unknown) {
    // So as chaves proprias: "constructor" e afins nao sao filtros
    if (situacao !== undefined && (typeof situacao !== 'string' || !Object.prototype.hasOwnProperty.call(FILTROS_SITUACAO, situacao))) {
      throw new ErroAplicacao(400, 'Filtro de situação inválido; use responderam ou pendentes');
    }

    const formulario = await buscarFormularioDoAdmin(idAdmin, idFormulario);
    const professores: ProfessorDoFormulario[] = await formularioRepository.listarProfessores(
        idAdmin, formulario.id, situacao as string | undefined);

    return { idFormulario: formulario.id, situacao: situacao ?? 'todos', professores };
}
