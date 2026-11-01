-- MCP con todo lo de la app (petición de Pedro, 01-11-2026): CVBOT tiene que poder hacer
-- desde el móvil todo lo que se hace en la web.

-- El cliente pedro-owner pasa a tener los alcances de todos los módulos y acciones. El token
-- no cambia. Cada llamada sigue limitada por los roles de la persona representada y por las
-- reglas de la app (quién aprueba, passkey si el propietario la exige).
UPDATE core.api_client
SET scopes = [
  'read:*', 'write:*', 'manage:*', 'approve:*', 'issue:*',
  'void:*', 'deliver:*', 'count:*', 'operate:*', 'prepare:*'
]::VARCHAR[]
WHERE id = CAST('01a1964b-983d-7287-9926-4014235bf55d' AS UUID)
  AND revoked_at IS NULL;

-- Las herramientas MCP de un módulo solo se listan con el módulo activo, y la app no oculta
-- ninguna de estas pantallas. Se activan los que no tienen fila; uno que el propietario haya
-- desactivado sigue desactivado.
INSERT INTO core.module_state (module_key, enabled, changed_by)
SELECT m.module_key, TRUE, 'migracion 0042'
FROM (VALUES ('contacts'), ('catalog'), ('sales'), ('billing'), ('purchasing'),
             ('inventory'), ('cellar'), ('vineyard'), ('finance')) AS m(module_key)
WHERE NOT EXISTS (SELECT 1 FROM core.module_state s WHERE s.module_key = m.module_key);
