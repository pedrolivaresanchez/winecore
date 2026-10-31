import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { addYears, buildReport, foldDocuments, readLine } from './metrics';
import type { ReportBody, ReportScope } from './types';

/**
 * Ventas del periodo = libro de emitidas (facturas `issued`, sin anuladas) más el
 * histórico Holded de ventas que no esté anulado ni ya representado en billing.
 * Una sustitución (`relation = substituted`) quita el original; una rectificativa
 * por diferencias se suma con su propio importe.
 */
export async function salesReport(writer: Writer, scope: ReportScope): Promise<ReportBody> {
  const current = foldDocuments(await loadSales(writer, scope, scope.from, scope.to), scope.groupBy, 'wine');
  const previous = scope.compare === 'previous_year'
    ? foldDocuments(
      await loadSales(writer, scope, addYears(scope.from, -1), addYears(scope.to, -1)),
      scope.groupBy,
      'wine',
    )
    : null;
  return buildReport('sales', scope, current, previous, null);
}

async function loadSales(writer: Writer, scope: ReportScope, from: string, to: string) {
  const rows = await writer.read(sql`
    WITH billing_docs AS (
      SELECT i.id, i.issue_date, i.customer_id, i.subtotal, i.tax_total, i.total
      FROM billing.invoice i
      JOIN core.legal_entity e ON e.id = i.legal_entity_id
      WHERE i.status = 'issued'
        AND i.issue_date BETWEEN CAST(${from} AS DATE) AND CAST(${to} AS DATE)
        AND ((${scope.po} = TRUE AND e.code = 'PO') OR (${scope.cvpo} = TRUE AND e.code = 'CVPO'))
        AND NOT EXISTS (
          SELECT 1
          FROM billing.invoice_rectification r
          JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
          WHERE r.relation = 'substituted'
            AND rect.status = 'issued'
            AND (
              r.rectified_invoice_id = i.id
              OR (
                r.rectified_number = i.number
                AND r.rectified_issue_date = i.issue_date
                AND rect.legal_entity_id = i.legal_entity_id
              )
            )
        )
    ),
    holded_docs AS (
      SELECT h.id, h.entity_id, h.number, h.issue_date, h.counterparty_contact_id, h.counterparty_name,
             h.subtotal, (h.vat + COALESCE(h.vat_2, 0)) AS tax_total, h.total
      FROM legacy.holded_invoice h
      JOIN core.legal_entity e ON e.id = h.entity_id
      WHERE h.kind = 'sale'
        AND h.issue_date BETWEEN CAST(${from} AS DATE) AND CAST(${to} AS DATE)
        AND ((${scope.po} = TRUE AND e.code = 'PO') OR (${scope.cvpo} = TRUE AND e.code = 'CVPO'))
        AND lower(trim(h.status_holded)) NOT IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada')
        AND NOT EXISTS (
          SELECT 1 FROM billing.invoice bi
          WHERE bi.legal_entity_id = h.entity_id
            AND bi.number = h.number
            AND bi.issue_date = h.issue_date
            AND bi.status IN ('issued', 'voided')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM billing.invoice_rectification r
          JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
          WHERE r.relation = 'substituted'
            AND rect.status = 'issued'
            AND r.rectified_number = h.number
            AND r.rectified_issue_date = h.issue_date
            AND rect.legal_entity_id = h.entity_id
        )
    )
    SELECT 'b:' || CAST(i.id AS VARCHAR) AS doc_id,
           CAST(i.issue_date AS VARCHAR) AS issue_date,
           CAST(i.customer_id AS VARCHAR) AS customer_id,
           c.legal_name AS customer_label,
           CAST(COALESCE(i.subtotal, 0) AS VARCHAR) AS doc_base,
           CAST(COALESCE(i.tax_total, 0) AS VARCHAR) AS doc_tax,
           CAST(COALESCE(i.total, 0) AS VARCHAR) AS doc_amount,
           COALESCE(l.line_no, 0) AS line_no,
           CAST(l.product_id AS VARCHAR) AS product_id,
           CASE WHEN p.id IS NULL THEN l.description ELSE p.sku || ' · ' || p.name END AS product_label,
           CAST(COALESCE(p.wine_id, lot.wine_id) AS VARCHAR) AS wine_id,
           w.name AS wine_label,
           w.category AS category,
           NULL AS category_label,
           CAST(l.lot_id AS VARCHAR) AS lot_id,
           lot.code AS lot_label,
           CAST(COALESCE(l.quantity, 0) AS VARCHAR) AS quantity,
           CAST(COALESCE(f.nominal_volume_ml, 0) AS VARCHAR) AS nominal_ml,
           CAST(COALESCE(l.line_base, i.subtotal, 0) AS VARCHAR) AS line_base
    FROM billing_docs i
    LEFT JOIN billing.invoice_line l ON l.invoice_id = i.id
    LEFT JOIN party.contact c ON c.id = i.customer_id
    LEFT JOIN catalog.product p ON p.id = l.product_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    LEFT JOIN inventory.lot lot ON lot.id = l.lot_id
    LEFT JOIN catalog.wine w ON w.id = COALESCE(p.wine_id, lot.wine_id)
    UNION ALL
    SELECT 'h:' || CAST(h.id AS VARCHAR),
           CAST(h.issue_date AS VARCHAR),
           CAST(h.counterparty_contact_id AS VARCHAR),
           COALESCE(c.legal_name, h.counterparty_name),
           CAST(COALESCE(h.subtotal, 0) AS VARCHAR),
           CAST(COALESCE(h.tax_total, 0) AS VARCHAR),
           CAST(COALESCE(h.total, 0) AS VARCHAR),
           COALESCE(hl.line_seq, 0),
           CAST(hl.matched_product_id AS VARCHAR),
           CASE WHEN p.id IS NULL THEN hl.description ELSE p.sku || ' · ' || p.name END,
           CAST(p.wine_id AS VARCHAR),
           w.name,
           w.category,
           NULL,
           NULL,
           NULL,
           CAST(COALESCE(hl.units, 0) AS VARCHAR),
           CAST(COALESCE(f.nominal_volume_ml, 0) AS VARCHAR),
           CAST(COALESCE(hl.subtotal, CASE WHEN hl.line_seq IS NULL THEN h.subtotal ELSE 0 END, 0) AS VARCHAR)
    FROM holded_docs h
    LEFT JOIN legacy.holded_invoice_line hl
      ON hl.entity_id = h.entity_id
     AND hl.kind = 'sale'
     AND hl.document_number = h.number
     AND hl.document_date = h.issue_date
     AND hl.is_draft = FALSE
    LEFT JOIN party.contact c ON c.id = h.counterparty_contact_id
    LEFT JOIN catalog.product p ON p.id = hl.matched_product_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    LEFT JOIN catalog.wine w ON w.id = p.wine_id
  `);
  return rows.map((row) => readLine(row));
}
