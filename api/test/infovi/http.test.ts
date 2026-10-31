import { describe, expect, it } from "bun:test";
import { sql } from "../../src/core/db/sql";
import { newId } from "../../src/core/ids";
import { sessionHash, writeStepUp } from "../../src/core/auth/stepup/session";
import { createTestApp } from "../helpers";

const CAE = "ES00000V0000T";

function headers(email?: string, json = false): Headers {
  const value = new Headers();
  if (json) value.set("content-type", "application/json");
  if (email) value.set("x-dev-user", email);
  return value;
}

async function call(
  app: { handle: (request: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
  email?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: headers(email, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === "" ? {} : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

async function userId(ctx: Awaited<ReturnType<typeof createTestApp>>, email: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.app_user WHERE lower(email) = ${email}
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error(`sin usuario ${email}`);
  return id;
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code = "PO"): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${code}
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error(`sin entidad ${code}`);
  return id;
}

describe("declaración INFOVI", () => {
  it("prepara el mes desde la bodega, exige aprobación y la corrección es un sucesor", async () => {
    const now = new Date("2027-07-02T10:00:00.000Z");
    const ctx = await createTestApp({ now: () => now });
    try {
      const po = await entityId(ctx);
      const owner = await userId(ctx, "owner@winecore.test");
      const warehouse = newId();
      const location = newId();
      const wine = newId();
      const lot = newId();
      const grape = newId();
      const reception = newId();
      const bottling = newId();
      await ctx.writer.withWrite({ type: "system", id: "infovi-test", requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${CAE}, 'V1', ${"Bodega sintetica"}, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, tax_warehouse_id, controlling_entity_id)
          VALUES (
            CAST(${location} AS UUID), 'BODSINT', ${"Nave sintetica"}, 'cellar',
            CAST(${warehouse} AS UUID), CAST(${po} AS UUID)
          )
        `);
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, category)
          VALUES (CAST(${wine} AS UUID), 'SINTDOP', ${"Vino sintetico"}, 'red', 'pdo_wine')
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin)
          VALUES (
            CAST(${lot} AS UUID), CAST(${po} AS UUID), 'LOTE-SINT', 'wine',
            CAST(${wine} AS UUID), 2026, 'opening_count'
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, origin)
          VALUES (CAST(${grape} AS UUID), CAST(${po} AS UUID), 'UVA-SINT', 'grape', 2026, 'reception')
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-05-02 08:00:00+00', 'opening',
            CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), 'wine',
            100000, 'inventory.inventory_count', CAST(${newId()} AS UUID), 'infovi-test'
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-06-03 08:00:00+00', 'cellar_in',
            CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), 'wine',
            20000, 'cellar.operation', CAST(${newId()} AS UUID), 'infovi-test'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation (
            id, legal_entity_id, number, op_type, occurred_at, status, performed_by, confirmed_at, details, created_by
          ) VALUES (
            CAST(${reception} AS UUID), CAST(${po} AS UUID), 'OB-SINT-1', 'reception',
            TIMESTAMPTZ '2027-06-02 08:00:00+00', 'confirmed', 'Sintetico',
            TIMESTAMPTZ '2027-06-02 09:00:00+00',
            ${sql.json({
              grape_reception: {
                variety_code: "BOBAL",
                net_g: 500000,
                lot_id: grape,
                source: { kind: "parcels", lines: [{ parcel_code: "PAR-SINT", kg: "500.000" }] },
              },
            })},
            'infovi-test'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation_line (id, operation_id, role, lot_id, location_id, product_state, mass_g)
          VALUES (
            CAST(${newId()} AS UUID), CAST(${reception} AS UUID), 'input', CAST(${grape} AS UUID),
            CAST(${location} AS UUID), 'grape', 500000
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.grape_intake (operation_id, container, weighing, sanitary_state, decision)
          VALUES (CAST(${reception} AS UUID), 'bulk', 'weighed', 'healthy', 'accepted')
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-06-02 08:00:00+00', 'cellar_in',
            CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${grape} AS UUID), 'grape',
            500000, 'cellar.operation', CAST(${reception} AS UUID), 'infovi-test'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation (
            id, legal_entity_id, number, op_type, occurred_at, status, performed_by, confirmed_at, created_by
          ) VALUES (
            CAST(${bottling} AS UUID), CAST(${po} AS UUID), 'OB-SINT-2', 'bottling',
            TIMESTAMPTZ '2027-06-10 08:00:00+00', 'confirmed', 'Sintetico',
            TIMESTAMPTZ '2027-06-10 09:00:00+00', 'infovi-test'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation_line (id, operation_id, role, lot_id, location_id, product_state, volume_ml)
          VALUES (
            CAST(${newId()} AS UUID), CAST(${bottling} AS UUID), 'input', CAST(${lot} AS UUID),
            CAST(${location} AS UUID), 'wine', 5000
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation_line (
            id, operation_id, role, lot_id, location_id, product_id, product_state, volume_ml, qty_units
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${bottling} AS UUID), 'output', CAST(${lot} AS UUID),
            CAST(${location} AS UUID), CAST(${wine} AS UUID), 'packaged_labeled', 4800, 6
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES
            (CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-06-10 08:00:00+00', 'cellar_out',
             CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), 'wine',
             -5000, 'cellar.operation', CAST(${bottling} AS UUID), 'infovi-test'),
            (CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-06-10 08:00:00+00', 'cellar_in',
             CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), 'packaged_labeled',
             4800, 'cellar.operation', CAST(${bottling} AS UUID), 'infovi-test')
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-06-18 08:00:00+00', 'delivery_out',
            CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), 'packaged_labeled',
            -1500, 'sales.delivery_note', CAST(${newId()} AS UUID), 'infovi-test'
          )
        `);
      });

      const denied = await call(ctx.app, "POST", "/v1/regulatory/infovi", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        month: "2027-06",
      }, "bodega@winecore.test");
      expect(denied.status).toBe(403);

      const generated = await call(ctx.app, "POST", "/v1/regulatory/infovi", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        month: "2027-06",
      }, "admin@winecore.test");
      expect(generated.status).toBe(200);
      expect(generated.body.status).toBe("draft");
      expect(generated.body.phase).toBe("generated");
      const line = (generated.body.lines as { opening_l: string; entries_l: string; exits_l: string; closing_l: string; reconciles: boolean; category: string }[])[0];
      expect(line?.category).toBe("con_dop");
      expect(line?.opening_l).toBe("100.000");
      expect(line?.entries_l).toBe("24.800");
      expect(line?.exits_l).toBe("6.500");
      expect(line?.closing_l).toBe("118.300");
      expect(line?.reconciles).toBe(true);
      expect(generated.body.reconciliation).toEqual({ ok: true, unbalanced: 0 });
      expect(String(generated.body.blocked_note)).toContain("BLOCKED");
      expect(generated.body.sales_l).toBe("1.500");
      expect(generated.body.bottling_l).toBe("4.800");
      const warnings = (generated.body.validation as { warnings: { code: string }[] }).warnings.map((item) => item.code);
      expect(warnings).toContain("modelo_oficial");
      expect(warnings).toContain("reovi_ausente");
      expect((generated.body.validation as { errors: unknown[] }).errors).toEqual([]);
      const id = String(generated.body.id);
      const hash = String(generated.body.content_sha256);

      const file = await ctx.app.handle(new Request(`http://localhost/v1/regulatory/infovi/${id}/file`, {
        headers: headers("admin@winecore.test"),
      }));
      expect(file.status).toBe(200);
      const csv = new TextDecoder().decode(await file.arrayBuffer());
      expect(csv).toContain("BLOCKED");
      expect(csv).toContain("118.300");
      expect(csv).toContain("cosecha");
      expect(csv).toContain("BOBAL");

      const validated = await call(ctx.app, "POST", `/v1/regulatory/infovi/${id}/validate`, {}, "admin@winecore.test");
      expect(validated.status).toBe(200);
      expect(validated.body.status).toBe("validated");
      expect(validated.body.ready_for_approval).toBe(true);

      const pending = await call(ctx.app, "POST", `/v1/regulatory/infovi/${id}/request-approval`, {}, "admin@winecore.test");
      expect(pending.status).toBe(200);
      expect(pending.body.status).toBe("pending_approval");
      const approvalId = String(pending.body.approval_request_id);

      await ctx.app.handle(new Request("http://localhost/v1/me", { headers: headers("owner@winecore.test") }));
      const stepRequest = new Request("http://localhost/v1/approvals", { headers: headers("owner@winecore.test") });
      await ctx.writer.withWrite({ type: "user", id: owner, requestId: "step" }, async (tx) => {
        await writeStepUp(tx, {
          userId: owner,
          hash: sessionHash(ctx.config, stepRequest, owner),
          at: now,
          method: "totp",
          ip: null,
          userAgent: null,
        });
      });
      const approved = await call(ctx.app, "POST", `/v1/approvals/${approvalId}/decide`, {
        decision: "approve",
        payload_sha256: hash,
      }, "owner@winecore.test");
      expect(approved.status).toBe(200);
      const after = await call(ctx.app, "GET", `/v1/regulatory/infovi/${id}`, undefined, "admin@winecore.test");
      expect(after.body.status).toBe("approved");

      const form = new FormData();
      form.set("file", new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "justificante.pdf"));
      form.set("table", "regulatory.infovi_filing");
      form.set("row_id", id);
      form.set("role", "official_receipt");
      const uploaded = await ctx.app.handle(new Request("http://localhost/v1/attachments", {
        method: "POST",
        headers: headers("admin@winecore.test"),
        body: form,
      }));
      expect(uploaded.status).toBe(201);
      const receipt = JSON.parse(await uploaded.text()) as { id: string };

      const submitted = await call(ctx.app, "POST", `/v1/regulatory/infovi/${id}/mark-submitted`, {
        external_ref: "INFOVI-SINT-202706",
        receipt_attachment_id: receipt.id,
      }, "admin@winecore.test");
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe("submitted");
      expect(submitted.body.external_ref).toBe("INFOVI-SINT-202706");

      const again = await call(ctx.app, "POST", "/v1/regulatory/infovi", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        month: "2027-06",
      }, "admin@winecore.test");
      expect(again.status).toBe(409);

      const correction = await call(ctx.app, "POST", `/v1/regulatory/infovi/${id}/correct`, {
        reason: "Litros de embotellado mal anotados",
      }, "admin@winecore.test");
      expect(correction.status).toBe(200);
      expect(correction.body.rectifies_filing_id).toBe(id);
      expect(correction.body.id).not.toBe(id);
      const linked = await call(ctx.app, "GET", `/v1/regulatory/infovi/${id}`, undefined, "admin@winecore.test");
      expect(linked.body.successor_id).toBe(correction.body.id);

      const listed = await call(ctx.app, "GET", `/v1/regulatory/infovi?entity=${po}&tax_warehouse_id=${warehouse}&month=2027-06`, undefined, "admin@winecore.test");
      expect(listed.status).toBe(200);
      expect(listed.body.due_date).toBe("2027-07-20");
      expect((listed.body.filing as { id: string }).id).toBe(correction.body.id);
    } finally {
      await ctx.close();
    }
  });

  it("bloquea la aprobación si falta el vino del lote", async () => {
    const ctx = await createTestApp({ now: () => new Date("2027-07-02T10:00:00.000Z") });
    try {
      const po = await entityId(ctx);
      const warehouse = newId();
      const location = newId();
      const lot = newId();
      await ctx.writer.withWrite({ type: "system", id: "infovi-test", requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), 'ES00000V0001T', 'V1', ${"Bodega sintetica"}, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, tax_warehouse_id, controlling_entity_id)
          VALUES (
            CAST(${location} AS UUID), 'BODSINT2', ${"Nave sintetica"}, 'cellar',
            CAST(${warehouse} AS UUID), CAST(${po} AS UUID)
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, origin)
          VALUES (CAST(${lot} AS UUID), CAST(${po} AS UUID), 'HUECO', 'wine', 2026, 'opening_count')
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2027-06-04 08:00:00+00', 'cellar_in',
            CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), 'wine',
            3000, 'cellar.operation', CAST(${newId()} AS UUID), 'infovi-test'
          )
        `);
      });
      const generated = await call(ctx.app, "POST", "/v1/regulatory/infovi", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        month: "2027-06",
      }, "admin@winecore.test");
      expect(generated.status).toBe(200);
      const codes = (generated.body.validation as { errors: { code: string }[] }).errors.map((item) => item.code);
      expect(codes).toContain("dato_ausente");
      const checked = await call(ctx.app, "POST", `/v1/regulatory/infovi/${String(generated.body.id)}/validate`, {}, "admin@winecore.test");
      expect(checked.body.status).toBe("draft");
      expect(checked.body.ready_for_approval).toBe(false);
      const blocked = await call(ctx.app, "POST", `/v1/regulatory/infovi/${String(generated.body.id)}/request-approval`, {}, "admin@winecore.test");
      expect(blocked.status).toBe(409);
    } finally {
      await ctx.close();
    }
  });
});
