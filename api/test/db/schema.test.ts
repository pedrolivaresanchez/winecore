import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { migrate } from "../../db/migrate";
import type { KbClient } from "../../src/core/db/client";
import { referenceObjects } from "./parse_reference";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Diferencias intencionadas. La comparación de columnas no omite ninguna
 * de la referencia. EXTRA_COLUMNS solo admite columnas que una migración
 * posterior añade sobre una tabla ya descrita en docs/02-ddl.
 *
 * - citext → VARCHAR con CHECK (col = lower(col))
 * - jsonb → JSON; bytea → BLOB; numeric(p,s) → DECIMAL(p,s); text → VARCHAR
 * - char(n) → VARCHAR (DuckDB no conserva la longitud de CHAR)
 * - inet → VARCHAR (core.session.ip, ops.approval_decision.ip)
 * - text[] → VARCHAR[]; uuid[] → UUID[]
 * - bigserial → BIGINT DEFAULT nextval(secuencia) en audit.audit_log y ops.outbox_event
 * - clock_timestamp() → now() en audit.audit_log.occurred_at
 * - sin disparadores, funciones, GRANT, índices parciales ni EXCLUDE
 * - sin UNIQUE en columnas que se actualizan cuando la fila ya está referenciada
 * - sin FK entre esquemas y sin las FK de cierre que la referencia añade con ALTER TABLE
 * - billing.v_receivable agrupa por todas las columnas seleccionadas
 * - el CHECK de finance.payment_allocation ya incluye legacy.open_item en 0011
 */
const MISSING_COLUMNS: Record<string, readonly string[]> = {
  // ninguna columna de la referencia se omite
};
const EXTRA_COLUMNS: Record<string, readonly string[]> = {
  "vineyard.parcel": ["appellation", "organic_status", "conversion_started_on"],
  "vineyard.maturity_check": [
    "sugar_gl", "ph", "seed_color", "seed_crunch", "skin_astringency", "skin_color_release",
    "pulp_sweetness", "pulp_acidity", "phenolic_maturity", "photo_attachment_id",
  ],
  "inventory.lot": ["segregated"],
  // TASK-VIN-002 amplía vineyard.treatment sin reescribir el DDL de referencia.
  "vineyard.treatment": [
    "active_substances",
    "applicator_ropo",
    "application_timing",
    "campaign",
    "crop",
    "group_id",
    "max_dose",
    "max_dose_unit",
    "notebook_product_id",
    "nutrient_npk",
    "quantity_unit",
    "record_kind",
    "safety_interval_days",
    "total_quantity",
    "variety",
    "weather_notes",
  ],
};

function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'" && sql[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === ";") {
      parts.push(sql.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (sql.slice(start).trim()) parts.push(sql.slice(start));
  return parts;
}

