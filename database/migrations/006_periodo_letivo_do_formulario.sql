-- STAGGY | Migration 006 — Período letivo do formulário (CU-023)
-- Task 08.02. A tela "Lançar formulário" informa o período letivo (ex.: 2027.1)
-- e o resumo do formulário o mostra. O período é do formulário, não dos dados
-- que o compõem (decisão Q18 da task 07.3): formulario.periodo_letivo, opcional
-- (formulários antigos ficam sem período).
-- Requer a migration 004; independe da 005 (execuções e travas do motor Prolog,
-- branch prolog_10_criacaoProlog), que pode ser aplicada antes ou depois.
-- Aplicar uma vez.

USE staggy_dev;

-- 1. Verificação: se a coluna já existir, para aqui sem alterar nada
DROP PROCEDURE IF EXISTS verificar_periodo_letivo;

DELIMITER //
CREATE PROCEDURE verificar_periodo_letivo()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'formulario'
                AND COLUMN_NAME = 'periodo_letivo') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A coluna formulario.periodo_letivo já existe; esta migration já foi aplicada';
  END IF;
END //
DELIMITER ;

CALL verificar_periodo_letivo();
DROP PROCEDURE verificar_periodo_letivo;

-- 2. Período letivo opcional, logo depois do nome
ALTER TABLE formulario ADD COLUMN periodo_letivo VARCHAR(20) NULL AFTER nome;

-- Conferência: periodo_letivo varchar(20), Null = YES
SHOW COLUMNS FROM formulario LIKE 'periodo_letivo';
