import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { addYears, buildReport, foldDocuments, readLine } from './metrics';
import type { ReportBody, ReportScope } from './types';

/**
 * Gastos del periodo = libro de recibidas aprobadas más las compras históricas de Holded
 * que no estén anuladas ni ya registradas como factura de proveedor.
 * La fecha del libro es la contable y, si falta, la de expedición.
 * Un abono (importe negativo) reduce el gasto.
 */
export async function expensesReport(writer: Writer, scope: ReportScope): Promise<ReportBody> {
  const current = foldDocuments(await loadExpenses(writer, scope, scope.from, scope.to), scope.groupBy, 'expense');
  const previous = scope.compare === 'previous_year'
    ? foldDocuments(
      await loadExpenses(writer, scope, addYears(scope.from, -1), addYears(scope.to, -1)),
      scope.groupBy,
      'expense',
    )
    : null;
  return buildReport('expenses', scope, current, previous, null);
}

async function loadExpenses(writer: Writer, scope: ReportScope, from: string, to: string) {
  const rows = await writer.read(sql`
    WITH docs AS (
      SELECT s.id, s.supplier_id, s.category_code, s.subtotal, s.tax_total, s.total,
             COALESCE(s.accounting_date, s.issue_date) AS doc_date,
             CAST(NULL AS VARCHAR) AS fallback_name
      FROM purchasing.supplier_invoice s
      JOIN core.legal_entity e ON e.id = s.legal_entity_id
      WHERE s.status = 'approved'
        AND COALESCE(s.accounting_date, s.issue_date) BETWEEN CAST(${from} AS DATE) AND CAST(${to} AS DATE)
        AND ((${scope.po} = TRUE AND e.code = 'PO') OR (${scope.cvpo} = TRUE AND e.code = 'CVPO'))
      UNION ALL
      SELECT h.id, h.counterparty_contact_id, NULL, h.subtotal,
             (h.vat + COALESCE(h.vat_2, 0)), h.total,
             COALESCE(h.accounting_date, h.issue_date),
             h.counterparty_name
      FROM legacy.holded_invoice h
      JOIN core.legal_entity e ON e.id = h.entity_id
      WHERE h.kind = 'purchase'
        AND COALESCE(h.accounting_date, h.issue_date) BETWEEN CAST(${from} AS DATE) AND CAST(${to} AS DATE)
        AND ((${scope.po} = TRUE AND e.code = 'PO') OR (${scope.cvpo} = TRUE AND e.code = 'CVPO'))
        AND lower(trim(h.status_holded)) NOT IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada')
        AND NOT EXISTS (
          SELECT 1 FROM purchasing.supplier_invoice s
          WHERE s.legal_entity_id = h.entity_id
            AND s.supplier_invoice_number = h.number
            AND s.status = 'approved'
        )
    )
    SELECT 'e:' || CAST(s.id AS VARCHAR) AS doc_id,
           CAST(s.doc_date AS VARCHAR) AS issue_date,
           CAST(s.supplier_id AS VARCHAR) AS customer_id,
           COALESCE(c.legal_name, s.fallback_name) AS customer_label,
           CAST(COALESCE(s.subtotal, 0) AS VARCHAR) AS doc_base,
           CAST(COALESCE(s.tax_total, 0) AS VARCHAR) AS doc_tax,
           CAST(COALESCE(s.total, 0) AS VARCHAR) AS doc_amount,
           COALESCE(l.line_no, 0) AS line_no,
           CAST(l.product_id AS VARCHAR) AS product_id,
           CASE WHEN p.id IS NULL THEN l.description ELSE p.sku || ' · ' || p.name END AS product_label,
           CAST(p.wine_id AS VARCHAR) AS wine_id,
           w.name AS wine_label,
           s.category_code AS category,
           cat.name_es AS category_label,
           NULL AS lot_id,
           NULL AS lot_label,
           CAST(COALESCE(l.quantity, 0) AS VARCHAR) AS quantity,
           CAST(COALESCE(f.nominal_volume_ml, 0) AS VARCHAR) AS nominal_ml,
           CAST(COALESCE(l.line_base, CASE WHEN l.line_no IS NULL THEN s.subtotal ELSE 0 END, 0) AS VARCHAR) AS line_base
    FROM docs s
    LEFT JOIN purchasing.supplier_invoice_line l ON l.supplier_invoice_id = s.id
    LEFT JOIN party.contact c ON c.id = s.supplier_id
    LEFT JOIN purchasing.expense_category cat ON cat.code = s.category_code
    LEFT JOIN catalog.product p ON p.id = l.product_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    LEFT JOIN catalog.wine w ON w.id = p.wine_id
  `);
  return rows.map((row) => readLine(row));
}