async function apply(conn: { run: (sql: string) => Promise<unknown> }, label: string, sql: string) {
  for (const stmt of splitSql(sql)) {
    const code = stmt.replace(/--[^\n]*/g, "").trim();
    if (!code) continue;
    try {
      await conn.run(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label}\n${code.slice(0, 500)}\n${message.split("\n").slice(0, 8).join("\n")}`);
    }
  }
}

const u = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = "ab".repeat(32);
const shaUp = "AB".repeat(32);

function sampleSql(): string {
  return `
INSERT INTO core.legal_entity (id, code, legal_name, tax_id, person_type, income_tax, address_line, postal_code, city, province)
VALUES ('${u(1)}', 'PO', 'Entidad Sintetica PO', '00000000T', 'natural', 'IRPF', 'Calle Ejemplo 1', '00000', 'Ciudad', 'Provincia');
INSERT INTO core.legal_entity (id, code, legal_name, tax_id, person_type, income_tax, address_line, postal_code, city, province)
VALUES ('${u(2)}', 'CVPO', 'Entidad Sintetica CV', 'B00000000', 'legal', 'IS', 'Calle Ejemplo 1', '00000', 'Ciudad', 'Provincia');
INSERT INTO core.app_user (id, email, display_name, status) VALUES ('${u(3)}', 'ana@example.com', 'Ana Sintetica', 'active');
INSERT INTO core.user_role (id, user_id, role_code) VALUES ('${u(4)}', '${u(3)}', 'owner');
INSERT INTO core.user_credential (id, user_id, kind, label, credential_id, public_key)
VALUES ('${u(5)}', '${u(3)}', 'passkey', 'llave', 'cred-sintetico', from_base64('AA=='));
INSERT INTO core.session (id, user_id, token_hash, expires_at) VALUES ('${u(6)}', '${u(3)}', from_base64('AQ=='), '2027-12-31 00:00:00+00');
INSERT INTO core.api_client (id, code, role_code, description, scopes) VALUES ('${u(7)}', 'cvbot', 'agent', 'Cliente sintetico', ['read:*']);
INSERT INTO core.api_token (id, client_id, token_hash, prefix, expires_at)
VALUES ('${u(8)}', '${u(7)}', from_base64('Ag=='), 'wc_live_AbCdEf', '2027-12-31 00:00:00+00');
INSERT OR REPLACE INTO core.module_state (module_key, enabled, changed_by) VALUES ('contacts', true, 'test');
INSERT INTO core.setting (key, value, updated_by) VALUES ('ui.locale', '{"lang":"es"}'::JSON, 'test');
INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix)
VALUES ('${u(9)}', '${u(1)}', 'invoice', 'A', 2027, 'CF27');
INSERT INTO core.attachment (id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes, created_by)
VALUES ('${u(10)}', '${sha}', 'knowledge_base', '${sha}', 'f.pdf', 'application/pdf', 1, 'test');
INSERT INTO core.attachment_content (sha256, content) VALUES ('${sha}', from_base64('AA=='));
INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
VALUES ('${u(11)}', '${u(10)}', 'party.contact', '${u(12)}', 'other', 'test');
INSERT INTO core.notification (id, user_id, kind, title, body) VALUES ('${u(13)}', '${u(3)}', 'info', 'Aviso', 'Texto');
INSERT INTO audit.audit_log (actor_type, actor_id, action, table_name, hash)
VALUES ('user', 'test', 'INSERT', 'core.legal_entity', from_base64('BA=='));

INSERT INTO ops.approval_policy (id, kind, updated_by) VALUES ('${u(20)}', 'module_toggle', 'test');
INSERT INTO ops.approval_request (id, kind, subject_table, subject_id, payload_sha256, summary, requested_by, expires_at)
VALUES ('${u(21)}', 'module_toggle', 'billing.invoice', '${u(70)}', '${sha}', 'Activar modulo de prueba', 'test', '2027-12-31 00:00:00+00');
INSERT INTO ops.approval_decision (id, request_id, decided_by, decision, payload_sha256)
VALUES ('${u(22)}', '${u(21)}', '${u(3)}', 'approve', '${sha}');
INSERT INTO ops.outbox_event (event_type, aggregate_table, aggregate_id, payload)
VALUES ('billing.invoice.issued', 'billing.invoice', '${u(70)}', '{}'::JSON);
INSERT INTO ops.idempotency_key (key, principal, route, request_sha256) VALUES ('idem-0001', 'user:test', '/api/v1/x', '${sha}');
INSERT INTO ops.mcp_confirmation (id, token_hash, tool_name, args_sha256, client_id, preview, created_at, expires_at)
VALUES ('${u(23)}', from_base64('BQ=='), 'ping', '${sha}', '${u(7)}', '{}'::JSON, '2027-01-15 10:00:00+00', '2027-01-15 10:05:00+00');
INSERT INTO ops.job_run (id, job_name) VALUES ('${u(24)}', 'audit-verify');

INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, created_by)
VALUES ('${u(12)}', 'company', 'Bodega Ejemplo', 'B00000000', 'nif', 'test');
INSERT INTO party.contact (id, kind, legal_name, tax_id_type, created_by)
VALUES ('${u(14)}', 'company', 'Otra Bodega', 'none', 'test');
INSERT INTO party.contact_address (id, contact_id, kind, line1, postal_code, city, country_code)
VALUES ('${u(15)}', '${u(12)}', 'billing', 'Calle Ejemplo 1', '00000', 'Ciudad', 'ES');
INSERT INTO party.contact_person (id, contact_id, full_name, email) VALUES ('${u(16)}', '${u(12)}', 'Ana Sintetica', 'ana.contacto@example.com');
INSERT INTO party.contact_entity_terms (contact_id, legal_entity_id) VALUES ('${u(12)}', '${u(1)}');
INSERT INTO party.contact_gln (id, contact_id, role, gln) VALUES ('${u(17)}', '${u(12)}', 'buyer', '0000000000000');
INSERT INTO party.contact_merge (id, survivor_id, merged_id, rule, field_choices, merged_by)
VALUES ('${u(18)}', '${u(12)}', '${u(14)}', 'manual', '{}'::JSON, 'test');

INSERT INTO catalog.wine (id, code, name, color) VALUES ('${u(30)}', 'ARCAL', 'Arcal', 'red');
INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml) VALUES ('${u(31)}', 'B075', 'Botella 75 cl', 'bottle', 750);
INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, requires_lot)
VALUES ('${u(32)}', 'ARCAL075', 'Arcal 75 cl', 'wine', '${u(30)}', 2026, '${u(31)}', true);
INSERT INTO catalog.price_list (id, code, name) VALUES ('${u(33)}', 'final', 'Tarifa final');
INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, created_by)
VALUES ('${u(34)}', '${u(33)}', 1, '2027-01-01', 'test');
INSERT INTO catalog.price_list_item (id, version_id, product_id, unit_price) VALUES ('${u(35)}', '${u(34)}', '${u(32)}', 10);
INSERT INTO catalog.gtin_current (gtin, product_id, updated_by) VALUES ('00000000', '${u(32)}', 'test');
INSERT INTO catalog.customer_item_code (contact_id, product_id, code) VALUES ('${u(12)}', '${u(32)}', 'ART-1');
INSERT INTO catalog.intercompany_tariff (id, seller_entity_id, buyer_entity_id, base_price_list_id, discount_pct, valid_from, advisor_validation, created_by)
VALUES ('${u(36)}', '${u(1)}', '${u(2)}', '${u(33)}', 10, '2027-01-01', 'asesor 2027', 'test');
INSERT INTO catalog.standard_cost (id, product_id, valid_from, unit_cost, source, created_by)
VALUES ('${u(37)}', '${u(32)}', '2027-01-01', 4, 'manual', 'test');

INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name)
VALUES ('${u(40)}', '${u(1)}', 'ES00000V0000T', 'V1', 'Bodega');
INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id) VALUES ('${u(41)}', 'BOD', 'Bodega', 'cellar', '${u(1)}');
INSERT INTO inventory.lot (id, producer_entity_id, code, kind, origin) VALUES ('${u(42)}', '${u(1)}', 'LOTE-01', 'wine', 'opening_count');
INSERT INTO inventory.lot (id, producer_entity_id, code, kind, origin) VALUES ('${u(43)}', '${u(1)}', 'LOTE-02', 'wine', 'operation');
INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id) VALUES ('${u(50)}', 'INOX-01', 'Inox 1', 'tank_storage', 10000000, 'stainless_steel', '${u(41)}');
INSERT INTO cellar.operation (id, legal_entity_id, op_type, occurred_at, performed_by, created_by)
VALUES ('${u(51)}', '${u(1)}', 'racking', '2027-01-15 10:00:00+00', 'Ana', 'test');
INSERT INTO inventory.lot_edge (child_lot_id, parent_lot_id, operation_id, volume_ml) VALUES ('${u(43)}', '${u(42)}', '${u(51)}', 1000);
INSERT INTO cellar.operation_line (id, operation_id, role, lot_id, vessel_id, product_state, volume_ml)
VALUES ('${u(52)}', '${u(51)}', 'input', '${u(42)}', '${u(50)}', 'wine', 1000);
INSERT INTO cellar.addition (id, operation_id, lot_id, additive_product_id, quantity, quantity_unit, dose, dose_unit, purpose)
VALUES ('${u(53)}', '${u(51)}', '${u(42)}', '${u(32)}', 1, 'g', 1, 'g/hl', 'sulphiting');
INSERT INTO cellar.cleaning_record (id, operation_id, vessel_id, product_id, active_substance, quantity, quantity_unit, efficacy_check)
VALUES ('${u(54)}', '${u(51)}', '${u(50)}', '${u(32)}', 'peracetico', 1, 'ml', 'visual');
INSERT INTO cellar.analysis (id, lot_id, kind, sampled_at, lab, created_by)
VALUES ('${u(55)}', '${u(42)}', 'control', '2027-01-15 10:00:00+00', 'internal', 'test');
INSERT INTO cellar.analysis_result (id, analysis_id, parameter_code, value) VALUES ('${u(56)}', '${u(55)}', 'density', 1.01);
INSERT INTO cellar.fermentation_reading (id, lot_id, vessel_id, measured_at, density, measured_by)
VALUES ('${u(57)}', '${u(42)}', '${u(50)}', '2027-01-15 11:00:00+00', 1.05, 'Ana');
INSERT INTO cellar.tasting (id, lot_id, tasted_at, author, notes) VALUES ('${u(58)}', '${u(42)}', '2027-01-15 12:00:00+00', 'Ana', 'Fruta');
INSERT INTO cellar.material_consumption (id, operation_id, product_id, quantity) VALUES ('${u(59)}', '${u(51)}', '${u(32)}', 1);

