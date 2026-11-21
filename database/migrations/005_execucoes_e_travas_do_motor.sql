-- STAGGY | Migration 005 — Execuções do motor Prolog e travas da grade (especificação v2.7)
-- Cria as tabelas usadas pela geração do horário:
--   execucao_geracao: snapshot imutável, resultado do motor, validação
--     independente, status, diagnósticos e linhagem de cada geração
--     (RN-23, RN-31, RN-66, RN-68, ET-06, ET-12, ET-16);
--   trava_geracao: bloqueios e fixações por período letivo, com grade-base,
--     ação de origem e responsável (RN-41 a RN-45, RN-49, RN-50, ET-08).
-- Não altera nenhuma tabela existente. Requer a migration 004. Aplicar uma vez.

USE staggy_dev;

-- 1. Verificação: nada a converter; as tabelas são novas (IF NOT EXISTS)

-- 2. Execuções do motor
CREATE TABLE IF NOT EXISTS execucao_geracao (
  run_id CHAR(36) PRIMARY KEY,
  id_admin INT NOT NULL,
  curso_id VARCHAR(40) NOT NULL,
  periodo_letivo VARCHAR(20) NOT NULL,
  id_formulario INT NULL,
  snapshot_hash CHAR(64) NULL,
  snapshot JSON NULL,
  status ENUM('EM_PROCESSAMENTO','OTIMA_COMPROVADA','VALIDA_NAO_OTIMA','INVIAVEL_COMPROVADA',
              'INCONCLUSIVA','ENTRADA_INVALIDA','ERRO_EXECUCAO') NOT NULL,
  motivo_termino VARCHAR(60) NULL,
  grade_validada BOOLEAN NOT NULL DEFAULT FALSE,
  resultado JSON NULL,
  validacao JSON NULL,
  diagnosticos JSON NULL,
  candidato_recuperavel JSON NULL,
  contexto_formulario JSON NULL,
  confirmacao_antecipada BOOLEAN NOT NULL DEFAULT FALSE,
  grade_base_run_id CHAR(36) NULL,
  versao_motor VARCHAR(40) NULL,
  policy_version VARCHAR(60) NULL,
  duracao_ms INT NULL,
  tempo_primeira_grade_ms INT NULL,
  id_responsavel INT NOT NULL,
  iniciada_em DATETIME(3) NOT NULL,
  concluida_em DATETIME(3) NULL,
  publicada_em DATETIME NULL,
  id_publicador INT NULL,
  KEY ix_execucao_admin_periodo (id_admin, periodo_letivo, iniciada_em),
  KEY ix_execucao_status (id_admin, status),
  CONSTRAINT fk_execucao_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_execucao_formulario FOREIGN KEY (id_formulario) REFERENCES formulario(id_formulario),
  CONSTRAINT fk_execucao_base FOREIGN KEY (grade_base_run_id) REFERENCES execucao_geracao(run_id),
  CONSTRAINT fk_execucao_responsavel FOREIGN KEY (id_responsavel) REFERENCES usuario(id_usuario),
  CONSTRAINT fk_execucao_publicador FOREIGN KEY (id_publicador) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- 3. Travas da grade por período letivo (expiram com o período: nenhuma
--    consulta lê travas de outro período)
CREATE TABLE IF NOT EXISTS trava_geracao (
  id_trava INT AUTO_INCREMENT PRIMARY KEY,
  id_admin INT NOT NULL,
  periodo_letivo VARCHAR(20) NOT NULL,
  tipo ENUM('ocupacao','vaga_turma','vaga_professor','fixacao_disciplina_professor') NOT NULL,
  dados JSON NOT NULL,
  acao_origem VARCHAR(60) NOT NULL,
  id_acao CHAR(36) NOT NULL,
  grade_base_run_id CHAR(36) NOT NULL,
  grade_base_hash CHAR(64) NOT NULL,
  id_responsavel INT NOT NULL,
  criada_em DATETIME NOT NULL,
  KEY ix_trava_admin_periodo (id_admin, periodo_letivo),
  CONSTRAINT fk_trava_admin FOREIGN KEY (id_admin) REFERENCES administrador(id_usuario),
  CONSTRAINT fk_trava_base FOREIGN KEY (grade_base_run_id) REFERENCES execucao_geracao(run_id),
  CONSTRAINT fk_trava_responsavel FOREIGN KEY (id_responsavel) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- Conferência: as duas tabelas criadas
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'staggy_dev' AND TABLE_NAME IN ('execucao_geracao', 'trava_geracao');
