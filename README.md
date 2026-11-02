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
- MySQL 8.0.16+ rodando (no Windows, confira se o serviço do MySQL está iniciado)

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

- **Banco novo:** rode o `database/schemas.sql` inteiro no MySQL Workbench. Ele cria o banco `staggy_dev` com todas as tabelas.
- **Banco criado antes das últimas mudanças:** rode as migrations da pasta `database/migrations`, em ordem (`001`, `002`, `003`, `004`). Cada uma deve ser aplicada uma única vez.

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
└── migrations/                       # Alterações para bancos já existentes

prolog/                               # Módulo de alocação da grade

src/
├── controllers/
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
| `/admin` | Somente administrador | Dias, blocos, semestres, turmas, disciplinas, formulários, professores, convites e análise de pedidos |

## Variáveis de ambiente

| Variável    | Descrição                                                        | Padrão                  |
|-------------|------------------------------------------------------------------|-------------------------|
| PORT        | Porta do servidor                                                | 3333                    |
| DB_HOST     | Host do banco de dados                                           | localhost               |
| DB_USER     | Usuário do banco                                                 | root                    |
| DB_PASS     | Senha do banco                                                   |                         |
| DB_NAME     | Nome do banco                                                    | staggy_dev              |
| APP_URL     | Endereço do front-end, usado no link do convite                  | http://localhost:3000   |
| SMTP_HOST   | Servidor de e-mail (ex.: `smtp.gmail.com`)                       |                         |
| SMTP_PORT   | Porta do servidor de e-mail                                      | 465                     |
| SMTP_USER   | Usuário do e-mail                                                |                         |
| SMTP_PASS   | Senha do e-mail (no Gmail, use uma "senha de app")               |                         |
| SMTP_FROM   | Remetente dos e-mails                                            | o mesmo do SMTP_USER    |

No `.env`, escreva os comentários sempre em linha separada, nunca depois do valor.

**E-mails sem SMTP:** se `SMTP_HOST` ficar vazio, os e-mails vão para uma caixa de teste do [Ethereal](https://ethereal.email/). Eles não chegam de verdade: o link para ver cada e-mail aparece no terminal onde o back está rodando. Esse modo precisa de internet.

## 🔧 Solução de problemas

| Erro | Causa | Solução |
|------|-------|---------|
| `ECONNREFUSED` ou `ECONNRESET` na porta 3306 | MySQL parado | No PowerShell como administrador: `Start-Service MySQL2610` (troque pelo nome do seu serviço) |
| `EADDRINUSE` na porta 3333 | Já existe um back rodando em outro terminal | Feche o outro com `Ctrl + C` |
| `No database selected` no Workbench | Banco não selecionado | Comece o script com `USE staggy_dev;` |
| Acentos viram `�` nos testes com `curl` | O terminal UCRT64 não envia em UTF-8 | Nos testes pelo terminal, escreva sem acento |