INSERT INTO inventory.period_lock (ledger, locked_until, locked_by, reason) VALUES ('physical', '2020-01-01', 'test', 'cierre de prueba');
INSERT INTO inventory.stock_move (id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state, volume_ml, source_table, source_id, created_by)
VALUES ('${u(44)}', '2027-01-15 10:00:00+00', 'opening', '${u(41)}', '${u(50)}', '${u(1)}', '${u(42)}', 'wine', 1000, 'cellar.operation', '${u(51)}', 'test');
INSERT INTO inventory.fiscal_move (id, tax_warehouse_id, fiscal_date, move_type, product_class, volume_ml, justification_type, justification_ref, fiscal_trigger, source_table, source_id, created_by)
VALUES ('${u(45)}', '${u(40)}', '2027-01-15', 'opening', 'bulk', 1000, 'internal', 'APERTURA', 'count', 'inventory.inventory_count', '${u(46)}', 'test');
INSERT INTO inventory.inventory_count (id, legal_entity_id, kind, counted_at, location_ids, created_by)
VALUES ('${u(46)}', '${u(1)}', 'spot', '2027-01-15 10:00:00+00', CAST(['${u(41)}'] AS UUID[]), 'test');
INSERT INTO inventory.inventory_count_line (id, count_id, location_id, owner_entity_id, product_state)
VALUES ('${u(47)}', '${u(46)}', '${u(41)}', '${u(1)}', 'goods');

INSERT INTO sales.quote (id, legal_entity_id, customer_id, channel, created_by) VALUES ('${u(60)}', '${u(1)}', '${u(12)}', 'direct', 'test');
INSERT INTO sales.quote_line (id, quote_id, line_no, description, quantity, unit_price, tax_code)
VALUES ('${u(61)}', '${u(60)}', 1, 'Vino', 1, 10, 'IVA21');
INSERT INTO sales.sales_order (id, customer_id, channel, source, order_date, created_by) VALUES ('${u(62)}', '${u(12)}', 'direct', 'manual', '2027-01-15', 'test');
INSERT INTO sales.sales_order_line (id, order_id, line_no, product_id, description, quantity, unit_price, tax_code)
VALUES ('${u(63)}', '${u(62)}', 1, '${u(32)}', 'Vino', 1, 10, 'IVA21');
INSERT INTO sales.delivery_note (id, legal_entity_id, kind, customer_id, from_location_id, created_by)
VALUES ('${u(64)}', '${u(1)}', 'sale', '${u(12)}', '${u(41)}', 'test');
INSERT INTO sales.delivery_note_line (id, delivery_note_id, line_no, order_line_id, product_id, description, quantity)
VALUES ('${u(65)}', '${u(64)}', 1, '${u(63)}', '${u(32)}', 'Vino', 1);
INSERT INTO sales.handling_unit (id, delivery_note_id, kind, sscc, contents) VALUES ('${u(66)}', '${u(64)}', 'pallet', '000000000000000000', '[]'::JSON);
INSERT INTO sales.shipping_incident (id, delivery_note_id, kind, reported_at, description, created_by)
VALUES ('${u(67)}', '${u(64)}', 'breakage', '2027-01-16 10:00:00+00', 'Rotura', 'test');

