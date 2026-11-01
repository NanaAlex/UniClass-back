-- STAGGY | Migration 004 — Formulário sem semestre (CU-023 a CU-025)
-- Task 07.3. O formulário cobre o curso inteiro: semestres, turmas e
-- disciplinas são do administrador, e o professor filtra as disciplinas por
-- semestre ao preencher. formulario.id_semestre passa a aceitar NULL
-- (formulários antigos mantêm o semestre que tinham).
-- Requer a migration 003. Aplicar uma vez.

USE staggy_dev;

-- 1. Verificação: nada a conferir. Tornar a coluna opcional não falha com os
--    dados existentes e a chave estrangeira continua valendo para quem a preencher.

-- 2. Semestre opcional
ALTER TABLE formulario MODIFY id_semestre INT NULL;

-- Conferência: id_semestre com Null = YES
SHOW COLUMNS FROM formulario LIKE 'id_semestre';
