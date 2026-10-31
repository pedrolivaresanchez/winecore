import { sessionOf } from '../auth/guard';
import { reportCsv, wantsCsv } from '../core/reports/csv';
import { expensesReport } from '../core/reports/expenses';
import { parseReportQuery } from '../core/reports/params';
import { salesReport } from '../core/reports/sales';
import { stockReport } from '../core/reports/stock';
import type { ReportName } from '../core/reports/types';
import type { Writer } from '../core/db/writer';

export async function getReport(writer: Writer, request: Request, report: ReportName) {
  const scope = parseReportQuery(new URL(request.url), sessionOf(request));
  const body = report === 'sales'
    ? await salesReport(writer, scope)
    : report === 'expenses'
      ? await expensesReport(writer, scope)
      : await stockReport(writer, scope);
  if (wantsCsv(request)) return reportCsv(report, body);
  return body;
}
