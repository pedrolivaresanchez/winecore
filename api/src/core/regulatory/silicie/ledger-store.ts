// Alta de mayores SILICIE. La identificación no se edita (WC122).
import { Decimal } from "decimal.js";
import { sql } from "../../db/sql";
import type { Tx } from "../../db/writer";
import { domainError } from "../../errors";
import { newId } from "../../ids";
import { identityChanged, ledgerFromSituation } from "./ledgers";
import type { LedgerSituation, SilicieLedger } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listLedgerRows(read: Tx["read"], taxWarehouseId: string): Promise<SilicieLedger[]> {
  if (!UUID.test(taxWarehouseId)) throw domainError("WC_VALIDATION", { tax_warehouse_id: "Identificador no válido" });
  const rows = await read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, reference, description,
           product_class, epigrafe, epigrafe_code, nc_code, product_key, container_type,
           container_capacity_l::VARCHAR AS container_capacity_l, is_active, validated_by,
           created_at::VARCHAR AS created_at
    FROM regulatory.silicie_ledger
    WHERE tax_warehouse_id = CAST(${taxWarehouseId} AS UUID)
    ORDER BY reference
  `);
  return rows.map(toLedger);
}

export async function createLedger(
  tx: Tx,
  input: { taxWarehouseId: string; situation: LedgerSituation; ncCode?: string; createdAt: string },
): Promise<SilicieLedger> {
  if (!UUID.test(input.taxWarehouseId)) {
    throw domainError("WC_VALIDATION", { tax_warehouse_id: "Identificador no válido" });
  }
  const draft = ledgerFromSituation({
    id: newId(),
    taxWarehouseId: input.taxWarehouseId,
    createdAt: input.createdAt,
    situation: input.situation,
    ncCode: input.ncCode,
  });
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, reference, description,
           product_class, epigrafe, epigrafe_code, nc_code, product_key, container_type,
           container_capacity_l::VARCHAR AS container_capacity_l, is_active, validated_by,
           created_at::VARCHAR AS created_at
    FROM regulatory.silicie_ledger
    WHERE tax_warehouse_id = CAST(${input.taxWarehouseId} AS UUID)
      AND reference = ${draft.reference}
  `);
  const current = rows[0] ? toLedger(rows[0]) : null;
  if (current) {
    if (identityChanged(current, { ...draft, id: current.id })) throw domainError("WC122");
    return current;
  }
  const capacity = draft.containerCapacityMl === null ? null : new Decimal(draft.containerCapacityMl).div(1000);
  tx.write(sql`
    INSERT INTO regulatory.silicie_ledger (
      id, tax_warehouse_id, reference, description, product_class, epigrafe, epigrafe_code,
      nc_code, product_key, container_type, container_capacity_l, is_active, created_at
    ) VALUES (
      CAST(${draft.id} AS UUID),
      CAST(${draft.taxWarehouseId} AS UUID),
      ${draft.reference},
      ${draft.description},
      ${draft.productClass},
      ${draft.epigrafe},
      ${draft.epigrafeCode},
      ${draft.ncCode},
      ${draft.productKey},
      ${draft.containerType},
      ${capacity},
      TRUE,
      ${input.createdAt}::TIMESTAMPTZ
    )
  `);
  tx.audit({
    table: "regulatory.silicie_ledger",
    rowId: draft.id,
    action: "INSERT",
    before: null,
    after: { reference: draft.reference, nc_code: draft.ncCode, product_class: draft.productClass },
  });
  return draft;
}

export async function validateLedger(tx: Tx, id: string, advisorRef: string): Promise<void> {
  if (!UUID.test(id)) throw domainError("WC_NOT_FOUND");
  if (!/^[A-Za-z0-9 .:_-]{3,80}$/.test(advisorRef)) {
    throw domainError("WC_VALIDATION", { advisor_ref: "La referencia del asesor no es válida." });
  }
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM regulatory.silicie_ledger WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError("WC_NOT_FOUND");
  tx.write(sql`
    UPDATE regulatory.silicie_ledger
    SET validated_by = ${advisorRef}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: "regulatory.silicie_ledger",
    rowId: id,
    action: "UPDATE",
    before: { validated_by: null },
    after: { validated_by: advisorRef },
  });
}

function toLedger(row: Record<string, unknown>): SilicieLedger {
  return {
    id: String(row.id),
    taxWarehouseId: String(row.tax_warehouse_id),
    reference: String(row.reference),
    description: String(row.description),
    productClass: String(row.product_class) as SilicieLedger["productClass"],
    epigrafe: text(row.epigrafe),
    epigrafeCode: text(row.epigrafe_code),
    ncCode: String(row.nc_code),
    productKey: text(row.product_key),
    containerType: text(row.container_type),
    containerCapacityMl: row.container_capacity_l == null ? null : new Decimal(String(row.container_capacity_l)).mul(1000).toNumber(),
    isActive: row.is_active !== false,
    validatedBy: text(row.validated_by),
    createdAt: String(row.created_at ?? ""),
  };
}

function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}
