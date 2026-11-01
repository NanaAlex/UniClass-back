-- STAGGY | Migration 002 — Remover o turno INTEGRAL
-- Task 07.3. O turno INTEGRAL não aparece nas telas e a API já o recusava (400);
-- ele sai dos ENUMs de turma, materia, dia_letivo e bloco_aula, que passam a
-- aceitar só MANHA, TARDE e NOITE.
-- Requer a migration 001. Aplicar uma vez.

USE staggy_dev;

-- Modo estrito: um valor fora do novo ENUM gera erro, em vez de virar texto vazio
SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_TRANS_TABLES');

-- 1. Verificação: se algum registro usa INTEGRAL, para aqui sem alterar nada
--    (ALTER TABLE não é transacional; sem esta checagem, uma tabela poderia
--    mudar e a seguinte falhar). Para ver os registros:
--    SELECT 'turma', id_turma FROM turma WHERE turno = 'INTEGRAL'
--    UNION ALL SELECT 'materia', id_materia FROM materia WHERE turno = 'INTEGRAL'
--    UNION ALL SELECT 'dia_letivo', id_dia_letivo FROM dia_letivo WHERE turno = 'INTEGRAL'
--    UNION ALL SELECT 'bloco_aula', id_bloco FROM bloco_aula WHERE turno = 'INTEGRAL';
DROP PROCEDURE IF EXISTS verificar_turno_integral;

DELIMITER //
CREATE PROCEDURE verificar_turno_integral()
BEGIN
  IF EXISTS (SELECT 1 FROM turma WHERE turno = 'INTEGRAL')
     OR EXISTS (SELECT 1 FROM materia WHERE turno = 'INTEGRAL')
     OR EXISTS (SELECT 1 FROM dia_letivo WHERE turno = 'INTEGRAL')
     OR EXISTS (SELECT 1 FROM bloco_aula WHERE turno = 'INTEGRAL') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Há registros com turno INTEGRAL; altere-os para MANHA, TARDE ou NOITE antes desta migration';
  END IF;
END //
DELIMITER ;

CALL verificar_turno_integral();
DROP PROCEDURE verificar_turno_integral;

-- 2. ENUMs sem INTEGRAL
ALTER TABLE turma      MODIFY turno ENUM('MANHA','TARDE','NOITE') NOT NULL;
ALTER TABLE materia    MODIFY turno ENUM('MANHA','TARDE','NOITE') NOT NULL;
ALTER TABLE dia_letivo MODIFY turno ENUM('MANHA','TARDE','NOITE') NOT NULL;
ALTER TABLE bloco_aula MODIFY turno ENUM('MANHA','TARDE','NOITE') NOT NULL;

-- Conferência: as quatro colunas com enum('MANHA','TARDE','NOITE')
SELECT TABLE_NAME, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'staggy_dev'
   AND COLUMN_NAME = 'turno'
   AND TABLE_NAME IN ('turma', 'materia', 'dia_letivo', 'bloco_aula');
