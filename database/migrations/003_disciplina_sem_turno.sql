-- STAGGY | Migration 003 — Disciplina sem turno e nome único no semestre (CU-020 a CU-022)
-- Task 07.3. O turno passou a ser da turma, não da disciplina: materia.turno
-- passa a aceitar NULL (disciplinas antigas mantêm o valor que tinham). E cada
-- semestre não pode ter duas disciplinas com o mesmo nome.
-- Requer a migration 002. Aplicar uma vez.

USE staggy_dev;

-- 1. Verificação: se já houver nomes repetidos no mesmo semestre, para aqui sem
--    alterar nada (a chave única não poderia ser criada). Para ver os repetidos:
--    SELECT id_semestre, nome, COUNT(*) FROM materia GROUP BY id_semestre, nome HAVING COUNT(*) > 1;
DROP PROCEDURE IF EXISTS verificar_materia_repetida;

DELIMITER //
CREATE PROCEDURE verificar_materia_repetida()
BEGIN
  IF EXISTS (SELECT 1 FROM materia GROUP BY id_semestre, nome HAVING COUNT(*) > 1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Há disciplinas com o mesmo nome no mesmo semestre; renomeie ou exclua as repetidas antes desta migration';
  END IF;
END //
DELIMITER ;

CALL verificar_materia_repetida();
DROP PROCEDURE verificar_materia_repetida;

-- 2. Turno opcional
ALTER TABLE materia MODIFY turno ENUM('MANHA','TARDE','NOITE') NULL;

-- 3. Um nome por semestre
ALTER TABLE materia ADD UNIQUE KEY uq_materia_nome (id_semestre, nome);

-- Conferência: turno com Null = YES e o índice uq_materia_nome criado
SHOW COLUMNS FROM materia LIKE 'turno';
SHOW INDEX FROM materia WHERE Key_name = 'uq_materia_nome';
