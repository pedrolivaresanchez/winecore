-- WineCore · 0054_payment_method_alias · dialecto DuckDB (ADR 002).
-- DuckDB no puede ampliar el CHECK de finance.payment.method (queda en 0011).
-- Bizum se guarda aquí y method queda en 'other'. La API lo devuelve como bizum.

ALTER TABLE finance.payment ADD COLUMN method_alias VARCHAR;
