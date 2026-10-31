// Apertura del ejercicio SILICIE. La entrada de uva (A02) exige un ejercicio abierto.
import { sql } from "../db/sql";
import type { Actor, Writer } from "../db/writer";
import { domainError } from "../errors";
import { newId } from "../ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SilicieExerciseView {
  id: string;
  tax_warehouse_id: string;
  year: number;
  status: string;
  opened_at: string;
  created: boolean;
}

export async function openSilicieExercise(
  writer: Writer,
  actor: Actor,
  input: { taxWarehouseId: string; year: number },
): Promise<SilicieExerciseView> {
  if (!UUID.test(input.taxWarehouseId)) {
    throw domainError("WC_VALIDATION", { tax_warehouse_id: "Identificador no válido" });
  }
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    throw domainError("WC_VALIDATION", { year: "El ejercicio está entre 2020 y 2100" });
  }
  const outcome = await writer.withWrite(actor, async (tx) => {
    const warehouses = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id
      FROM inventory.tax_warehouse
      WHERE id = CAST(${input.taxWarehouseId} AS UUID) AND is_active
    `);
    if (!warehouses[0]) throw domainError("WC_NOT_FOUND");
    const existing = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, status, year, opened_at
      FROM regulatory.silicie_exercise
      WHERE tax_warehouse_id = CAST(${input.taxWarehouseId} AS UUID)
        AND year = ${input.year}
    `);
    const current = existing[0];
    if (current) {
      if (String(current.status) === "closed") {
        throw domainError(
          "WC_ILLEGAL_TRANSITION",
          { year: "El ejercicio está cerrado." },
          "El ejercicio está cerrado.",
        );
      }
      return { view: viewOf(current, false), id: String(current.id).toLowerCase() };
    }
    const id = newId();
    tx.write(sql`
      INSERT INTO regulatory.silicie_exercise (id, tax_warehouse_id, year, status)
      VALUES (CAST(${id} AS UUID), CAST(${input.taxWarehouseId} AS UUID), ${input.year}, 'open')
    `);
    tx.audit({
      table: "regulatory.silicie_exercise",
      rowId: id,
      action: "INSERT",
      before: null,
      after: { id, tax_warehouse_id: input.taxWarehouseId, year: input.year, status: "open" },
    });
    return { view: null, id };
  });
  if (outcome.view) return outcome.view;
  const stored = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, status, year, opened_at
    FROM regulatory.silicie_exercise
    WHERE id = CAST(${outcome.id} AS UUID)
  `);
  const row = stored[0];
  if (!row) throw domainError("WC_NOT_FOUND");
  return viewOf(row, true);
}

export async function warehouseEntityId(writer: Writer, taxWarehouseId: string): Promise<string | null> {
  if (!UUID.test(taxWarehouseId)) return null;
  const rows = await writer.read<{ legal_entity_id: string }>(sql`
    SELECT legal_entity_id::VARCHAR AS legal_entity_id
    FROM inventory.tax_warehouse
    WHERE id = CAST(${taxWarehouseId} AS UUID)
  `);
  const id = rows[0]?.legal_entity_id;
  return id ? id.toLowerCase() : null;
}

function viewOf(row: Record<string, unknown>, created: boolean): SilicieExerciseView {
  return {
    id: String(row.id).toLowerCase(),
    tax_warehouse_id: String(row.tax_warehouse_id).toLowerCase(),
    year: Number(row.year),
    status: String(row.status),
    opened_at: iso(row.opened_at),
    created,
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value).replace(" ", "T"));
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}
