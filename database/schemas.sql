-- STAGGY | DDL MySQL 8.0.16+
-- Execute em banco de desenvolvimento vazio.
CREATE DATABASE IF NOT EXISTS staggy_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE staggy_dev;

-- 1. IDENTIDADE E ACESSO
CREATE TABLE usuario (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  tipo_usuario ENUM('ADMINISTRADOR','PROFESSOR') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  data_criacao DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE administrador (
  id_usuario INT PRIMARY KEY,
  cargo VARCHAR(255),
  CONSTRAINT fk_administrador_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE professor (
  id_usuario INT PRIMARY KEY,
  carga_horaria_semanal DECIMAL(5,2) NOT NULL,
  titulacao VARCHAR(255),
  CONSTRAINT fk_professor_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE vinculo_professor_admin (
  id_admin INT NOT NULL,
  id_professor INT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  data_vinculo DATETIME NOT NULL,
  data_desvinculo DATETIME NULL,
  PRIMARY KEY (id_admin, id_professor),
  CONSTRAINT fk_vinculo_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_vinculo_professor FOREIGN KEY (id_professor) REFERENCES professor(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE convite_professor (
  id_convite INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  email_destino VARCHAR(255) NOT NULL,
  tipo_convite ENUM('CRIACAO_CONTA','VINCULO') NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  status ENUM('PENDENTE','ACEITO','EXPIRADO','INVALIDADO') NOT NULL,
  data_envio DATETIME NOT NULL,
  data_expiracao DATETIME NOT NULL,
  data_aceite DATETIME NULL,
  id_professor INT NULL,
  CONSTRAINT fk_convite_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_convite_professor FOREIGN KEY (id_professor) REFERENCES professor(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE token_recuperacao_senha (
  id_token INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  data_criacao DATETIME NOT NULL,
  data_expiracao DATETIME NOT NULL,
  data_utilizacao DATETIME NULL,
  data_invalidacao DATETIME NULL,
  CONSTRAINT fk_token_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE sessao (
  id_sessao INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  criado_em DATETIME NOT NULL,
  ultimo_acesso DATETIME NOT NULL,
  expira_em DATETIME NOT NULL,
  encerrada_em DATETIME NULL,
  motivo_encerramento ENUM('LOGOUT','INATIVIDADE','CONTA_DESATIVADA','SENHA_ALTERADA') NULL,
  CONSTRAINT fk_sessao_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- 2. CONFIGURACAO ACADEMICA
CREATE TABLE curso (
  id_curso INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  nome_curso VARCHAR(255) NOT NULL,
  codigo_curso VARCHAR(30) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_curso_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE semestre (
  id_semestre INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  id_curso INT NULL,
  nome VARCHAR(255) NOT NULL,
  periodo_letivo VARCHAR(20) NULL,
  previas_visiveis BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_semestre_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_semestre_curso FOREIGN KEY (id_curso) REFERENCES curso(id_curso)
) ENGINE=InnoDB;

CREATE TABLE turma (
  id_turma INT AUTO_INCREMENT PRIMARY KEY,
  id_semestre INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  turno ENUM('MATUTINO','VERSPERTINO','NOTURNO','INTEGRAL') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_turma_semestre FOREIGN KEY (id_semestre) REFERENCES semestre(id_semestre)
) ENGINE=InnoDB;

CREATE TABLE materia (
  id_materia INT AUTO_INCREMENT PRIMARY KEY,
  id_semestre INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  qtd_aulas_semana INT NOT NULL,
  qtd_professores INT NOT NULL,
  turno ENUM('MANHA','TARDE','NOITE','INTEGRAL') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_materia_semestre FOREIGN KEY (id_semestre) REFERENCES semestre(id_semestre)
) ENGINE=InnoDB;

CREATE TABLE dia_letivo (
  id_dia_letivo INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  dia_semana ENUM('SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO') NOT NULL,
  turno ENUM('MANHA','TARDE','NOITE','INTEGRAL') NOT NULL,
  UNIQUE KEY uq_dia_letivo (id_admin, dia_semana, turno),
  CONSTRAINT fk_dia_letivo_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE bloco_aula (
  id_bloco INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  turno ENUM('MANHA','TARDE','NOITE','INTEGRAL') NOT NULL,
  ordem INT NOT NULL,
  qtd_aulas INT NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  UNIQUE KEY uq_bloco_ordem (id_admin, turno, ordem),
  CONSTRAINT fk_bloco_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT ck_bloco_qtd CHECK (qtd_aulas > 0),
  CONSTRAINT ck_bloco_horas CHECK (hora_fim > hora_inicio)
) ENGINE=InnoDB;

CREATE TABLE slot_aula (
  id_slot INT AUTO_INCREMENT PRIMARY KEY,
  id_bloco INT NOT NULL,
  numero_aula INT NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  UNIQUE KEY uq_slot_numero (id_bloco, numero_aula),
  CONSTRAINT fk_slot_bloco FOREIGN KEY (id_bloco) REFERENCES bloco_aula(id_bloco),
  CONSTRAINT ck_slot_numero CHECK (numero_aula > 0),
  CONSTRAINT ck_slot_horas CHECK (hora_fim > hora_inicio)
) ENGINE=InnoDB;

-- 3. FORMULARIOS
CREATE TABLE formulario (
  id_formulario INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  id_semestre INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  data_inicio DATETIME NULL,
  data_fim DATETIME NULL,
  status ENUM('NAO_INICIADO','ABERTO','ENCERRADO') NOT NULL,
  iniciado_manualmente BOOLEAN NOT NULL DEFAULT FALSE,
  encerrado_manualmente BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_formulario_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_formulario_semestre FOREIGN KEY (id_semestre) REFERENCES semestre(id_semestre)
) ENGINE=InnoDB;

CREATE TABLE resposta_formulario (
  id_resposta INT AUTO_INCREMENT PRIMARY KEY,
  id_formulario INT NOT NULL,
  id_professor INT NOT NULL,
  data_envio DATETIME NOT NULL,
  status ENUM('ENVIADA','LIBERADA_PARA_ALTERACAO') NOT NULL,
  UNIQUE KEY uq_resposta_formulario_professor (id_formulario, id_professor),
  CONSTRAINT fk_resposta_formulario FOREIGN KEY (id_formulario) REFERENCES formulario(id_formulario),
  CONSTRAINT fk_resposta_professor FOREIGN KEY (id_professor) REFERENCES professor(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE interesse_materia (
  id_resposta INT NOT NULL,
  id_materia INT NOT NULL,
  nota_interesse TINYINT NOT NULL,
  PRIMARY KEY (id_resposta, id_materia),
  CONSTRAINT fk_interesse_resposta FOREIGN KEY (id_resposta) REFERENCES resposta_formulario(id_resposta),
  CONSTRAINT fk_interesse_materia FOREIGN KEY (id_materia) REFERENCES materia(id_materia),
  CONSTRAINT ck_interesse_nota CHECK (nota_interesse BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE disponibilidade_horario (
  id_resposta INT NOT NULL,
  id_dia_letivo INT NOT NULL,
  id_slot INT NOT NULL,
  disponivel BOOLEAN NOT NULL,
  PRIMARY KEY (id_resposta, id_dia_letivo, id_slot),
  CONSTRAINT fk_disponibilidade_resposta FOREIGN KEY (id_resposta) REFERENCES resposta_formulario(id_resposta),
  CONSTRAINT fk_disponibilidade_dia FOREIGN KEY (id_dia_letivo) REFERENCES dia_letivo(id_dia_letivo),
  CONSTRAINT fk_disponibilidade_slot FOREIGN KEY (id_slot) REFERENCES slot_aula(id_slot)
) ENGINE=InnoDB;

CREATE TABLE preferencia_turno (
  id_resposta INT NOT NULL,
  id_dia_letivo INT NOT NULL,
  nota TINYINT NOT NULL,
  PRIMARY KEY (id_resposta, id_dia_letivo),
  CONSTRAINT fk_preferencia_resposta FOREIGN KEY (id_resposta) REFERENCES resposta_formulario(id_resposta),
  CONSTRAINT fk_preferencia_dia FOREIGN KEY (id_dia_letivo) REFERENCES dia_letivo(id_dia_letivo),
  CONSTRAINT ck_preferencia_nota CHECK (nota BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE solicitacao_alteracao_resposta (
  id_solicitacao INT AUTO_INCREMENT PRIMARY KEY,
  id_resposta INT NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  status ENUM('PENDENTE','APROVADA','REJEITADA') NOT NULL,
  data_solicitacao DATETIME NOT NULL,
  id_admin_analise INT NULL,
  data_analise DATETIME NULL,
  CONSTRAINT fk_solic_resposta FOREIGN KEY (id_resposta) REFERENCES resposta_formulario(id_resposta),
  CONSTRAINT fk_solic_resposta_admin FOREIGN KEY (id_admin_analise) REFERENCES administrador(id_usuario)
) ENGINE=InnoDB;

-- 4. GRADE E SOLICITACOES
CREATE TABLE geracao_horario (
  id_geracao INT AUTO_INCREMENT PRIMARY KEY,
  id_semestre INT NOT NULL,
  id_admin INT NOT NULL,
  numero_versao INT NOT NULL,
  status ENUM('PREVIA','DEFINITIVO','SUBSTITUIDO') NOT NULL,
  criada_em DATETIME NOT NULL,
  definida_em DATETIME NULL,
  id_geracao_anterior INT NULL,
  origem ENUM('AUTOMATICA','MANUAL') NOT NULL,
  UNIQUE KEY uq_geracao_versao (id_semestre, numero_versao),
  CONSTRAINT fk_geracao_semestre FOREIGN KEY (id_semestre) REFERENCES semestre(id_semestre),
  CONSTRAINT fk_geracao_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_geracao_anterior FOREIGN KEY (id_geracao_anterior) REFERENCES geracao_horario(id_geracao)
) ENGINE=InnoDB;

CREATE TABLE aula_alocada (
  id_aula INT AUTO_INCREMENT PRIMARY KEY,
  id_geracao INT NOT NULL,
  id_turma INT NOT NULL,
  id_materia INT NOT NULL,
  id_professor INT NULL,
  id_dia_letivo INT NOT NULL,
  id_slot INT NOT NULL,
  bloqueada BOOLEAN NOT NULL DEFAULT FALSE,
  origem ENUM('AUTOMATICA','MANUAL') NOT NULL,
  UNIQUE KEY uq_aula_turma_slot (id_geracao, id_turma, id_dia_letivo, id_slot),
  CONSTRAINT fk_aula_geracao FOREIGN KEY (id_geracao) REFERENCES geracao_horario(id_geracao),
  CONSTRAINT fk_aula_turma FOREIGN KEY (id_turma) REFERENCES turma(id_turma),
  CONSTRAINT fk_aula_materia FOREIGN KEY (id_materia) REFERENCES materia(id_materia),
  CONSTRAINT fk_aula_professor FOREIGN KEY (id_professor) REFERENCES professor(id_usuario),
  CONSTRAINT fk_aula_dia FOREIGN KEY (id_dia_letivo) REFERENCES dia_letivo(id_dia_letivo),
  CONSTRAINT fk_aula_slot FOREIGN KEY (id_slot) REFERENCES slot_aula(id_slot)
) ENGINE=InnoDB;

CREATE TABLE pendencia_geracao (
  id_pendencia INT AUTO_INCREMENT PRIMARY KEY,
  id_geracao INT NOT NULL,
  tipo ENUM('HORARIO_INCOMPLETO','MATERIA_SEM_INTERESSADO','AULA_SEM_PROFESSOR','CONFLITO_NAO_POSSO') NOT NULL,
  id_turma INT NULL,
  id_materia INT NULL,
  id_professor INT NULL,
  descricao VARCHAR(500) NOT NULL,
  CONSTRAINT fk_pendencia_geracao FOREIGN KEY (id_geracao) REFERENCES geracao_horario(id_geracao),
  CONSTRAINT fk_pendencia_turma FOREIGN KEY (id_turma) REFERENCES turma(id_turma),
  CONSTRAINT fk_pendencia_materia FOREIGN KEY (id_materia) REFERENCES materia(id_materia),
  CONSTRAINT fk_pendencia_professor FOREIGN KEY (id_professor) REFERENCES professor(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE solicitacao_alteracao_horario (
  id_solicitacao INT AUTO_INCREMENT PRIMARY KEY,
  id_professor INT NOT NULL,
  id_geracao INT NOT NULL,
  id_aula INT NULL,
  motivo VARCHAR(500) NOT NULL,
  data_envio DATETIME NOT NULL,
  status ENUM('PENDENTE','APROVADA','REJEITADA','CANCELADA') NULL,
  CONSTRAINT fk_solic_horario_professor FOREIGN KEY (id_professor) REFERENCES professor(id_usuario),
  CONSTRAINT fk_solic_horario_geracao FOREIGN KEY (id_geracao) REFERENCES geracao_horario(id_geracao),
  CONSTRAINT fk_solic_horario_aula FOREIGN KEY (id_aula) REFERENCES aula_alocada(id_aula)
) ENGINE=InnoDB;

-- 5. NOTIFICACOES E AUDITORIA
CREATE TABLE notificacao (
  id_notificacao INT AUTO_INCREMENT PRIMARY KEY,
  id_destinatario INT NOT NULL,
  tipo ENUM('NOVO_HORARIO','CONFLITO_HORARIO','SEM_HORARIO','FORMULARIO_ABERTO','FORMULARIO_ENCERRADO','LEMBRETE_FORMULARIO','NOVA_SOLICITACAO','SOLICITACAO_DECIDIDA') NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  mensagem VARCHAR(500) NOT NULL,
  data_envio DATETIME NOT NULL,
  data_leitura DATETIME NULL,
  tipo_referencia VARCHAR(50) NULL,
  id_referencia INT NULL,
  CONSTRAINT fk_notificacao_destinatario FOREIGN KEY (id_destinatario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE registro_auditoria (
  id_registro INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  acao VARCHAR(100) NOT NULL,
  entidade VARCHAR(100) NOT NULL,
  id_entidade INT NULL,
  data_hora DATETIME NOT NULL,
  detalhes JSON NULL,
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- CONFERENCIA
SELECT COUNT(*) AS total_tabelas FROM information_schema.tables
WHERE table_schema = 'staggy_dev' AND table_type = 'BASE TABLE';
SHOW TABLES;

-- OBSERVACOES:
-- 1. Regras que atravessam tabelas (mesmo semestre para materia/turma/grade,
--    compatibilidade de dia/slot/turno, conflito entre administradores) devem ser validadas na aplicacao/Prolog.
-- 2. Prazo de convite, expiracao de sessao e tokens sao regras de aplicacao, nao automacoes no DDL.
