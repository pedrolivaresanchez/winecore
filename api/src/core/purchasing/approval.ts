/**
 * El integrador enchufa aquí el efecto posterior (pago pendiente, asiento).
 * Se llama dentro de la escritura, antes de confirmar: si lanza, la aprobación no se guarda.
 * No escribe en la base; el gasto ya está en el snapshot.
 */
export type ApprovedSupplierInvoice = {
  id: string;
  legalEntityId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  accountingDate: string;
  currency: string;
  subtotal: string;
  taxTotal: string;
  withholdingTotal: string;
  total: string;
  categoryCode: string;
};

export interface SupplierInvoiceApprovalHook {
  onApproved(invoice: ApprovedSupplierInvoice): Promise<void>;
}

export const noopApprovalHook: SupplierInvoiceApprovalHook = {
  async onApproved() {},
};