INSERT INTO billing.billing_rule_set (id, version, created_by) VALUES ('${u(68)}', 1, 'test');
INSERT INTO billing.billing_rule (id, rule_set_id, scope, issuing_entity_id) VALUES ('${u(69)}', '${u(68)}', 'default', '${u(1)}');
INSERT INTO billing.invoice (id, legal_entity_id, series_id, invoice_type, customer_id, created_by)
VALUES ('${u(70)}', '${u(1)}', '${u(9)}', 'F1', '${u(12)}', 'test');
INSERT INTO billing.invoice_line (id, invoice_id, line_no, description, quantity, unit_price, line_base, tax_code)
VALUES ('${u(71)}', '${u(70)}', 1, 'Vino', 1, 10, 10, 'IVA21');
INSERT INTO billing.invoice_tax (id, invoice_id, tax_code, tax, regime_key, qualification, rate, base, quota)
VALUES ('${u(72)}', '${u(70)}', 'IVA21', '01', '01', 'S1', 21, 10, 2.10);
INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount) VALUES ('${u(73)}', '${u(70)}', 1, '2027-02-15', 12.10);
INSERT INTO billing.invoice (id, legal_entity_id, series_id, invoice_type, rectification_kind, customer_id, created_by)
VALUES ('${u(74)}', '${u(1)}', '${u(9)}', 'R1', 'S', '${u(12)}', 'test');
INSERT INTO billing.invoice_rectification (id, rectifying_invoice_id, rectified_number, rectified_issue_date, rectified_issuer_tax_id, relation, reason)
VALUES ('${u(75)}', '${u(74)}', 'F-1', '2027-01-01', '00000000T', 'rectified', 'error de importe');
INSERT INTO billing.intercompany_settlement (id, seller_entity_id, buyer_entity_id, period_start, period_end)
VALUES ('${u(76)}', '${u(1)}', '${u(2)}', '2027-01-01', '2027-01-31');
INSERT INTO billing.intercompany_settlement_line (id, settlement_id, source_table, source_id, product_id, quantity, base_unit_price, discount_pct, unit_price, occurred_at)
VALUES ('${u(77)}', '${u(76)}', 'billing.invoice_line', '${u(71)}', '${u(32)}', 1, 10, 10, 9, '2027-01-15 10:00:00+00');

INSERT INTO purchasing.supplier_invoice (id, legal_entity_id, source, created_by) VALUES ('${u(80)}', '${u(1)}', 'upload', 'test');
INSERT INTO purchasing.supplier_invoice_line (id, supplier_invoice_id, line_no, description, expense_account, quantity, unit_price, line_base, vat_quota)
VALUES ('${u(81)}', '${u(80)}', 1, 'Uva', '602', 1, 10, 10, 2.10);

INSERT INTO finance.bank_account (id, legal_entity_id, bank_name, iban_enc, iban_last4) VALUES ('${u(82)}', '${u(1)}', 'Banco', from_base64('AA=='), '0000');
INSERT INTO finance.payment (id, legal_entity_id, direction, method, amount, value_date, source, created_by)
VALUES ('${u(83)}', '${u(1)}', 'in', 'transfer', 10, '2027-01-20', 'manual', 'test');
INSERT INTO finance.payment_allocation (id, payment_id, target_table, target_id, amount, allocated_by)
VALUES ('${u(84)}', '${u(83)}', 'billing.invoice', '${u(70)}', 1, 'test');
INSERT INTO finance.bank_statement_import (id, bank_account_id, format, attachment_id, file_sha256, period_from, period_to, lines_count, imported_by)
VALUES ('${u(85)}', '${u(82)}', 'n43', '${u(10)}', '${sha}', '2027-01-01', '2027-01-31', 1, 'test');
INSERT INTO finance.bank_statement_line (id, import_id, bank_account_id, booking_date, amount, description, external_id)
VALUES ('${u(86)}', '${u(85)}', '${u(82)}', '2027-01-20', 10, 'Abono', 'linea-1');
INSERT INTO finance.remittance (id, legal_entity_id, kind, bank_account_id, execution_date, created_by)
VALUES ('${u(87)}', '${u(1)}', 'credit_transfer', '${u(82)}', '2027-01-25', 'test');
INSERT INTO finance.remittance_item (id, remittance_id, target_table, target_id, counterparty_id, amount, end_to_end_id)
VALUES ('${u(88)}', '${u(87)}', 'billing.invoice', '${u(70)}', '${u(12)}', 1, 'E2E-SINTETICO');

