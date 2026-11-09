-- WineCore · 0050_reconcile_overlay · dialecto DuckDB (ADR 002).
-- DuckDB implementa UPDATE como DELETE + INSERT y lo rechaza si otra fila
-- apunta a la clave, aunque la columna que se cambia no sea la clave.
-- Estas tablas no las referencia nadie: ahí se anota la unión, el nombre
-- y la baja. La ficha original no se toca.

CREATE TABLE catalog.wine_overlay (
  wine_id         uuid PRIMARY KEY,
  merged_into_id  uuid,
  name            VARCHAR,
  hidden          boolean NOT NULL DEFAULT false
);

CREATE TABLE catalog.product_overlay (
  product_id      uuid PRIMARY KEY,
  merged_into_id  uuid,
  wine_id         uuid,
  hidden          boolean NOT NULL DEFAULT false,
  for_sale        boolean
);

CREATE TABLE inventory.lot_overlay (
  lot_id   uuid PRIMARY KEY,
  wine_id  uuid
);

CREATE TABLE cellar.zone_overlay (
  zone_id  uuid PRIMARY KEY,
  name     VARCHAR,
  hidden   boolean NOT NULL DEFAULT false
);

CREATE TABLE cellar.vessel_overlay (
  vessel_id  uuid PRIMARY KEY,
  status     VARCHAR
);

CREATE VIEW catalog.wine_visible AS
SELECT w.id, w.code, COALESCE(o.name, w.name) AS name, w.color, w.category, w.pdo_pgi_name,
       w.is_single_plot, w.is_organic, w.no_added_sulfites, w.description,
       (w.is_active AND NOT COALESCE(o.hidden, FALSE)) AS is_active, w.created_at
FROM catalog.wine w
LEFT JOIN catalog.wine_overlay o ON o.wine_id = w.id;
