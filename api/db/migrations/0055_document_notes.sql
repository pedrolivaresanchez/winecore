-- WineCore · 0055_document_notes · dialecto DuckDB (ADR 002).
-- La nota que ya existía es interna y no se imprime.
-- customer_note es el texto explícito para el cliente (un obsequio, una cortesía).
-- Solo se promociona una línea que, ella sola, es un obsequio o una cortesía
-- y no habla de tarifa, almacén, borrador ni de un identificador interno.
-- Así «Obsequio Pack Navidad 2026 (PACK-NAV-2026)» sigue en el PDF y el
-- párrafo operativo de un albarán no. El JSON de una devolución no se toca.

ALTER TABLE sales.quote ADD COLUMN customer_note VARCHAR;
ALTER TABLE sales.sales_order ADD COLUMN customer_note VARCHAR;
ALTER TABLE sales.delivery_note ADD COLUMN customer_note VARCHAR;
ALTER TABLE billing.invoice ADD COLUMN customer_note VARCHAR;

-- split-macros
CREATE TEMP MACRO fold_note(line) AS lower(
  replace(replace(replace(replace(replace(line, 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u')
);
CREATE TEMP MACRO gift_line(line) AS (
  length(trim(line)) BETWEEN 1 AND 240
  AND regexp_matches(fold_note(trim(line)), '^(obsequio|regalo|cortesia)( |$)')
  AND NOT regexp_matches(
    fold_note(trim(line)),
    'borrador|tarifa|traspaso|condicionado|sustituye|deposito|transportista|almacen|nacex|\bdestino\b|\borigen\b|pendiente|uuid|[0-9a-f]{8}-[0-9a-f]{4}-|sin facturar|no incluye'
  )
);
CREATE TEMP MACRO note_lines(raw) AS string_split_regex(replace(trim(raw), chr(13), ''), '\n');
CREATE TEMP MACRO customer_note_of(raw) AS (
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE string_agg(trim(line), chr(10) ORDER BY ord) END
  FROM (
    SELECT unnest(note_lines(raw)) AS line, generate_subscripts(note_lines(raw), 1) AS ord
  ) lines
  WHERE gift_line(line)
);
CREATE TEMP MACRO internal_note_of(raw) AS (
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE string_agg(trim(line), chr(10) ORDER BY ord) END
  FROM (
    SELECT unnest(note_lines(raw)) AS line, generate_subscripts(note_lines(raw), 1) AS ord
  ) lines
  WHERE trim(line) <> '' AND NOT gift_line(line)
);
-- end-split-macros

UPDATE sales.quote
SET customer_note = customer_note_of(notes), notes = internal_note_of(notes)
WHERE notes IS NOT NULL AND NOT starts_with(trim(notes), '{') AND customer_note_of(notes) IS NOT NULL;

UPDATE sales.sales_order
SET customer_note = customer_note_of(notes), notes = internal_note_of(notes)
WHERE notes IS NOT NULL AND NOT starts_with(trim(notes), '{') AND customer_note_of(notes) IS NOT NULL;

UPDATE sales.delivery_note
SET customer_note = customer_note_of(notes), notes = internal_note_of(notes)
WHERE notes IS NOT NULL AND NOT starts_with(trim(notes), '{') AND customer_note_of(notes) IS NOT NULL;

UPDATE billing.invoice
SET customer_note = customer_note_of(notes), notes = internal_note_of(notes)
WHERE notes IS NOT NULL AND NOT starts_with(trim(notes), '{') AND customer_note_of(notes) IS NOT NULL;

DROP MACRO IF EXISTS customer_note_of;
DROP MACRO IF EXISTS internal_note_of;
DROP MACRO IF EXISTS note_lines;
DROP MACRO IF EXISTS gift_line;
DROP MACRO IF EXISTS fold_note;