INSERT INTO regulatory.runner (id, code, kind, description) VALUES ('${u(90)}', 'local-bodega', 'local', 'Ejecutor sintetico');
INSERT INTO regulatory.connector (id, flow, legal_entity_id, mode, environment) VALUES ('${u(91)}', 'verifactu', '${u(1)}', 'manual', 'test');
INSERT INTO regulatory.submission (id, flow, legal_entity_id, kind, payload, payload_sha256, created_by)
VALUES ('${u(92)}', 'verifactu', '${u(1)}', 'verifactu.alta', '{}'::JSON, '${sha}', 'test');
INSERT INTO regulatory.submission_item (id, submission_id, item_table, item_id) VALUES ('${u(93)}', '${u(92)}', 'billing.invoice', '${u(70)}');
INSERT INTO regulatory.connector_run (id, submission_id, attempt, action) VALUES ('${u(94)}', '${u(92)}', 1, 'check_status');
INSERT INTO regulatory.verifactu_installation (id, legal_entity_id, environment, mode, system_version, installation_number, producer_name, producer_tax_id, starts_on)
VALUES ('${u(95)}', '${u(1)}', 'test', 'verifactu', '0.1.0', '1', 'Productor Sintetico', 'B00000000', '2027-01-01');
INSERT INTO regulatory.verifactu_record (id, installation_id, legal_entity_id, chain_seq, record_type, invoice_id, issuer_tax_id, invoice_number, invoice_issue_date, invoice_type, total_tax, total_amount, generated_at, hash, record_xml)
VALUES ('${u(96)}', '${u(95)}', '${u(1)}', 1, 'alta', '${u(70)}', '00000000T', 'F1', '2027-01-15', 'F1', 0, 0, '2027-01-15 10:00:00+00', '${shaUp}', '<r/>');
INSERT INTO regulatory.verifactu_event (id, installation_id, event_type, hash) VALUES ('${u(97)}', '${u(95)}', 'inicio', '${shaUp}');
INSERT INTO regulatory.silicie_exercise (id, tax_warehouse_id, year) VALUES ('${u(98)}', '${u(40)}', 2027);
INSERT INTO regulatory.silicie_ledger (id, tax_warehouse_id, reference, description, product_class, epigrafe, epigrafe_code, nc_code)
VALUES ('${u(99)}', '${u(40)}', 'GRANEL-TINTO', 'Vino tinto a granel', 'bulk', '1', 'V0', '2204');
INSERT INTO regulatory.silicie_entry (id, exercise_id, tax_warehouse_id, local_seq, movement_date, entry_kind, fields)
VALUES ('${u(100)}', '${u(98)}', '${u(40)}', 1, '2027-01-15', 'A14', '{}'::JSON);
INSERT INTO regulatory.sisv_entry (id, legal_entity_id, book, installation_ria, direction, entry_date, operation, fields, source_table, source_id)
VALUES ('${u(101)}', '${u(1)}', 'VINO', '46/00000', 'E', '2027-01-15', 'entrada', '{}'::JSON, 'cellar.operation', '${u(51)}');
INSERT INTO regulatory.emcs_document (id, legal_entity_id, tax_warehouse_id, kind, destination_type, lrn, fields, created_by)
VALUES ('${u(102)}', '${u(1)}', '${u(40)}', 'e_ad', '1', 'LRN-SINT-0001', '{}'::JSON, 'test');
INSERT INTO regulatory.emcs_item (id, emcs_document_id, item_no, excise_product_code, nc_code, volume_ml, abv_pct)
VALUES ('${u(103)}', '${u(102)}', 1, 'W200', '22042100', 750, 13);
INSERT INTO regulatory.edi_message (id, legal_entity_id, partner_contact_id, direction, message_type) VALUES ('${u(104)}', '${u(1)}', '${u(12)}', 'in', 'ORDERS');
INSERT INTO regulatory.organic_certificate (id, holder_kind, legal_entity_id, control_body_code, product_categories, valid_from, valid_to)
VALUES ('${u(105)}', 'own', '${u(1)}', 'ES-ECO-001-AN', ['a'], '2027-01-01', '2027-12-31');
INSERT INTO regulatory.obligation (id, legal_entity_id, flow, title, due_date, legal_basis)
VALUES ('${u(106)}', '${u(1)}', 'silicie', 'Apertura', '2027-01-31', 'Orden HAC');
INSERT INTO regulatory.reconciliation_run (id, kind, legal_entity_id, period_start, period_end, status, summary, run_by)
VALUES ('${u(107)}', 'physical_vs_fiscal', '${u(1)}', '2027-01-01', '2027-01-31', 'balanced', '{}'::JSON, 'test');
INSERT INTO regulatory.reconciliation_diff (id, run_id, dimension, difference_ml) VALUES ('${u(108)}', '${u(107)}', '{}'::JSON, 0);

