import { domainError } from '../errors';
import { buildXlsx, type XlsxCell } from '../export/xlsx';
import { renderListPdf } from '../export/list-pdf';
import type { Writer } from '../db/writer';
import type { UserCtx } from '../auth/permissions';
import { listSalesDocuments, type SalesDocumentItem, type SalesDocumentPage } from './list';

const EXPORT_LIMIT = 50_000;
const NOTE = 'Sin anuladas, canceladas ni rechazadas. Las rectificativas suman con su importe.';

export async function exportSalesDocuments(writer: Writer, user: UserCtx, url: URL, now: Date): Promise<Response> {
  const format = url.searchParams.get('format')?.trim().toLowerCase();
  if (format !== 'xlsx' && format !== 'pdf') throw domainError('WC_VALIDATION', { format: 'Debe ser xlsx o pdf' });
  const page = await listSalesDocuments(writer, user, url, now, { limit: EXPORT_LIMIT, offset: 0 });
  const file = format === 'xlsx' ? xlsxOf(page) : await pdfOf(page);
  const filename = `${fileName(page)}.${format}`;
  return new Response(file, {
    headers: {
      'Content-Type': format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function fileName(page: SalesDocumentPage): string {
  if (page.kind === 'quote') return 'presupuestos';
  if (page.kind === 'delivery_note') return 'albaranes';
  return page.direction === 'purchase' ? 'gastos' : 'facturas';
}

function titleOf(page: SalesDocumentPage): string {
  if (page.kind === 'quote') return 'Presupuestos';
  if (page.kind === 'delivery_note') return 'Albaranes';
  return page.direction === 'purchase' ? 'Gastos' : 'Facturas';
}

interface Column {
  header: string;
  align: 'left' | 'right';
  width: number;
  cell: (item: SalesDocumentItem) => XlsxCell;
  text: (item: SalesDocumentItem) => string;
}

function columnsOf(page: SalesDocumentPage): Column[] {
  const money = (value: string | null): number | null => (value == null ? null : Number(value));
  const textMoney = (value: string | null): string => (value == null ? '' : spanishMoney(value));
  const columns: Column[] = [
    { header: 'Número', align: 'left', width: 90, cell: (item) => item.number ?? 'Borrador', text: (item) => item.number ?? 'Borrador' },
    { header: 'Fecha', align: 'left', width: 68, cell: (item) => spanishDate(item.issue_date), text: (item) => spanishDate(item.issue_date) },
    {
      header: page.direction === 'purchase' ? 'Proveedor' : 'Cliente',
      align: 'left',
      width: 190,
      cell: (item) => item.customer.name,
      text: (item) => item.customer.name,
    },
    { header: 'Sociedad', align: 'left', width: 56, cell: (item) => entityName(item.entity_code), text: (item) => entityName(item.entity_code) },
    { header: 'Base', align: 'right', width: 72, cell: (item) => money(item.base), text: (item) => textMoney(item.base) },
    { header: 'Total', align: 'right', width: 72, cell: (item) => money(item.total), text: (item) => textMoney(item.total) },
  ];
  if (page.kind === 'invoice') {
    columns.push({ header: 'Pendiente', align: 'right', width: 76, cell: (item) => money(item.pending), text: (item) => textMoney(item.pending) });
  }
  columns.push({ header: 'Estado', align: 'left', width: 120, cell: (item) => item.status_label, text: (item) => item.status_label });
  return columns;
}

function totalCell(header: string, page: SalesDocumentPage): XlsxCell {
  if (header === 'Base') return Number(page.totals.base);
  if (header === 'Total') return Number(page.totals.amount);
  if (header === 'Pendiente') return Number(page.totals.pending);
  return null;
}

function xlsxOf(page: SalesDocumentPage): Uint8Array {
  const columns = columnsOf(page);
  const rows: XlsxCell[][] = [columns.map((column) => column.header)];
  for (const item of page.items) rows.push(columns.map((column) => column.cell(item)));
  rows.push([]);
  rows.push(columns.map((column, index) => (index === 0 ? 'Total' : totalCell(column.header, page))));
  rows.push([NOTE]);
  if (page.total > page.items.length) rows.push([`Se exportan las primeras ${page.items.length} filas de ${page.total}. El total es el del filtro completo.`]);
  return buildXlsx(titleOf(page), rows);
}

async function pdfOf(page: SalesDocumentPage): Promise<Uint8Array> {
  const columns = columnsOf(page);
  const note = page.total > page.items.length
    ? `${NOTE} Se exportan las primeras ${page.items.length} filas de ${page.total}.`
    : NOTE;
  return renderListPdf({
    title: titleOf(page),
    columns: columns.map((column) => ({ header: column.header, align: column.align, width: column.width })),
    rows: page.items.map((item) => columns.map((column) => column.text(item))),
    totals: columns.map((column, index) => (index === 0 ? 'Total' : column.header === 'Base' || column.header === 'Total' || column.header === 'Pendiente' ? spanishMoney(String(totalCell(column.header, page))) : '')),
    note,
  });
}

function entityName(code: string): string {
  if (code === 'PO') return 'P.O';
  return code;
}

function spanishDate(value: string | null): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function spanishMoney(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const sign = amount < 0 ? '-' : '';
  const [whole, frac] = Math.abs(amount).toFixed(2).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${frac}`;
}
