-- MCP con todo lo de la app (petición de Pedro, 01-11-2026): CVBOT tiene que poder hacer
-- desde el móvil todo lo que se hace en la web.

-- Alcances concedidos a un cliente MCP además de los de su alta. El token no cambia.
-- Sin FK hacia core.api_client: DuckDB rehace como delete+insert el UPDATE de una lista en
-- una fila referenciada (core.api_token apunta al cliente), así que core.api_client.scopes
-- no se puede ampliar en su sitio.
CREATE TABLE core.api_client_grant (
  client_id  uuid PRIMARY KEY,
  scopes     VARCHAR[] NOT NULL,
  reason     VARCHAR NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pedro-owner: todos los módulos y acciones. Cada llamada sigue limitada por los roles de la
-- persona representada y por las reglas de la app (quién aprueba, passkey si el propietario
-- la exige).
INSERT INTO core.api_client_grant (client_id, scopes, reason)
SELECT id,
       ['read:*', 'write:*', 'manage:*', 'approve:*', 'issue:*',
        'void:*', 'deliver:*', 'count:*', 'operate:*', 'prepare:*']::VARCHAR[],
       'Petición de Pedro (01-11-2026): CVBOT hace por MCP todo lo de la app'
FROM core.api_client
WHERE id = CAST('01a1964b-983d-7287-9926-4014235bf55d' AS UUID)
  AND revoked_at IS NULL;

-- Las herramientas MCP de un módulo solo se listan con el módulo activo, y la app no oculta
-- ninguna de estas pantallas. Se activan los que no tienen fila; uno que el propietario haya
-- desactivado sigue desactivado.
INSERT INTO core.module_state (module_key, enabled, changed_by)
SELECT m.module_key, TRUE, 'migracion 0043'
FROM (VALUES ('contacts'), ('catalog'), ('sales'), ('billing'), ('purchasing'),
             ('inventory'), ('cellar'), ('vineyard'), ('finance')) AS m(module_key)
WHERE NOT EXISTS (SELECT 1 FROM core.module_state s WHERE s.module_key = m.module_key);