INSERT INTO vineyard.parcel (id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_polygon, sigpac_parcel, sigpac_enclosure, area_ha)
VALUES ('${u(110)}', 'PAGO-1', 'Pago Uno', 'own', 46, 250, 1, 1, 1, 1.5);
INSERT INTO vineyard.parcel_variety (id, parcel_id, variety, color, area_ha) VALUES ('${u(111)}', '${u(110)}', 'Bobal', 'red', 1.5);
INSERT INTO vineyard.treatment (id, parcel_id, applied_on, operator_name, product_name, is_organic_approved, dose, dose_unit, treated_area_ha, method, created_by)
VALUES ('${u(112)}', '${u(110)}', '2027-05-01', 'Ana', 'Azufre', true, 1, 'kg/ha', 1, 'Espolvoreo', 'test');
INSERT INTO vineyard.field_task (id, parcel_id, done_on, kind) VALUES ('${u(113)}', '${u(110)}', '2027-02-01', 'pruning');
INSERT INTO vineyard.maturity_check (id, parcel_id, checked_at, author) VALUES ('${u(114)}', '${u(110)}', '2027-09-01 10:00:00+00', 'Ana');
INSERT INTO vineyard.harvest (id, parcel_id, vintage, harvested_on, variety) VALUES ('${u(115)}', '${u(110)}', 2027, '2027-09-15', 'Bobal');

INSERT INTO accounting.fiscal_year (id, legal_entity_id, year, starts_on, ends_on) VALUES ('${u(120)}', '${u(1)}', 2027, '2027-01-01', '2027-12-31');
INSERT INTO accounting.account (id, legal_entity_id, code, name, pgc_group) VALUES ('${u(121)}', '${u(1)}', '430000', 'Clientes', 4);
INSERT INTO accounting.journal_entry (id, legal_entity_id, fiscal_year_id, entry_no, entry_date, kind, description, posted_by)
VALUES ('${u(122)}', '${u(1)}', '${u(120)}', 1, '2027-01-15', 'regular', 'Asiento', 'test');
INSERT INTO accounting.journal_line (id, entry_id, line_no, account_id, debit) VALUES ('${u(123)}', '${u(122)}', 1, '${u(121)}', 10);
INSERT INTO accounting.posting_rule (id, legal_entity_id, document_kind, template, valid_from, created_by)
VALUES ('${u(124)}', '${u(1)}', 'sales_invoice', '{}'::JSON, '2027-01-01', 'test');

INSERT INTO knowledge.tasting_note (id, wine_id, tasted_on, notes, author) VALUES ('${u(130)}', '${u(30)}', '2027-06-01', 'Nota de cata', 'Ana');
INSERT INTO catalog.label_spec (id, product_id, version, legal_name, alcohol_pct_label, nominal_volume_ml, ingredients, nutrition_per_100ml, bottler_statement)
VALUES ('${u(131)}', '${u(32)}', 1, 'Vino', 13.5, 750, '{}'::JSON, '{}'::JSON, 'Bodega');

INSERT INTO legacy.import_batch (id, source, dataset, file_name, file_sha256, mode, run_by)
VALUES ('${u(140)}', 'holded', 'contacts', 'a.csv', '${sha}', 'dry_run', 'test');
INSERT INTO legacy.holded_invoice (id, batch_id, entity_id, kind, number, issue_date, counterparty_name, subtotal, total, status_holded, raw)
VALUES ('${u(141)}', '${u(140)}', '${u(1)}', 'sale', 'H-1', '2026-06-01', 'Cliente', 10, 10, 'Pendiente', '{}'::JSON);
INSERT INTO legacy.holded_invoice_line (id, batch_id, entity_id, kind, document_number, document_date, line_seq, raw)
VALUES ('${u(142)}', '${u(140)}', '${u(1)}', 'sale', 'H-1', '2026-06-01', 1, '{}'::JSON);
INSERT INTO legacy.holded_delivery_note (id, batch_id, entity_id, number, issue_date, invoiced_status, raw)
VALUES ('${u(143)}', '${u(140)}', '${u(1)}', 'A-1', '2026-06-01', 'Pendiente', '{}'::JSON);
INSERT INTO legacy.holded_product (id, batch_id, entity_id, name, raw) VALUES ('${u(144)}', '${u(140)}', '${u(1)}', 'Producto', '{}'::JSON);
INSERT INTO legacy.holded_trial_balance (id, batch_id, entity_id, year, account_code, debit, credit, balance)
VALUES ('${u(145)}', '${u(140)}', '${u(1)}', 2026, '430', 0, 0, 0);
INSERT INTO legacy.holded_pnl_line (id, batch_id, entity_id, year, line_no, concept) VALUES ('${u(146)}', '${u(140)}', '${u(1)}', 2026, 1, 'Ventas');
INSERT INTO legacy.shopify_order (id, batch_id, order_name, created_at_shop, raw) VALUES ('${u(147)}', '${u(140)}', '#1001', '2026-06-01 10:00:00+00', '{}'::JSON);
INSERT INTO legacy.shopify_order_line (id, order_id, line_seq, name, quantity, price) VALUES ('${u(148)}', '${u(147)}', 1, 'Vino', 1, 10);
INSERT INTO legacy.open_item (id, entity_id, direction, holded_invoice_id, document_number, document_date, amount)
VALUES ('${u(149)}', '${u(1)}', 'receivable', '${u(141)}', 'H-1', '2026-06-01', 10);
INSERT INTO legacy.accounting_journal_line (id, batch_id, entity_id, year, entry_no, line_no, entry_date, account_code, debit)
VALUES ('${u(150)}', '${u(140)}', '${u(1)}', 2026, 1, 1, '2026-06-01', '430', 10);
INSERT INTO legacy.document_file (id, batch_id, attachment_id, original_path, status) VALUES ('${u(151)}', '${u(140)}', '${u(10)}', 'pdf/a.pdf', 'unmatched');

