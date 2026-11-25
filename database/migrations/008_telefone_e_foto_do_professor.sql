-- STAGGY | Migration 008 — Telefone e foto do professor
-- Task 20 (tela de perfil do professor). O professor informa o próprio telefone
-- e a própria foto, que o administrador vê na tela Professores e que não
-- existiam no banco. Quatro colunas opcionais em professor:
--   telefone     VARCHAR(11)  : só dígitos, DDD + número, 10 ou 11 dígitos
--                               (ex.: 11987654321); o DDD não começa nem termina em 0
--   foto         MEDIUMBLOB   : a imagem, guardada no próprio banco (sem serviço de
--                               arquivos); até 2 MB, o mesmo limite da tela
--   foto_tipo    VARCHAR(20)  : formato da imagem, para o back devolvê-la
--                               (image/jpeg, image/png ou image/webp)
--   foto_versao  CHAR(32)     : MD5 da imagem, calculado pelo back no envio. Vai no
--                               JSON (fotoVersao) e no ?v= da URL da foto; guardado
--                               para não reler a imagem a cada consulta
-- Opcionais (RN-38): o professor não é obrigado a informar.
-- Independe da 005 (motor Prolog), da 006 e da 007.
-- Aplicar uma vez, em cada banco (troque o USE abaixo para staggy_prod na produção).

USE staggy_dev;

-- 1. Verificação: se alguma das colunas já existir, para aqui sem alterar nada
DROP PROCEDURE IF EXISTS verificar_telefone_foto_professor;

DELIMITER //
CREATE PROCEDURE verificar_telefone_foto_professor()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'professor'
                AND COLUMN_NAME IN ('telefone', 'foto', 'foto_tipo', 'foto_versao')) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'professor já tem telefone, foto, foto_tipo ou foto_versao; esta migration já foi aplicada';
  END IF;
END //
DELIMITER ;

CALL verificar_telefone_foto_professor();
DROP PROCEDURE verificar_telefone_foto_professor;

-- 2. Colunas e regras: foto, formato e versão andam juntos; só JPG, PNG e WebP; até 2 MB
ALTER TABLE professor
  ADD COLUMN telefone VARCHAR(11) NULL AFTER titulacao,
  ADD COLUMN foto MEDIUMBLOB NULL AFTER telefone,
  ADD COLUMN foto_tipo VARCHAR(20) NULL AFTER foto,
  ADD COLUMN foto_versao CHAR(32) NULL AFTER foto_tipo,
  ADD CONSTRAINT ck_professor_telefone CHECK (telefone IS NULL OR telefone REGEXP '^[1-9]{2}[0-9]{8,9}$'),
  ADD CONSTRAINT ck_professor_foto CHECK ((foto IS NULL) = (foto_tipo IS NULL) AND (foto IS NULL) = (foto_versao IS NULL)),
  ADD CONSTRAINT ck_professor_foto_tipo CHECK (foto_tipo IS NULL OR foto_tipo IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT ck_professor_foto_tamanho CHECK (foto IS NULL OR OCTET_LENGTH(foto) <= 2097152);

-- Conferência: as quatro colunas com Null = YES e as quatro regras
SHOW COLUMNS FROM professor WHERE Field IN ('telefone', 'foto', 'foto_tipo', 'foto_versao');
SELECT CONSTRAINT_NAME, CHECK_CLAUSE
  FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE()
   AND CONSTRAINT_NAME LIKE 'ck_professor_%';
