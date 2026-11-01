import { MARGIN_X, QR_SIZE_MM, QR_SIZE_PT, QR_TEXT_SIZE } from '../../pdf/holded-layout';

export { QR_SIZE_MM, QR_SIZE_PT, QR_TEXT_SIZE };

/** Millimetres to PDF points (1/72 inch). */
export const MM_TO_PT = 72 / 25.4;

/**
 * Distancia del QR al borde izquierdo de la hoja. La normativa exige al menos 2 mm; el QR sale
 * en el margen izquierdo de la maqueta, bajo el logotipo.
 */
export const QR_MARGIN_MM = MARGIN_X / MM_TO_PT;

export const QR_LABEL = 'QR tributario:';

/** Official wording. English invoices keep this Spanish sentence (verifactu.md §12). */
export const QR_LEGEND = 'Factura verificable en la sede electrónica de la AEAT';