SELECT * FROM inventory.v_stock_balance;
SELECT * FROM inventory.v_fiscal_balance;
SELECT * FROM billing.v_receivable;
`;
}

test("el esquema DuckDB reproduce tablas, vistas y columnas de la referencia", async () => {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const client: KbClient = {
    async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
      try {
        const reader = await conn.runAndReadAll(statement);
        return reader.getRowObjectsJson() as T[];
      } catch (error) {
        try {
          await conn.run("ROLLBACK");
        } catch {
          // No había transacción abierta.
        }
        throw error;
      }
    },
  };
  const migrations = readdirSync(join(root, "api/db/migrations")).filter((name) => name.endsWith(".sql")).sort();
  expect(migrations[0]).toBe("0001_core.sql");
  expect(migrations).toContain("0002_core_ops.sql");
  expect(migrations).toContain("0016_legacy.sql");
  expect(migrations.at(-1)).toBe("0042_mcp_owner_scopes.sql");
  expect(migrations).toHaveLength(42);
  await migrate(client);

  const refs = referenceObjects(root);
  expect(refs.length).toBe(135);
  const rows = await conn.runAndReadAll(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'main')
  `);
  const actual = new Map<string, Set<string>>();
  for (const row of rows.getRowObjectsJson() as { table_schema: string; table_name: string; column_name: string }[]) {
    const key = `${row.table_schema}.${row.table_name}`;
    const cols = actual.get(key) ?? new Set<string>();
    cols.add(row.column_name);
    actual.set(key, cols);
  }
  const problems: string[] = [];
  for (const obj of refs) {
    const key = `${obj.schema}.${obj.name}`;
    const got = actual.get(key);
    if (!got) {
      problems.push(`falta ${obj.kind} ${key}`);
      continue;
    }
    const allowMiss = new Set(MISSING_COLUMNS[key] ?? []);
    const allowExtra = new Set(EXTRA_COLUMNS[key] ?? []);
    for (const col of obj.columns) {
      if (!got.has(col) && !allowMiss.has(col)) problems.push(`${key} sin columna ${col}`);
    }
    for (const col of got) {
      if (!obj.columns.includes(col) && !allowExtra.has(col)) problems.push(`${key} columna extra ${col}`);
    }
  }
  expect(problems).toEqual([]);

  await apply(conn, "muestra", sampleSql());
  await conn.run(`UPDATE party.contact SET legal_name = 'Bodega Ejemplo Dos' WHERE id = '${u(12)}'`);
  await conn.run(`UPDATE catalog.product SET name = 'Arcal botella' WHERE id = '${u(32)}'`);
  const renamed = await conn.runAndReadAll(`
    SELECT c.legal_name
    FROM party.contact c
    JOIN party.contact_address a ON a.contact_id = c.id
    WHERE c.id = '${u(12)}'
  `);
  expect(renamed.getRowObjectsJson()).toEqual([{ legal_name: "Bodega Ejemplo Dos" }]);
  await expect(
    conn.run(`
      INSERT INTO party.contact_address (id, contact_id, kind, line1, postal_code, city, country_code)
      VALUES ('${u(900)}', '${u(901)}', 'billing', 'Calle', '00000', 'Ciudad', 'ES')
    `),
  ).rejects.toThrow(/foreign key/i);
});
