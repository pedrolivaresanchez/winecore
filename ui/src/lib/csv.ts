export type CsvValue = string | number | null | undefined

function cell(value: CsvValue): string {
  const text = value == null ? '' : String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Semicolons and a BOM: what a Spanish Excel opens without asking about the encoding. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return `\uFEFF${[header, ...rows].map((line) => line.map(cell).join(';')).join('\n')}`
}

export function downloadCsv(filename: string, header: string[], rows: CsvValue[][]): void {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
