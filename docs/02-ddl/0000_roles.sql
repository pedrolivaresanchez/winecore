-- =====================================================================
-- WineCore · 0000 · roles de base de datos (lo ejecuta un administrador UNA vez por servidor)
-- ADR 002 §3. Las contraseñas se fijan fuera de este fichero (gestor de secretos):
--   ALTER ROLE winecore_migrator PASSWORD '…';  ALTER ROLE winecore_app PASSWORD '…';  ALTER ROLE winecore_readonly PASSWORD '…';
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'winecore_migrator') THEN
    CREATE ROLE winecore_migrator LOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'winecore_app') THEN
    CREATE ROLE winecore_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'winecore_readonly') THEN
    CREATE ROLE winecore_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
