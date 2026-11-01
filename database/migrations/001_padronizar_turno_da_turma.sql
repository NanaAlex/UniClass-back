-- STAGGY | Migration 001 — Padronizar o turno da turma (CU-019)
-- Task 07.3. Converte turma.turno de MATUTINO/VERSPERTINO/NOTURNO para
-- MANHA/TARDE/NOITE (o mesmo padrão de materia, dia_letivo e bloco_aula) e cria
-- a chave única do nome da turma no semestre.
-- Aplicar uma vez, em bancos criados antes desta mudança. Bancos criados com o
-- schemas.sql atual já estão neste estado.

USE staggy_dev;

-- 1. ENUM temporário com os valores antigos e os novos, para converter sem perder dados
ALTER TABLE turma MODIFY turno ENUM('MATUTINO','VERSPERTINO','NOTURNO','MANHA','TARDE','NOITE','INTEGRAL') NOT NULL;

-- 2. Conversão (o WHERE atende ao modo de atualização segura do Workbench)
UPDATE turma
   SET turno = CASE turno
                 WHEN 'MATUTINO'    THEN 'MANHA'
                 WHEN 'VERSPERTINO' THEN 'TARDE'
                 WHEN 'NOTURNO'     THEN 'NOITE'
                 ELSE turno
               END
 WHERE id_turma > 0;

-- 3. ENUM final
ALTER TABLE turma MODIFY turno ENUM('MANHA','TARDE','NOITE','INTEGRAL') NOT NULL;

-- 4. Uma letra por semestre (falha se já houver dois nomes iguais no mesmo semestre: renomeie antes)
ALTER TABLE turma ADD UNIQUE KEY uq_turma_nome (id_semestre, nome);

-- Conferência
SHOW COLUMNS FROM turma LIKE 'turno';
SHOW INDEX FROM turma WHERE Key_name = 'uq_turma_nome';
