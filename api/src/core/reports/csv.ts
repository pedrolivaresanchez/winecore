import type { ReportBody, ReportName } from './types';

const FILE_NAME: Record<ReportName, string> = {
  sales: 'ventas.csv',
  expenses: 'gastos.csv',
  stock: 'existencias.csv',
};

export function reportCsv(report: ReportName, body: ReportBody): Response {
  const dated = body.series.some((point) => point.as_of != null);
  const header = ['Clave', 'Etiqueta'];
  if (dated) header.push('Fecha');
  header.push('Importe', 'Base', 'Impuesto', 'Unidades', 'Volumen (ml)');
  if (body.compare === 'previous_year') {
    header.push(
      'Importe año anterior',
      'Base año anterior',
      'Impuesto año anterior',
      'Unidades año anterior',
      'Volumen año anterior (ml)',
    );
  }
  const lines = [header.join(';')];
  for (const point of body.series) {
    const cells = [point.key, point.label];
    if (dated) cells.push(point.as_of ?? '');
    cells.push(point.amount, point.base, point.tax, point.units, point.volume_ml);
    if (body.compare === 'previous_year') {
      cells.push(
        point.previous?.amount ?? '0.00',
        point.previous?.base ?? '0.00',
        point.previous?.tax ?? '0.00',
        point.previous?.units ?? '0',
        point.previous?.volume_ml ?? '0',
      );
    }
    lines.push(cells.map(csvCell).join(';'));
  }
  const bytes = Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${FILE_NAME[report]}"`,
    },
  });
}

function csvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function wantsCsv(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname.endsWith('.csv') || url.searchParams.get('format') === 'csv';
}
