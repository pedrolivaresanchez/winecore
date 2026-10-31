export type FileRole =
  | 'contacts'
  | 'sales_invoice'
  | 'purchase_invoice'
  | 'lines'
  | 'delivery_note'
  | 'quote'
  | 'product'
  | 'trial_balance'
  | 'pnl'
  | 'shopify_customers'
  | 'shopify_orders'
  | 'shopify_products'
  | 'shopify_gift_cards'
  | 'shopify_discounts'
  | 'shopify_transactions'
  | 'proposal'
  | 'unknown';

export function roleOf(headers: readonly string[]): FileRole {
  const header = new Set(headers);
  if (header.has('Customer ID') && header.has('Total Orders')) return 'shopify_customers';
  if (header.has('Lineitem name') && header.has('Name')) return 'shopify_orders';
  if (header.has('Variant SKU') && header.has('Handle')) return 'shopify_products';
  if (header.has('Current Balance') && header.has('Initial Balance')) return 'shopify_gift_cards';
  if (header.has('Discount Class')) return 'shopify_discounts';
  if (header.has('Gateway') && header.has('Amount')) return 'shopify_transactions';
  if (header.has('proposed_sku') && header.has('decision')) return 'proposal';
  if (header.has('Tipo de contacto') && header.has('Nombre')) return 'contacts';
  if (header.has('Pendiente') && header.has('Proveedor')) return 'purchase_invoice';
  if (header.has('Pendiente') && (header.has('Cliente') || header.has('Cobrado'))) return 'sales_invoice';
  if (header.has('Num factura') && header.has('Item')) return 'lines';
  if (header.has('Destino') && header.has('Almacén')) return 'delivery_note';
  if (header.has('Pagos a cuenta') || header.has('Total facturado')) return 'quote';
  if (header.has('Stock') && header.has('Nombre')) return 'product';
  if (header.has('Debe') && header.has('Haber') && header.has('Cuenta')) return 'trial_balance';
  if (header.has('Concepto') && header.has('Total')) return 'pnl';
  return 'unknown';
}

export function datasetForRole(role: FileRole): 'contacts' | 'catalog' | 'open_items' | 'history' | null {
  if (role === 'contacts' || role === 'shopify_customers') return 'contacts';
  if (role === 'product' || role === 'shopify_products' || role === 'lines' || role === 'shopify_orders' || role === 'proposal') {
    return 'catalog';
  }
  if (role === 'sales_invoice' || role === 'purchase_invoice') return 'open_items';
  if (role === 'delivery_note' || role === 'quote') return 'history';
  return null;
}

const HISTORY_ROLES: ReadonlySet<FileRole> = new Set(['lines', 'delivery_note', 'quote', 'product']);

/** Líneas de venta, albarán, presupuesto y compra comparten columnas: el histórico las acepta además del catálogo. */
export function acceptsDataset(role: FileRole, dataset: string): boolean {
  if (dataset === 'history') return HISTORY_ROLES.has(role);
  return datasetForRole(role) === dataset;
}

export function entityFromPath(filePath: string): string {
  const parts = filePath.split(/[/\\]/).map((part) => part.toLowerCase());
  if (parts.includes('cvpo')) return 'CVPO';
  if (parts.includes('po')) return 'PO';
  if (parts.includes('shopify')) return 'SHOPIFY';
  return 'UNKNOWN';
}
