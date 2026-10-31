/** Millimetres to PDF points (1/72 inch). */
export const MM_TO_PT = 72 / 25.4;

/** Reserved QR symbol. Orden HAC/1177/2024 arts. 20–21: between 30 and 40 mm. */
export const QR_SIZE_MM = 35;

/** Gap from the page edge to the QR block. The regulation requires at least 2 mm. */
export const QR_MARGIN_MM = 4;

export const QR_SIZE_PT = QR_SIZE_MM * MM_TO_PT;
export const QR_MARGIN_PT = QR_MARGIN_MM * MM_TO_PT;

/** Same size as the invoice title, so the legend is not smaller than the rest. */
export const QR_TEXT_SIZE = 11;

export const QR_LABEL = 'QR tributario:';

/** Official wording. English invoices keep this Spanish sentence (verifactu.md §12). */
export const QR_LEGEND = 'Factura verificable en la sede electrónica de la AEAT';

export interface QrSlot {
  /** Left of the symbol. */
  x: number;
  /** Bottom of the symbol, PDF coordinates. */
  y: number;
  size: number;
  margin: number;
  labelBaseline: number;
  legendBaseline: number;
  /** First baseline of the invoice body. Stays below the reserved legend band. */
  contentTop: number;
}

/**
 * Top of the first page. The label and legend bands stay empty until the
 * entity's Verifactu installation is active (M4).
 */
export function qrSlot(pageHeight: number): QrSlot {
  const margin = QR_MARGIN_PT;
  const size = QR_SIZE_PT;
  const labelBaseline = pageHeight - margin - QR_TEXT_SIZE;
  const qrTop = labelBaseline - 4;
  const y = qrTop - size;
  const legendBaseline = y - 4 - QR_TEXT_SIZE;
  const contentTop = legendBaseline - 16;
  return { x: margin, y, size, margin, labelBaseline, legendBaseline, contentTop };
}
