-- Cata de uva estructurada en el control de maduración (§15).
-- Sin NOT NULL: DuckDB 1.5 no añade columnas con esa restricción. La API valida las escalas.

ALTER TABLE vineyard.maturity_check ADD COLUMN seed_color VARCHAR;
ALTER TABLE vineyard.maturity_check ADD COLUMN seed_crunch BOOLEAN;
ALTER TABLE vineyard.maturity_check ADD COLUMN skin_astringency SMALLINT;
ALTER TABLE vineyard.maturity_check ADD COLUMN skin_color_release SMALLINT;
ALTER TABLE vineyard.maturity_check ADD COLUMN pulp_sweetness SMALLINT;
ALTER TABLE vineyard.maturity_check ADD COLUMN pulp_acidity SMALLINT;
ALTER TABLE vineyard.maturity_check ADD COLUMN phenolic_maturity SMALLINT;
ALTER TABLE vineyard.maturity_check ADD COLUMN photo_attachment_id UUID;
