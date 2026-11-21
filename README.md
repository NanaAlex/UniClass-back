# Back-end — Staggy

API REST do Staggy, sistema de geração de grade de horários. Construída com **Express** + **TypeScript** + **MySQL**.

# Relatório Jira e Diagramas
https://drive.google.com/drive/folders/11swJExn4jfPuFHDg00saQOlSUQaMkUy3?usp=drive_link

## Tecnologias

- [TypeScript](https://www.typescriptlang.org/)
- [Express](https://expressjs.com/)
- [MySQL2](https://github.com/sidorares/node-mysql2)
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — criptografia das senhas
- [Nodemailer](https://nodemailer.com/) — envio dos e-mails de convite
- [dotenv](https://github.com/motdotla/dotenv)
- [cors](https://github.com/expressjs/cors)

## Como rodar

### Pré-requisitos
- Node.js 18+
- [SWI-Prolog](https://www.swi-prolog.org/download/stable) 9 ou superior no PATH (testado com 10.0.2), usado pelo motor de geração do horário
- IP liberado no firewall do banco do Azure (peça à responsável pelo banco)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/NanaAlex/UniClass-back.git
cd UniClass-back

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env com os dados do seu banco
```

### Banco de dados

O banco de desenvolvimento (`staggy_dev`) é **compartilhado** e fica hospedado no Azure. Não é preciso instalar MySQL localmente: basta preencher o `.env` com os dados do Azure (veja o guia de configuração do ambiente, enviado à equipe).

- **Alterações na estrutura** (novas tabelas, colunas etc.) vão em `database/migrations`, com o próximo número da sequência. Cada migration é rodada **uma única vez, por uma única pessoa**, no MySQL Workbench, na conexão do Azure. Avise a equipe antes de rodar.
- **`database/schemas.sql`**: documenta a estrutura completa e serve só para criar um banco **local** do zero. ⚠️ **Nunca rode esse arquivo no banco do Azure**, pois ele recria o banco e pode apagar os dados de todos.

### Rodar

```bash
# Desenvolvimento (reinicia sozinho ao salvar)
npm run dev
```

A API responde em `http://localhost:3333`.

### Build para produção

```bash
npm run build
npm start
```

## Estrutura de pastas

```
database/
├── schemas.sql                       # Criação do banco e das tabelas
└── migrations/                       # Alterações para bancos já existentes (005: execuções e travas do motor)

prolog/
├── alocacao.pl                       # Motor CLP(FD): validação, modelo, busca, otimização e chave canônica
├── executar.pl                       # Execução pela linha de comando (usada pelo supervisor)
└── testes/testes_alocacao.pl         # Testes unitários do motor (plunit)

scripts/
└── benchmark.ts                      # Benchmark com instâncias sintéticas (nada é gravado no banco)

tests/                                # Suíte do motor e da integração (node --test)

src/
├── config/
│   └── ambiente.ts                   # Validação das variáveis de ambiente na inicialização
├── motor/                            # Integração backend ↔ motor Prolog
│   ├── tipos.ts / politica.ts        # Contrato JSON e política homologada (curva φ, pesos 3:2, teto 40, prazo 600 s)
│   ├── contrato.ts                   # Pré-validação do snapshot (ENTRADA_INVALIDA)
│   ├── canonico.ts / hash.ts         # Comparador e chave canônica (bytes UTF-8) e hash do snapshot
│   ├── supervisor.ts / geracao.ts    # Processo Prolog sob prazo único e classificação final
│   ├── validador.ts                  # Validação independente da grade devolvida
│   ├── painel.ts / projecoes.ts      # Painel técnico e visões por turma e professor
│   ├── edicao.ts                     # Bloqueios e trocas → travas
│   ├── snapshotMysql.ts              # Montagem do snapshot a partir do banco
│   ├── repositorio.ts                # Persistência de execuções e travas
│   └── publicacao.ts                 # Publicação atômica da grade validada
├── controllers/
│   ├── geracaoController.ts          # Geração, painel, edição e publicação do horário (motor)
│   ├── saudeController.ts            # /api/saude (banco e motor Prolog)
│   ├── authController.ts             # Login, logout, usuário logado, troca de senha e cadastro por convite
│   ├── conviteController.ts          # Convites de professores por e-mail
│   ├── gestaoProfessorController.ts  # Gestão de professores pelo administrador
│   ├── formularioController.ts       # Formulário de disponibilidade do professor
│   ├── publicacaoController.ts       # Lançamento, abertura e encerramento de formulários (admin)
│   ├── solicitacaoController.ts      # Pedidos de alteração (formulário e horário)
│   ├── horarioController.ts          # Prévia e horário definitivo do professor
│   ├── semestreController.ts         # Semestres
│   ├── turmaController.ts            # Turmas
│   ├── materiaController.ts          # Disciplinas
│   ├── diaLetivoController.ts        # Dias letivos
│   └── blocoController.ts            # Blocos e horários de aula
├── database/
│   └── connection.ts                 # Conexão com o MySQL
├── middlewares/
│   └── autenticacao.ts               # Verifica a sessão e o perfil (professor ou administrador)
├── routes/
│   ├── authRoutes.ts                 # /auth
│   ├── professorRoutes.ts            # /professor
│   └── adminRoutes.ts                # /admin
├── utils/
│   ├── agendaFormulario.ts           # Abre e encerra formulários pela data, a cada minuto
│   ├── email.ts                      # Envio de e-mails
│   └── validacoes.ts                 # Regras de senha, e-mail e turnos
└── server.ts                         # Entrada da aplicação
```

## Autenticação

O login devolve um **token de sessão**, guardado no banco (tabela `sessao`). As rotas protegidas exigem o cabeçalho:

```
Authorization: Bearer <token>
```

A sessão expira depois de **1 hora sem uso** e é encerrada no logout, na troca de senha e quando a conta é desativada.

## Rotas

| Prefixo | Quem acessa | O que tem |
|---------|-------------|-----------|
| `/auth` | Público e usuários logados | Login, logout, usuário logado, troca de senha, convites e cadastro pelo convite |
| `/professor` | Somente professor | Formulário de disponibilidade, horário (prévia e definitivo) e pedidos de alteração |
| `/admin` | Somente administrador | Dias, blocos, semestres, turmas, disciplinas, formulários, professores, convites, análise de pedidos e geração do horário |
| `/api/saude` | Público | Situação do banco e do motor Prolog (200 = ok, 503 = degradado), sem dados sensíveis |

## Geração do horário (motor Prolog CLP(FD))

Implementa a especificação consolidada v2.7. **Antes de usar, rode a migration `005_execucoes_e_travas_do_motor.sql`** (cria `execucao_geracao` e `trava_geracao`; não altera tabelas existentes).

**Fluxo:** o backend congela um *snapshot* (turmas e disciplinas ativas do administrador no período, respostas `ENVIADA` do formulário mais recente, calendário ordinal, travas do período) → pré-valida → executa o motor sob um supervisor com **prazo único de 600 s** → valida a grade de forma independente → mostra o painel. Edições geram travas e exigem nova geração; só a grade `OTIMA_COMPROVADA` pode ser publicada.

| Rota (`/admin`) | O que faz |
|-----------------|-----------|
| `POST /geracoes` `{ periodoLetivo: "2027/1", confirmarGeracaoAntecipada?, gradeBaseRunId? }` | Inicia a geração (202 + `runId`). Com professores pendentes, responde 409 com a lista até haver confirmação |
| `GET /geracoes?periodoLetivo=` | Lista as execuções |
| `GET /geracoes/:runId` | Painel técnico (status, justificativa, provas por nível, custos, contagens, diagnósticos) e as visões por turma e professor |
| `GET /geracoes/travas?periodoLetivo=` | Travas do período |
| `POST /geracoes/:runId/edicoes` | Ação sobre uma grade validada: `bloquear_grade_turma`, `bloquear_grade_professor`, `bloquear_bloco_turma`, `bloquear_bloco_professor`, `fixar_disciplina_professor_semestre`, `trocar_posicoes` (só na mesma turma) |
| `POST /geracoes/:runId/publicar` | Publica em `geracao_horario`/`aula_alocada` após revalidar tudo na mesma transação |

**Status possíveis:** `OTIMA_COMPROVADA`, `VALIDA_NAO_OTIMA` (grade válida sem prova de todos os níveis; publicação bloqueada até decisão institucional), `INVIAVEL_COMPROVADA`, `INCONCLUSIVA`, `ENTRADA_INVALIDA`, `ERRO_EXECUCAO`. `EM_PROCESSAMENTO` é só estado de interface.

**Como o modelo existente é lido:** o escopo é o administrador (equivale ao curso); `bloco_aula.qtd_aulas` precisa ser igual em todos os turnos (é o K); o bloco é identificado por dia letivo + `ordem` (os horários de relógio não entram no modelo); um bloco só conta como disponível se o professor marcou todas as suas aulas; `materia.qtd_professores` diferente de 1 gera aviso (a v2.7 não tem co-docência).

### Testes do motor

```bash
npm test             # suíte TypeScript (inclui motor real, oráculo exaustivo e testes de mutação)
npm run test:prolog  # testes unitários do motor em Prolog
npm run typecheck    # checagem de tipos do código e dos testes
npm run bench -- medio --limite 600   # benchmark (pequeno, medio, grande, grande-2-turmas, adversarial, adversarial-grande)
```

Os testes não usam o banco: as rotas SQL (`snapshotMysql`, `repositorio`, `publicacao`) não foram executadas contra MySQL nesta versão.

## Variáveis de ambiente

| Variável    | Descrição                                                        | Padrão                  |
|-------------|------------------------------------------------------------------|-------------------------|
| PORT        | Porta do servidor                                                | 3333                    |
| DB_HOST     | Host do banco de dados                                           | localhost               |
| DB_USER     | Usuário do banco                                                 | root                    |
| DB_PASS     | Senha do banco                                                   |                         |
| DB_NAME     | Nome do banco                                                    | staggy_dev              |
| DB_SSL      | Ativa SSL na conexão (obrigatório no Azure)                      | `true` no Azure, vazio no MySQL local |
| APP_URL     | Endereço do front-end, usado no link do convite                  | http://localhost:3000   |
| SMTP_HOST   | Servidor de e-mail (ex.: `smtp.gmail.com`)                       |                         |
| SMTP_PORT   | Porta do servidor de e-mail                                      | 465                     |
| SMTP_USER   | Usuário do e-mail                                                |                         |
| SMTP_PASS   | Senha do e-mail (no Gmail, use uma "senha de app")               |                         |
| SMTP_FROM   | Remetente dos e-mails                                            | o mesmo do SMTP_USER    |
| SWIPL_PATH  | Executável do SWI-Prolog usado pelo motor                        | `swipl` do PATH         |

No `.env`, escreva os comentários sempre em linha separada, nunca depois do valor. Em produção (`NODE_ENV=production`), a API não sobe sem `DB_HOST`, `DB_USER` e `DB_NAME`.

**E-mails sem SMTP:** se `SMTP_HOST` ficar vazio, os e-mails vão para uma caixa de teste do [Ethereal](https://ethereal.email/). Eles não chegam de verdade: o link para ver cada e-mail aparece no terminal onde o back está rodando. Esse modo precisa de internet.

## 🔧 Solução de problemas

| Erro | Causa | Solução |
|------|-------|---------|
| `ECONNREFUSED` ou `ECONNRESET` na porta 3306 | MySQL parado | No PowerShell como administrador: `Start-Service MySQL2610` (troque pelo nome do seu serviço) |
| `EADDRINUSE` na porta 3333 | Já existe um back rodando em outro terminal | Feche o outro com `Ctrl + C` |
| `No database selected` no Workbench | Banco não selecionado | Comece o script com `USE staggy_dev;` |
| Acentos viram `�` nos testes com `curl` | O terminal UCRT64 não envia em UTF-8 | Nos testes pelo terminal, escreva sem acento |
| `Access denied for user 'equipe'@'localhost'` | O back está conectando no MySQL local | Deixe uma única linha `DB_HOST` no `.env`, com o endereço do Azure, e reinicie |
| `Connections using insecure transport are prohibited` | SSL desligado | Confira `DB_SSL=true` no `.env` e reinicie |
| `ETIMEDOUT` ao conectar no banco | IP não liberado no firewall do Azure | Peça a liberação do seu IP atual |
