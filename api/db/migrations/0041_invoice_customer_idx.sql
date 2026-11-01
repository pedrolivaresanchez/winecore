-- WineCore · 0041_invoice_customer_idx · dialecto DuckDB (ADR 002).
-- Vuelve el índice que 0040 quitó para alterar billing.invoice.series_id.

CREATE INDEX invoice_customer_idx ON billing.invoice(customer_id, issue_date);
