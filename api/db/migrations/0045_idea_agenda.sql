-- WineCore · 0045_idea_agenda · dialecto DuckDB (ADR 002).
-- Agenda de ideas: notas sueltas que luego se fechan como cita (appointment)
-- o como proceso (process). No toca facturas, presupuestos ni códigos de IVA.
-- En producción (Knowledge Base de Timbal) esta migración se aplica aparte:
-- el arranque solo migra cuando DB_MODE=local.
--
-- DuckDB no admite claves foráneas entre esquemas ni DROP CONSTRAINT (0020).
-- Los enlaces a contacto, factura, presupuesto y cata son uuid opcionales;
-- el núcleo comprueba que existan. Para enlazar otro documento, añade otra
-- columna uuid nullable y su comprobación en api/src/core/agenda/ideas.ts.
--
-- El CHECK de core.module_state no se puede ampliar in situ. Se recrea la
-- tabla (mismas columnas) para admitir el módulo `agenda`, copiando las filas.
-- Un módulo que el propietario haya apagado sigue apagado.

CREATE TABLE core.module_state_agenda (
  module_key  VARCHAR PRIMARY KEY CHECK (module_key IN (
                'contacts','catalog','sales','billing','verifactu','purchasing','inventory','cellar',
                'vineyard','finance','accounting','silicie','sisv','emcs','edi','organic','labels',
                'knowledge','mcp','assistant','watchers','agenda')),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  config      JSON NOT NULL DEFAULT '{}'::JSON,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  VARCHAR NOT NULL
);

INSERT INTO core.module_state_agenda (module_key, enabled, config, changed_at, changed_by)
SELECT module_key, enabled, config, changed_at, changed_by FROM core.module_state;

DROP TABLE core.module_state;

ALTER TABLE core.module_state_agenda RENAME TO module_state;

INSERT INTO core.module_state (module_key, enabled, changed_by)
SELECT 'agenda', TRUE, 'migracion 0045'
WHERE NOT EXISTS (SELECT 1 FROM core.module_state WHERE module_key = 'agenda');

CREATE SCHEMA agenda;

-- La fila no se borra: archivar pone archived_at (WC001, sin DELETE de negocio).
-- calendar_exported_at y calendar_external_id los rellena un conector futuro.
-- Esta migración no llama a Outlook ni guarda credenciales.
CREATE TABLE agenda.idea (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                         VARCHAR NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  note                          VARCHAR CHECK (note IS NULL OR length(note) <= 4000),
  status                        VARCHAR NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','planned','done')),
  kind                          VARCHAR CHECK (kind IS NULL OR kind IN ('appointment','process')),
  scheduled_at                  TIMESTAMPTZ,
  contact_id                    UUID,
  invoice_id                    UUID,
  quote_id                      UUID,
  tasting_note_id               UUID,
  calendar_provider             VARCHAR CHECK (calendar_provider IS NULL OR calendar_provider IN ('outlook')),
  calendar_external_id          VARCHAR CHECK (calendar_external_id IS NULL OR length(calendar_external_id) BETWEEN 1 AND 200),
  calendar_exported_at          TIMESTAMPTZ,
  calendar_export_requested_at  TIMESTAMPTZ,
  source                        VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_by                    VARCHAR NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at                   TIMESTAMPTZ,
  archived_by                   VARCHAR,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  CHECK (calendar_exported_at IS NULL OR calendar_external_id IS NOT NULL),
  CHECK (calendar_external_id IS NULL OR calendar_provider IS NOT NULL),
  CHECK (calendar_exported_at IS NULL OR (kind = 'appointment' AND scheduled_at IS NOT NULL)),
  CHECK (calendar_export_requested_at IS NULL OR (kind = 'appointment' AND scheduled_at IS NOT NULL))
);

CREATE INDEX agenda_idea_status_idx ON agenda.idea(status, created_at);
CREATE INDEX agenda_idea_schedule_idx ON agenda.idea(scheduled_at);
CREATE INDEX agenda_idea_contact_idx ON agenda.idea(contact_id);
CREATE INDEX agenda_idea_invoice_idx ON agenda.idea(invoice_id);
CREATE INDEX agenda_idea_quote_idx ON agenda.idea(quote_id);
CREATE INDEX agenda_idea_tasting_idx ON agenda.idea(tasting_note_id);
