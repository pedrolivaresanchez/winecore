import { describe, expect, it } from "bun:test";
import { createTestApp } from "../helpers";
import { sql } from "../../src/core/db/sql";
import { newId } from "../../src/core/ids";
import { sessionHash, writeStepUp } from "../../src/core/auth/stepup/session";
import { enqueueRun } from "../../src/core/regulatory/submissions";
import { CSV_LINE_ENDING, IESA1_V2_COLUMNS } from "../../src/core/regulatory/silicie/csv";
import { dispatchOutbox } from "../../src/core/events/dispatch";
import { refreshRegulatoryCalendar } from "../../src/core/regulatory/obligations";

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

async function download(
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  email: string,
): Promise<{ status: number; bytes: Uint8Array; type: string | null }> {
  const response = await app.handle(new Request(`http://localhost${path}`, { headers: headers(email) }));
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
    type: response.headers.get("content-type"),
  };
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
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

describe("presentación SILICIE", () => {
  it("genera el CSV del periodo, exige aprobación y no llama a la AEAT", async () => {
    const now = new Date("2027-06-15T10:00:00.000Z");
    const ctx = await createTestApp({ now: () => now });
    try {
      const po = await entityId(ctx);
      const admin = await userId(ctx, "admin@winecore.test");
      const owner = await userId(ctx, "owner@winecore.test");
      const warehouse = newId();
      const moveId = newId();
      const sourceId = newId();
      await ctx.writer.withWrite({ type: "system", id: "silicie-test", requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (
            CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${CAE}, 'V1', ${"Fábrica sintética"}, TRUE
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.fiscal_move (
            id, tax_warehouse_id, fiscal_date, move_type, product_class, volume_ml, units, abv_pct,
            excise_product_key, justification_type, justification_ref, fiscal_trigger,
            source_table, source_id, created_by
          ) VALUES (
            CAST(${moveId} AS UUID), CAST(${warehouse} AS UUID), DATE '2027-01-01', 'opening', 'bulk',
            2500000, 0, 12.50, 'GRANEL-TINTO', 'count_record', 'AF-02-GRANEL', 'count',
            'inventory.inventory_count', CAST(${sourceId} AS UUID), 'silicie-test'
          )
        `);
      });

      const denied = await call(ctx.app, "POST", "/v1/regulatory/submissions", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        period_start: "2027-01-01",
        period_end: "2027-07-31",
      }, "bodega@winecore.test");
      expect(denied.status).toBe(403);

      const ledger = await call(ctx.app, "POST", "/v1/silicie-ledgers", {
        tax_warehouse_id: warehouse,
        product_class: "bulk",
        color: "tinto",
        nc_code: "220429",
      }, "admin@winecore.test");
      expect(ledger.status).toBe(200);
      expect(ledger.body.reference).toBe("GRANEL-TINTO");
      const changed = await call(ctx.app, "POST", "/v1/silicie-ledgers", {
        tax_warehouse_id: warehouse,
        product_class: "bulk",
        color: "tinto",
        nc_code: "22042900",
      }, "admin@winecore.test");
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe("WC122");

      const period = {
        flow: "silicie",
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        period_start: "2027-01-01",
        period_end: "2027-07-31",
        recorded_on: "2027-10-01",
        aggregation: "none",
      };
      const generated = await call(ctx.app, "POST", "/v1/regulatory/submissions", period, "admin@winecore.test");
      expect(generated.status).toBe(200);
      expect(generated.body.phase).toBe("generated");
      expect(generated.body.status).toBe("draft");
      expect(generated.body.blocks_approval).toBe(true);
      const submissionId = String(generated.body.id);
      const hash = String(generated.body.content_sha256);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      const again = await call(ctx.app, "POST", "/v1/regulatory/submissions", period, "admin@winecore.test");
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(submissionId);
      expect(again.body.content_sha256).toBe(hash);

      const file = await download(ctx.app, `/v1/regulatory/submissions/${submissionId}/file`, "admin@winecore.test");
      expect(file.status).toBe(200);
      expect(file.type).toContain("ISO-8859-1");
      const text = latin1(file.bytes);
      const expectedLine = "2027-000001;;;01-01-2027;01-10-2027;A01;;2;;;Fábrica sintética;;;J12;AF-02-GRANEL;;;;;;;;1;V0;220429;;2500.000;LTR;Vino tinto a granel en depósito;GRANEL-TINTO;;12.500;312.500;;;;;;;;;";
      expect(text).toBe(`${IESA1_V2_COLUMNS.join(";")}${CSV_LINE_ENDING}${expectedLine}${CSV_LINE_ENDING}`);
      expect(text.split(CSV_LINE_ENDING)[1]?.split(";")).toHaveLength(42);

      const validated = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/validate`, {}, "admin@winecore.test");
      expect(validated.status).toBe(200);
      expect(validated.body.status).toBe("validated");
      expect(validated.body.ready_for_approval).toBe(true);
      expect((validated.body.validation as { errors: unknown[] }).errors).toEqual([]);

      const pending = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/request-approval`, {}, "admin@winecore.test");
      expect(pending.status).toBe(200);
      expect(pending.body.status).toBe("pending_approval");
      expect(pending.body.phase).toBe("pending_approval");
      const approvalId = String(pending.body.approval_request_id);
      const frozen = await call(ctx.app, "POST", "/v1/regulatory/submissions", period, "admin@winecore.test");
      expect(frozen.status).toBe(409);
      expect(frozen.body.code).toBe("WC120");

      await expect(ctx.writer.withWrite({ type: "user", id: admin, requestId: newId() }, (tx) => enqueueRun(tx, submissionId)))
        .rejects.toMatchObject({ code: "WC_ILLEGAL_TRANSITION" });

      const withoutStep = await call(ctx.app, "POST", `/v1/approvals/${approvalId}/decide`, {
        decision: "approve",
        payload_sha256: hash,
      }, "owner@winecore.test");
      expect(withoutStep.status).toBe(401);
      expect(withoutStep.body.code).toBe("WC_STEP_UP_REQUIRED");

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
      const after = await call(ctx.app, "GET", `/v1/regulatory/submissions/${submissionId}`, undefined, "admin@winecore.test");
      expect(after.body.status).toBe("approved");
      expect(after.body.phase).toBe("approved");

      const early = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/mark-submitted`, {
        external_ref: "CSVSINT20270001",
      }, "bodega@winecore.test");
      expect(early.status).toBe(403);
      const submitted = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/mark-submitted`, {
        external_ref: "CSVSINT20270001",
      }, "admin@winecore.test");
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe("submitted");
      expect(submitted.body.phase).toBe("submitted");
      expect(submitted.body.external_ref).toBe("CSVSINT20270001");
      const repeat = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/mark-submitted`, {
        external_ref: "CSVSINT20270001",
      }, "admin@winecore.test");
      expect(repeat.status).toBe(200);

      const entries = submitted.body.entries as { id: string }[];
      const resulted = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/mark-result`, {
        result: "accepted",
        items: [{ entry_id: entries[0]?.id, aeat_entry_number: "AS-SINT-000001", result: "accepted" }],
      }, "admin@winecore.test");
      expect(resulted.status).toBe(200);
      expect(resulted.body.phase).toBe("accepted");
      const evidence = await ctx.writer.read<{ summary: string }>(sql`
        SELECT response_summary::VARCHAR AS summary
        FROM regulatory.submission
        WHERE id = CAST(${submissionId} AS UUID)
      `);
      expect(evidence[0]?.summary).toContain("CSVSINT20270001");

      const correction = await call(ctx.app, "POST", `/v1/regulatory/submissions/${submissionId}/correct`, {
        reason: "1",
      }, "admin@winecore.test");
      expect(correction.status).toBe(200);
      expect(correction.body.rectifies_submission_id).toBe(submissionId);
      expect(correction.body.id).not.toBe(submissionId);
      const anulacion = await download(
        ctx.app,
        `/v1/regulatory/submissions/${String(correction.body.id)}/file?part=anulaciones`,
        "admin@winecore.test",
      );
      expect(latin1(anulacion.bytes)).toContain("AS-SINT-000001;1");
      const realta = await download(ctx.app, `/v1/regulatory/submissions/${String(correction.body.id)}/file`, "admin@winecore.test");
      expect(latin1(realta.bytes)).toContain("AS-SINT-000001");
      expect(latin1(realta.bytes)).toContain("A01");
      const correctionId = String(correction.body.id);
      const correctionHash = String(correction.body.content_sha256);
      const correctionReady = await call(ctx.app, "POST", `/v1/regulatory/submissions/${correctionId}/validate`, {}, "admin@winecore.test");
      expect(correctionReady.body.status).toBe("validated");
      const correctionAsked = await call(ctx.app, "POST", `/v1/regulatory/submissions/${correctionId}/request-approval`, {}, "admin@winecore.test");
      expect(correctionAsked.status).toBe(200);
      const correctionApproved = await call(ctx.app, "POST", `/v1/approvals/${String(correctionAsked.body.approval_request_id)}/decide`, {
        decision: "approve",
        payload_sha256: correctionHash,
      }, "owner@winecore.test");
      expect(correctionApproved.status).toBe(200);
      const correctionSent = await call(ctx.app, "POST", `/v1/regulatory/submissions/${correctionId}/mark-submitted`, {
        external_ref: "CSVSINT20270002",
      }, "admin@winecore.test");
      expect(correctionSent.status).toBe(200);
      const correctionDone = await call(ctx.app, "POST", `/v1/regulatory/submissions/${correctionId}/mark-result`, {
        result: "accepted",
      }, "admin@winecore.test");
      expect(correctionDone.status).toBe(200);
      const original = await call(ctx.app, "GET", `/v1/regulatory/submissions/${submissionId}`, undefined, "admin@winecore.test");
      expect(original.body.status).toBe("accepted");
      expect(original.body.phase).toBe("corrected");
    } finally {
      await ctx.close();
    }
  });

  it("bloquea la aprobación si el saldo es negativo, falta el NC o hay una operación abierta", async () => {
    const ctx = await createTestApp({ now: () => new Date("2027-06-15T10:00:00.000Z") });
    try {
      const po = await entityId(ctx);
      const warehouse = newId();
      await ctx.writer.withWrite({ type: "system", id: "silicie-test", requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), 'ES00000V0001T', 'V1', 'Fábrica sintética', TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.fiscal_move (
            id, tax_warehouse_id, fiscal_date, move_type, product_class, volume_ml, units, abv_pct,
            excise_product_key, justification_type, justification_ref, fiscal_trigger,
            source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${warehouse} AS UUID), DATE '2027-02-01', 'opening', 'bulk',
            1000, 0, 12.50, 'GRANEL-TINTO', 'count_record', 'AF-SINT', 'count',
            'inventory.inventory_count', CAST(${newId()} AS UUID), 'silicie-test'
          )
        `);
      });
      const missing = await call(ctx.app, "POST", "/v1/regulatory/submissions", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        period_start: "2027-01-01",
        period_end: "2027-07-31",
        recorded_on: "2027-10-01",
        aggregation: "none",
      }, "admin@winecore.test");
      expect(missing.status).toBe(200);
      const missingErrors = (missing.body.validation as { errors: { code: string; message: string }[] }).errors;
      expect(missingErrors.some((issue) => issue.code === "nc_ausente" && issue.message.includes("código NC"))).toBe(true);
      const no = await call(ctx.app, "POST", `/v1/regulatory/submissions/${String(missing.body.id)}/request-approval`, {}, "admin@winecore.test");
      expect(no.status).toBe(409);

      await call(ctx.app, "POST", "/v1/silicie-ledgers", {
        tax_warehouse_id: warehouse,
        product_class: "bulk",
        color: "tinto",
        nc_code: "220429",
      }, "admin@winecore.test");
      await ctx.writer.withWrite({ type: "system", id: "silicie-test", requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.fiscal_move (
            id, tax_warehouse_id, fiscal_date, move_type, product_class, volume_ml, units, abv_pct,
            excise_product_key, justification_type, justification_ref, fiscal_trigger,
            source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${warehouse} AS UUID), DATE '2027-02-02', 'loss', 'bulk',
            -5000, 0, 12.50, 'GRANEL-TINTO', 'internal', 'MERMA-SINT', 'operation',
            'cellar.operation', CAST(${newId()} AS UUID), 'silicie-test'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation (
            id, legal_entity_id, op_type, occurred_at, status, performed_by, created_by, silicie_relevant
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${po} AS UUID), 'racking',
            TIMESTAMPTZ '2027-02-03 12:00:00+00', 'draft', 'Sintetico', 'silicie-test', TRUE
          )
        `);
      });
      const blocked = await call(ctx.app, "POST", "/v1/regulatory/submissions", {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        period_start: "2027-01-01",
        period_end: "2027-07-31",
        recorded_on: "2027-10-01",
        aggregation: "none",
      }, "admin@winecore.test");
      const codes = (blocked.body.validation as { errors: { code: string }[] }).errors.map((issue) => issue.code);
      expect(codes).toContain("saldo_negativo");
      expect(codes).toContain("operacion_abierta");
      const checked = await call(ctx.app, "POST", `/v1/regulatory/submissions/${String(blocked.body.id)}/validate`, {}, "admin@winecore.test");
      expect(checked.body.ready_for_approval).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it("avisa de una obligación SILICIE vencida por el outbox", async () => {
    const now = new Date("2027-11-03T10:00:00.000Z");
    const ctx = await createTestApp({ now: () => now, log: () => undefined });
    try {
      const po = await entityId(ctx);
      await ctx.writer.withWrite({ type: "system", id: "silicie-test", requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${newId()} AS UUID), CAST(${po} AS UUID), 'ES00000V0000T', 'V1', 'Fábrica sintética', TRUE)
        `);
      });
      const scan = await refreshRegulatoryCalendar(ctx.writer, now);
      expect(scan.inserted).toBeGreaterThan(0);
      expect(scan.emitted).toBeGreaterThan(0);
      const dispatched = await dispatchOutbox({
        writer: ctx.writer,
        config: ctx.config,
        now: () => now,
        log: () => undefined,
      });
      expect(dispatched.internal).toBeGreaterThan(0);
      const notes = await ctx.writer.read<{ kind: string }>(sql`
        SELECT kind FROM core.notification WHERE kind = 'regulatory.obligation.overdue'
      `);
      expect(notes.length).toBeGreaterThan(0);
      const second = await refreshRegulatoryCalendar(ctx.writer, now);
      expect(second.emitted).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});
