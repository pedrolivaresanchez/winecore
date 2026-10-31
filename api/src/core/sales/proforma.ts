export type ProformaPdfInput = {
  proforma: boolean;
  language: string;
  incoterm: string | null;
  customer: string;
  number: string | null;
  lines: { description: string; quantity: string; amount: string }[];
  total: string;
};

/** PDF mínimo con el texto literal (Helvetica, ASCII) para la proforma. */
export function buildProformaPdf(input: ProformaPdfInput): Uint8Array {
  const english = input.language === 'en';
  const title = input.proforma ? 'Proforma' : (english ? 'Quote' : 'Presupuesto');
  const lines = [
    title,
    english ? 'This document is not a tax invoice.' : 'Este documento no es una factura fiscal.',
    input.number ? `${title} ${ascii(input.number)}` : '',
    input.incoterm ? `Incoterm ${ascii(input.incoterm)}` : '',
    ascii(input.customer),
    ...input.lines.map((line) => `${ascii(line.description)} ${ascii(line.quantity)} ${ascii(line.amount)}`),
    `Total ${ascii(input.total)} EUR`,
  ].filter((line) => line.length > 0);
  return pdf(lines);
}

function ascii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?');
}

function pdf(lines: string[]): Uint8Array {
  const text = lines.map(escapePdf).join(') Tj T* (');
  const stream = `BT /F1 12 Tf 50 800 Td 16 TL (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${objects[index] ?? ''}\nendobj\n`;
  }
  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function escapePdf(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
