-- STAGGY | Migration 007 — Leitura e resposta do pedido de alteração de horário (RF 9.5)
-- Task 08.03. O pedido de horário é só descritivo (RF 3.4): não é aprovado nem
-- rejeitado. Na aba Solicitações do perfil do professor, o administrador o
-- marca como lido e pode deixar uma resposta. Duas colunas opcionais em
-- solicitacao_alteracao_horario: data_leitura (NULL = ainda não lido) e
-- resposta (texto do administrador, até 500 caracteres, como o motivo).
-- Independe da 005 (motor Prolog) e da 006 (período letivo).
-- Aplicar uma vez.

USE staggy_dev;

-- 1. Verificação: se alguma das colunas já existir, para aqui sem alterar nada
DROP PROCEDURE IF EXISTS verificar_leitura_solicitacao_horario;

DELIMITER //
CREATE PROCEDURE verificar_leitura_solicitacao_horario()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'solicitacao_alteracao_horario'
                AND COLUMN_NAME IN ('data_leitura', 'resposta')) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'solicitacao_alteracao_horario já tem data_leitura ou resposta; esta migration já foi aplicada';
  END IF;
END //
DELIMITER ;

CALL verificar_leitura_solicitacao_horario();
DROP PROCEDURE verificar_leitura_solicitacao_horario;

-- 2. Leitura e resposta do administrador, logo depois do status
ALTER TABLE solicitacao_alteracao_horario
  ADD COLUMN data_leitura DATETIME NULL AFTER status,
  ADD COLUMN resposta VARCHAR(500) NULL AFTER data_leitura;

-- Conferência: data_leitura datetime e resposta varchar(500), as duas com Null = YES
SHOW COLUMNS FROM solicitacao_alteracao_horario WHERE Field IN ('data_leitura', 'resposta');
