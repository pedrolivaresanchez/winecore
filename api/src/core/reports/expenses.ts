import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { companyOf } from './companies';
import { addYears, buildReport, foldDocuments, readLine } from './metrics';
import type { ReportBody, ReportScope } from './types';

/**
 * Gastos del periodo = libro de recibidas: facturas de proveedor aprobadas.
 * La fecha del libro es la contable y, si falta, la de expedición.
 * Un abono aprobado (importe negativo) reduce el gasto.
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
  const body = buildReport('expenses', scope, current, previous, null);
  body.companies = await expenseCompanies(writer, scope);
  return body;
}

async function expenseCompanies(writer: Writer, scope: ReportScope): Promise<ReportBody['companies']> {
  const rows = await writer.read(sql`
    SELECT e.code AS code,
           CAST(COALESCE(sum(s.total), 0) AS VARCHAR) AS amount,
           CAST(COALESCE(sum(s.subtotal), 0) AS VARCHAR) AS base,
           CAST(COALESCE(sum(s.tax_total), 0) AS VARCHAR) AS tax,
           '0' AS units,
           '0' AS volume_ml
    FROM purchasing.supplier_invoice s
    JOIN core.legal_entity e ON e.id = s.legal_entity_id
    WHERE s.status = 'approved'
      AND COALESCE(s.accounting_date, s.issue_date) BETWEEN CAST(${scope.from} AS DATE) AND CAST(${scope.to} AS DATE)
      AND ((${scope.po} = TRUE AND e.code = 'PO') OR (${scope.cvpo} = TRUE AND e.code = 'CVPO'))
    GROUP BY e.code
    ORDER BY e.code
  `);
  return rows.flatMap((row) => companyOf(row));
}

async function loadExpenses(writer: Writer, scope: ReportScope, from: string, to: string) {
  const rows = await writer.read(sql`
    WITH docs AS (
      SELECT s.id, s.supplier_id, s.category_code, s.subtotal, s.tax_total, s.total,
             COALESCE(s.accounting_date, s.issue_date) AS doc_date
      FROM purchasing.supplier_invoice s
      JOIN core.legal_entity e ON e.id = s.legal_entity_id
      WHERE s.status = 'approved'
        AND COALESCE(s.accounting_date, s.issue_date) BETWEEN CAST(${from} AS DATE) AND CAST(${to} AS DATE)
        AND ((${scope.po} = TRUE AND e.code = 'PO') OR (${scope.cvpo} = TRUE AND e.code = 'CVPO'))
    )
    SELECT 'e:' || CAST(s.id AS VARCHAR) AS doc_id,
           CAST(s.doc_date AS VARCHAR) AS issue_date,
           CAST(s.supplier_id AS VARCHAR) AS customer_id,
           c.legal_name AS customer_label,
           CAST(COALESCE(s.subtotal, 0) AS VARCHAR) AS doc_base,
           CAST(COALESCE(s.tax_total, 0) AS VARCHAR) AS doc_tax,
           CAST(COALESCE(s.total, 0) AS VARCHAR) AS doc_amount,
           COALESCE(l.line_no, 0) AS line_no,
           CAST(l.product_id AS VARCHAR) AS product_id,
           CASE WHEN p.id IS NULL THEN l.description ELSE p.sku || ' · ' || p.name END AS product_label,
           CAST(COALESCE(po.wine_id, lo.wine_id, p.wine_id, lot.wine_id) AS VARCHAR) AS wine_id,
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
    LEFT JOIN catalog.product_overlay po ON po.product_id = p.id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    LEFT JOIN inventory.lot lot ON 1 = 0
    LEFT JOIN inventory.lot_overlay lo ON lo.lot_id = lot.id
    LEFT JOIN catalog.wine_visible w ON w.id = COALESCE(po.wine_id, lo.wine_id, p.wine_id, lot.wine_id)
  `);
  return rows.map((row) => readLine(row));
}
