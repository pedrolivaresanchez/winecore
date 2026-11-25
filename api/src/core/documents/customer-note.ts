/**
 * Notas de documentos de cliente.
 *
 * `notes` es interna: se ve en la aplicación y no se imprime.
 * `customer_note` es el texto que sí sale en el PDF (un obsequio, una cortesía).
 *
 * Al migrar, lo ya guardado en `notes` se queda interno. Solo pasa a la nota
 * del cliente una línea que es, ella sola, un obsequio o una cortesía y no
 * habla de tarifa, almacén, borrador ni de un identificador interno.
 * Así «Obsequio Pack Navidad 2026 (PACK-NAV-2026)» sigue imprimiéndose y el
 * párrafo operativo de AL26-0002 no.
 */

const GIFT_LINE = /^(obsequio|regalo|cortesia)( |$)/u;
const INTERNAL_MARK = /borrador|tarifa|traspaso|condicionado|sustituye|deposito|transportista|almacen|nacex|\bdestino\b|\borigen\b|pendiente|uuid|[0-9a-f]{8}-[0-9a-f]{4}-|sin facturar|no incluye/u;
const MAX_CUSTOMER_LINE = 240;

export interface SplitNote {
  /** Texto que se queda en `notes`. */
  internal: string | null;
  /** Texto que pasa a `customer_note` y se imprime. */
  customer: string | null;
}

export function splitStoredNote(raw: string | null | undefined): SplitNote {
  if (raw == null) return { internal: null, customer: null };
  const text = raw.trim();
  if (text === '') return { internal: null, customer: null };
  // El enlace de una devolución vive en JSON dentro de notes. No se reescribe.
  if (text.startsWith('{')) return { internal: text, customer: null };

  const internal: string[] = [];
  const customer: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (isCustomerGiftLine(trimmed)) customer.push(trimmed);
    else internal.push(trimmed);
  }
  return {
    internal: internal.length === 0 ? null : internal.join('\n'),
    customer: customer.length === 0 ? null : customer.join('\n'),
  };
}

/** Una línea que puede imprimirse tal cual. El resto de la nota no la arrastra. */
export function isCustomerGiftLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CUSTOMER_LINE) return false;
  const folded = fold(trimmed);
  if (!GIFT_LINE.test(folded)) return false;
  return !INTERNAL_MARK.test(folded);
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .replaceAll('á', 'a')
    .replaceAll('é', 'e')
    .replaceAll('í', 'i')
    .replaceAll('ó', 'o')
    .replaceAll('ú', 'u');
}

/** Lote que no aporta nada al cliente. «Sin lote» no se imprime. */
export function printableLot(lot: string | null | undefined): string | null {
  const value = lot?.trim() ?? '';
  if (value === '') return null;
  const folded = fold(value);
  if (folded === 'sin lote' || folded === 'no lot' || folded === 'without lot') return null;
  return value;
}

/**
 * Estado que no debe salir como línea en un PDF ya emitido.
 * Un borrador sin número sigue diciendo «Borrador».
 */
export function printableStatus(status: string, numbered: boolean): string {
  const value = status.trim();
  if (value === '') return '';
  const folded = fold(value);
  if (numbered && (folded === 'borrador' || folded === 'draft')) return '';
  if (
    folded === 'pagado' || folded === 'pagada' || folded === 'paid'
    || folded === 'pendiente' || folded === 'pending' || folded === 'unpaid'
  ) return '';
  return value;
}
