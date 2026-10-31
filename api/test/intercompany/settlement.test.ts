import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Writer } from '../../src/core/db/writer';
import { sql } from '../../src/core/db/sql';
import { closeSettlement, requestIntercompanyInvoice, type SettlementView } from '../../src/core/intercompany/settlement';
import { activateTariff } from '../../src/core/intercompany/tariff';
import { createTestApp } from '../helpers';
import {
  CVPO,
  OWNER,
  PO,
  actor,
  addProduct,
  draftDefaultTariff,
  ownershipMove,
  seedCatalog,
  type Catalog,
} from './fixture';
import { newId } from '../../src/core/ids';
import { money } from '../../src/core/money';

describe('liquidación mensual P.O → CVPO', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let catalog: Catalog;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.writer.withWrite(actor, async (tx) => {
      catalog = await seedCatalog(tx);
    });
    let tariffId = '';
    await ctx.writer.withWrite(actor, async (tx) => {
      tariffId = await draftDefaultTariff(tx, catalog.priceListId);
    });
    await ctx.writer.withWrite(actor, async (tx) => {
      await activateTariff(tx, tariffId);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('valora el mes, deja la operación en el último día y no se duplica', async () => {
    await ctx.writer.withWrite(actor, async (tx) => {
      ownershipMove(tx, {
        at: '2027-06-15T10:00:00Z',
        units: 10,
        productId: catalog.productId,
        lotId: catalog.lotId,
        locationId: catalog.fromLocationId,
      });
    });
    const first = await close('2027-06', '2027-07-12');
    expect(first.operation_date).toBe('2027-06-30');
    expect(first.issue_deadline).toBe('2027-07-15');
    expect(first.warn_from).toBe('2027-07-12');
    expect(first.watcher_status).toBe('pending_issue');
    expect(first.pending_issue).toBe(true);
    expect(first.status).toBe('closed');
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]?.quantity).toBe('10.000');
    expect(first.lines[0]?.unit_price).toBe('5.000000');
    expect(first.lines[0]?.base_unit_price).toBe('12.500000');
    expect(first.lines[0]?.discount_pct).toBe('60.00');
    expect(first.totals.amount).toBe('50.00');
    expect(first.invoice?.issuer_income_tax).toBe('IRPF');
    expect(first.invoice?.operation_date).toBe('2027-06-30');
    expect(first.invoice?.issue_date).toBeNull();
    expect(first.invoice?.subtotal).toBe('50.00');
    expect(first.invoice?.tax_total).toBe('10.50');
    expect(first.invoice?.withholding_total).toBe('0.00');
    expect(first.invoice?.importe_total).toBe('60.50');
    expect(first.invoice?.total_to_pay).toBe('60.50');
    expect(first.invoice?.subtotal).toBe(first.totals.amount);

    const again = await close('2027-06', '2027-07-11');
    expect(again.id).toBe(first.id);
    expect(again.invoice?.id).toBe(first.invoice?.id);
    expect(again.watcher_status).toBe('draft');
    expect(await count(ctx.writer, `SELECT count(*)::INTEGER AS n FROM billing.intercompany_settlement`)).toBe(1);
    expect(await count(ctx.writer, `SELECT count(*)::INTEGER AS n FROM billing.invoice WHERE is_intercompany`)).toBe(1);
    expect(await count(ctx.writer, `SELECT count(*)::INTEGER AS n FROM billing.intercompany_settlement_line`)).toBe(1);

    const requested = await ctx.writer.withWrite(actor, (tx) => requestIntercompanyInvoice(
      tx,
      String(first.id),
      OWNER,
      new Date('2027-11-12T08:00:00Z'),
      '2027-11-12',
    ));
    expect(requested.invoice?.status).toBe('pending_approval');
    expect(requested.invoice?.approval_request_id).toBeTruthy();
    const repeated = await ctx.writer.withWrite(actor, (tx) => requestIntercompanyInvoice(
      tx,
      String(first.id),
      OWNER,
      new Date('2027-11-12T09:00:00Z'),
      '2027-11-12',
    ));
    expect(repeated.invoice?.approval_request_id).toBe(requested.invoice?.approval_request_id);
    expect(await count(ctx.writer, `SELECT count(*)::INTEGER AS n FROM ops.approval_request`)).toBe(1);
    expect(await count(ctx.writer, `SELECT count(*)::INTEGER AS n FROM billing.invoice_line`)).toBe(1);
  });

  it('respeta los límites del mes en hora de Madrid', async () => {
    await ctx.writer.withWrite(actor, async (tx) => {
      for (const move of [
        { at: '2027-09-30T21:59:59Z', units: 1 },
        { at: '2027-09-30T22:00:00Z', units: 2 },
        { at: '2027-10-31T22:59:00Z', units: 4 },
        { at: '2027-10-31T23:00:00Z', units: 8 },
      ]) {
        ownershipMove(tx, {
          at: move.at,
          units: move.units,
          productId: catalog.productId,
          lotId: catalog.lotId,
          locationId: catalog.fromLocationId,
        });
      }
      await transferNote(tx, catalog, '2027-10-31', 3, 'TR-1031');
      await transferNote(tx, catalog, '2027-11-01', 5, 'TR-1101');
      await transferNote(tx, catalog, '2027-09-30', 7, 'TR-0930');
    });
    const view = await close('2027-11', '2027-12-01');
    const units = view.lines.reduce((sum, line) => sum + Number(line.quantity), 0);
    expect(units).toBe(13);
    expect(view.lines.map((line) => line.occurred_on).sort()).toEqual(['2027-11-01', '2027-11-01']);

    const previous = await close('2027-10', '2027-11-01');
    const previousUnits = previous.lines.reduce((sum, line) => sum + Number(line.quantity), 0);
    expect(previousUnits).toBe(9);
    expect(previous.lines.some((line) => line.quantity === '1.000')).toBe(false);
    expect(previous.lines.some((line) => line.quantity === '8.000')).toBe(false);
    expect(previous.lines.some((line) => line.document_number === 'TR-1031')).toBe(true);
    expect(previous.lines.some((line) => line.document_number === 'TR-1101')).toBe(false);
  });

  it('la base de la factura es la suma de las líneas de liquidación', async () => {
    let awkward = '';
    await ctx.writer.withWrite(actor, async (tx) => {
      awkward = addProduct(tx, catalog, { sku: 'VINAWK', name: 'Vino incómodo', unitPrice: '0.833333', requiresLot: true });
      await valuedTransfer(tx, catalog, awkward, '2027-04-02', '1.001', 'AWK-1');
      await valuedTransfer(tx, catalog, awkward, '2027-04-18', '1.001', 'AWK-2');
    });
    const view = await close('2027-04', '2027-05-01');
    const awkwardLines = view.lines.filter((line) => line.product_id === awkward);
    expect(awkwardLines).toHaveLength(2);
    expect(view.invoice?.subtotal).toBe(view.totals.amount);
    expect(view.invoice?.lines).toHaveLength(1);
    expect(view.invoice?.lines[0]?.line_base).toBe('0.66');
    expect(view.invoice?.subtotal).toBe('0.66');
    expect(view.invoice?.tax_total).toBe('0.14');
    expect(view.invoice?.importe_total).toBe('0.80');
    expect(view.invoice?.total_to_pay).toBe('0.80');
  });

  it('separa la retención de IRPF del importe total', async () => {
    let service = '';
    await ctx.writer.withWrite(actor, async (tx) => {
      service = addProduct(tx, catalog, {
        sku: 'SRVIRPF',
        name: 'Servicio con retención',
        unitPrice: '250.000000',
        taxCode: 'IVA21_ALQ',
        requiresLot: false,
        tracked: false,
      });
      await valuedTransfer(tx, catalog, service, '2027-05-20', '1.000', 'SRV-1');
    });
    const view = await close('2027-05', '2027-06-01');
    expect(view.invoice?.issuer_income_tax).toBe('IRPF');
    expect(view.invoice?.subtotal).toBe('100.00');
    expect(view.invoice?.tax_total).toBe('21.00');
    expect(view.invoice?.withholding_total).toBe('19.00');
    expect(view.invoice?.importe_total).toBe('121.00');
    expect(view.invoice?.total_to_pay).toBe('102.00');
    expect(view.invoice?.subtotal).toBe(view.totals.amount);
  });

  it('bloquea el cierre sin tarifa o por debajo del coste hasta que se reconoce', async () => {
    let missing = '';
    let costly = '';
    await ctx.writer.withWrite(actor, async (tx) => {
      missing = addProduct(tx, catalog, { sku: 'SINTAR', name: 'Sin tarifa', unitPrice: null });
      costly = addProduct(tx, catalog, { sku: 'CARO', name: 'Por debajo de coste', unitPrice: '12.500000' });
      tx.write(sql`
        INSERT INTO catalog.standard_cost (id, product_id, valid_from, unit_cost, source, created_by)
        VALUES (
          CAST(${newId()} AS UUID), CAST(${costly} AS UUID), DATE '2026-01-01',
          ${money.fromString('6')}, 'manual', ${OWNER}
        )
      `);
      await valuedTransfer(tx, catalog, missing, '2027-02-10', '1.000', 'MIS-1');
      await valuedTransfer(tx, catalog, costly, '2027-03-10', '2.000', 'COST-1');
    });
    await expect(close('2027-02', '2027-03-01')).rejects.toMatchObject({ code: 'WC_IC_TARIFF_MISSING' });
    await expect(close('2027-03', '2027-04-01')).rejects.toMatchObject({ code: 'WC_IC_BELOW_COST' });
    const acknowledged = await ctx.writer.withWrite(actor, (tx) => closeSettlement(tx, {
      period: '2027-03',
      today: '2027-04-01',
      actorId: OWNER,
      now: new Date('2027-04-01T08:00:00Z'),
      belowCostAcknowledged: true,
    }));
    expect(acknowledged.lines[0]?.below_cost).toBe(true);
    expect(acknowledged.lines[0]?.unit_price).toBe('5.000000');
  });

  it('un mes vacío no genera factura', async () => {
    const view = await close('2027-08', '2027-09-12');
    expect(view.status).toBe('closed');
    expect(view.lines).toHaveLength(0);
    expect(view.invoice).toBeNull();
    expect(view.watcher_status).toBe('no_movements');
    expect(view.watcher_message).toContain('agosto 2027');
  });

  it('publica el cierre por la API', async () => {
    const opened = await ctx.app.handle(new Request('http://localhost/v1/intercompany/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: '2027-07' }),
    }));
    expect(opened.status).toBe(200);
    const created = await opened.json() as SettlementView;
    const closed = await ctx.app.handle(new Request(`http://localhost/v1/intercompany/settlements/${created.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(closed.status).toBe(200);
    const body = await closed.json() as SettlementView;
    expect(body.operation_date).toBe('2027-07-31');
    expect(body.watcher_status).toBe('no_movements');
    const forbidden = await ctx.app.handle(new Request('http://localhost/v1/intercompany/settlements?period=2027-07', {
      headers: { 'X-Dev-User': 'bodega@winecore.test' },
    }));
    expect(forbidden.status).toBe(403);
  });

  async function close(period: string, today: string): Promise<SettlementView> {
    return ctx.writer.withWrite(actor, (tx) => closeSettlement(tx, {
      period,
      today,
      actorId: OWNER,
      now: new Date(`${today}T08:00:00Z`),
      belowCostAcknowledged: false,
    }));
  }
});

async function count(writer: Writer, statement: string): Promise<number> {
  const rows = await writer.read<{ n: number }>(statement);
  return Number(rows[0]?.n ?? 0);
}

async function transferNote(tx: Parameters<typeof ownershipMove>[0], catalog: Catalog, issueDate: string, units: number, number: string) {
  const noteId = newId();
  const lineId = newId();
  tx.write(sql`
    INSERT INTO sales.delivery_note (
      id, legal_entity_id, number, kind, status, issue_date, from_location_id, to_location_id, created_by
    ) VALUES (
      CAST(${noteId} AS UUID), CAST(${PO} AS UUID), ${number}, 'transfer', 'issued',
      CAST(${issueDate} AS DATE), CAST(${catalog.fromLocationId} AS UUID), CAST(${catalog.toLocationId} AS UUID), 'test'
    )
  `);
  tx.write(sql`
    INSERT INTO sales.delivery_note_line (id, delivery_note_id, line_no, product_id, lot_id, description, quantity)
    VALUES (
      CAST(${lineId} AS UUID), CAST(${noteId} AS UUID), 1, CAST(${catalog.productId} AS UUID),
      CAST(${catalog.lotId} AS UUID), 'Traspaso', ${String(units)}
    )
  `);
}

async function valuedTransfer(
  tx: Parameters<typeof ownershipMove>[0],
  catalog: Catalog,
  productId: string,
  issueDate: string,
  quantity: string,
  number: string,
) {
  const noteId = newId();
  const lineId = newId();
  tx.write(sql`
    INSERT INTO sales.delivery_note (
      id, legal_entity_id, number, kind, status, issue_date, from_location_id, to_location_id, created_by
    ) VALUES (
      CAST(${noteId} AS UUID), CAST(${PO} AS UUID), ${number}, 'transfer', 'issued',
      CAST(${issueDate} AS DATE), CAST(${catalog.fromLocationId} AS UUID), CAST(${catalog.toLocationId} AS UUID), 'test'
    )
  `);
  tx.write(sql`
    INSERT INTO sales.delivery_note_line (id, delivery_note_id, line_no, product_id, lot_id, description, quantity)
    VALUES (
      CAST(${lineId} AS UUID), CAST(${noteId} AS UUID), 1, CAST(${productId} AS UUID),
      CAST(${catalog.lotId} AS UUID), 'Traspaso', ${quantity}
    )
  `);
}
