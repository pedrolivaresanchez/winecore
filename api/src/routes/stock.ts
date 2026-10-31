import type { Writer } from '../core/db/writer';
import { DomainError } from '../core/errors';
import { toCsv } from '../core/inventory/service/inspection-doc';
import {
  buildInspection,
  inspectionCsv,
  inspectionPage,
  listBalances,
  listFiscalBalances,
  listMoves,
} from '../core/inventory/service/stock.service';
import { balanceQuery, fiscalQuery, formatOf, moveQuery } from './stock-http';

export async function stockBalances(writer: Writer, request: Request) {
  return listBalances(writer, balanceQuery(request, 100));
}

export async function stockFiscalBalances(writer: Writer, request: Request) {
  return listFiscalBalances(writer, fiscalQuery(request));
}

export async function stockInspection(writer: Writer, request: Request) {
  const format = formatOf(request);
  const document = await buildInspection(writer, balanceQuery(request, 1000));
  if (format === 'html') {
    return new Response(inspectionPage(document), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (format === 'csv') {
    return new Response(inspectionCsv(document), {
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    });
  }
  return document;
}

export async function stockMoves(writer: Writer, request: Request) {
  const format = formatOf(request);
  if (format === 'html') {
    throw new DomainError('WC_VALIDATION', 422, 'El formato no es válido.', { format: 'html' });
  }
  const query = moveQuery(request);
  if (format === 'csv') {
    query.limit = 5000;
    query.cursor = null;
  }
  const page = await listMoves(writer, query);
  if (format === 'csv') {
    if (page.next_cursor) {
      throw new DomainError('WC_VALIDATION', 422, 'Acota el periodo para exportar.', { format: 'csv' });
    }
    const columns = page.book === 'physical'
      ? ['id', 'occurred_at', 'move_type', 'location_id', 'vessel_id', 'owner_entity_id', 'lot_id', 'product_id', 'product_state', 'qty_units', 'volume_ml', 'mass_g', 'loss_kind', 'source_table', 'source_id', 'source_line_id', 'reverses_move_id', 'created_by', 'created_at', 'period_closed']
      : ['id', 'tax_warehouse_id', 'fiscal_date', 'physical_date', 'move_type', 'product_class', 'lot_id', 'product_id', 'volume_ml', 'units', 'abv_pct', 'excise_product_key', 'nc_code', 'justification_type', 'justification_ref', 'counterparty_contact_id', 'counterparty_excise_number', 'fiscal_trigger', 'source_table', 'source_id', 'source_line_id', 'silicie_entry_id', 'reverses_move_id', 'reason', 'created_by', 'created_at', 'period_closed'];
    return new Response(toCsv(columns, page.items), {
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    });
  }
  return page;
}
