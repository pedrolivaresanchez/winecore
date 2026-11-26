import { domainError } from '../errors';
import type { Writer } from '../db/writer';
import { buildXlsx, type XlsxCell } from '../export/xlsx';
import { renderListPdf } from '../export/list-pdf';
import { NOT_COUNTED } from '../sales-documents/status';
import { sql } from '../db/sql';
import { decOf } from './db';
import { salesOrderFilters } from './orders';

const EXPORT_LIMIT = 50_000;
const NOTE = 'Sin anuladas, canceladas ni rechazadas. Las rectificativas suman con su importe.';

const ORDER_STATUS: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmado',
  partially_delivered: 'Parcial',
  delivered: 'Servido',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

const INVOICING_STATUS: Record<string, string> = {
  not_invoiced: 'Sin facturar',
  partially_invoiced: 'Factura parcial',
  invoiced: 'Facturado',
  not_invoiceable: 'No facturable',
};

interface OrderRow {
  number: string | null;
  order_date: string | null;
  customer: string;
  channel: string;
  entity_code: string;
  subtotal: string;
  total: string;
  status: string;
  invoicing_status: string;
}

export async function exportSalesOrders(writer: Writer, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const format = url.searchParams.get('format')?.trim().toLowerCase();
  if (format !== 'xlsx' && format !== 'pdf') throw domainError('WC_VALIDATION', { format: 'Debe ser xlsx o pdf' });
  const { where } = salesOrderFilters(url);
  const excluded = NOT_COUNTED.map((status) => sql`${status}`).join(', ');
  const [rows, stats] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      SELECT o.number, CAST(o.order_date AS VARCHAR) AS order_date,
             COALESCE(c.legal_name, '') AS customer,
             COALESCE(ch.name_es, o.channel) AS channel,
             COALESCE(e.code, '') AS entity_code,
             CAST(o.subtotal AS VARCHAR) AS subtotal,
             CAST(o.total AS VARCHAR) AS total,
             o.status, o.invoicing_status
        FROM sales.sales_order o
        LEFT JOIN party.contact c ON c.id = o.customer_id
        LEFT JOIN sales.channel ch ON ch.code = o.channel
        LEFT JOIN core.legal_entity e ON e.id = o.legal_entity_id
       WHERE ${where}
       ORDER BY o.id DESC
       LIMIT ${EXPORT_LIMIT}
    `),
    writer.read<Record<string, unknown>>(`
      SELECT count(*) AS n,
             CAST(COALESCE(sum(CASE WHEN status NOT IN (${excluded}) THEN subtotal END), 0) AS VARCHAR) AS base,
             CAST(COALESCE(sum(CASE WHEN status NOT IN (${excluded}) THEN total END), 0) AS VARCHAR) AS amount
        FROM sales.sales_order
       WHERE ${where}
    `),
  ]);
  const items = rows.map(orderOf);
  const stat = stats[0];
  const totals = { base: decOf(stat?.base).toFixed(2), amount: decOf(stat?.amount).toFixed(2) };
  const total = Number(stat?.n ?? items.length);
  const file = format === 'xlsx' ? xlsxOf(items, totals, total) : await pdfOf(items, totals, total);
  return new Response(file, {
    headers: {
      'Content-Type': format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
      'Content-Disposition': `attachment; filename="pedidos.${format}"`,
    },
  });
}

function orderOf(row: Record<string, unknown>): OrderRow {
  return {
    number: row.number == null || String(row.number).trim() === '' ? null : String(row.number),
    order_date: row.order_date == null ? null : String(row.order_date).slice(0, 10),
    customer: String(row.customer ?? ''),
    channel: String(row.channel ?? ''),
    entity_code: String(row.entity_code ?? ''),
    subtotal: decOf(row.subtotal).toFixed(2),
    total: decOf(row.total).toFixed(2),
    status: ORDER_STATUS[String(row.status)] ?? String(row.status),
    invoicing_status: INVOICING_STATUS[String(row.invoicing_status)] ?? String(row.invoicing_status),
  };
}

const HEADERS = ['Número', 'Fecha', 'Cliente', 'Canal', 'Sociedad', 'Base', 'Total', 'Estado', 'Facturación'] as const;

function xlsxOf(items: OrderRow[], totals: { base: string; amount: string }, total: number): Uint8Array {
  const rows: XlsxCell[][] = [HEADERS.slice()];
  for (const item of items) rows.push(line(item));
  rows.push([]);
  rows.push(['Total', null, null, null, null, Number(totals.base), Number(totals.amount), null, null]);
  rows.push([NOTE]);
  if (total > items.length) rows.push([`Se exportan las primeras ${items.length} filas de ${total}. El total es el del filtro completo.`]);
  return buildXlsx('Pedidos', rows);
}

async function pdfOf(items: OrderRow[], totals: { base: string; amount: string }, total: number): Promise<Uint8Array> {
  const columns = [
    { header: 'Número', align: 'left' as const, width: 88 },
    { header: 'Fecha', align: 'left' as const, width: 64 },
    { header: 'Cliente', align: 'left' as const, width: 160 },
    { header: 'Canal', align: 'left' as const, width: 90 },
    { header: 'Sociedad', align: 'left' as const, width: 52 },
    { header: 'Base', align: 'right' as const, width: 68 },
    { header: 'Total', align: 'right' as const, width: 68 },
    { header: 'Estado', align: 'left' as const, width: 72 },
    { header: 'Facturación', align: 'left' as const, width: 90 },
  ];
  const note = total > items.length ? `${NOTE} Se exportan las primeras ${items.length} filas de ${total}.` : NOTE;
  return renderListPdf({
    title: 'Pedidos',
    columns,
    rows: items.map((item) => line(item).map((cell) => (typeof cell === 'number' ? spanishMoney(cell) : cell ?? ''))),
    totals: ['Total', '', '', '', '', spanishMoney(Number(totals.base)), spanishMoney(Number(totals.amount)), '', ''],
    note,
  });
}

function line(item: OrderRow): XlsxCell[] {
  return [
    item.number ?? 'Borrador',
    spanishDate(item.order_date),
    item.customer,
    item.channel,
    item.entity_code === 'PO' ? 'P.O' : item.entity_code,
    Number(item.subtotal),
    Number(item.total),
    item.status,
    item.invoicing_status,
  ];
}

function spanishDate(value: string | null): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function spanishMoney(value: number): string {
  if (!Number.isFinite(value)) return '';
  const sign = value < 0 ? '-' : '';
  const [whole, frac] = Math.abs(value).toFixed(2).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${frac}`;
}
