import type { RoleCode } from '../auth/permissions';

export interface EventSpec {
  title: string;
  body: string;
  roles: readonly RoleCode[];
}

/**
 * Catálogo de `02-modelo-dominio.md` §5.2 más los dos eventos de contacto,
 * primer productor (alta y archivo). El payload solo lleva ids, importes y enlaces.
 */
export const EVENT_CATALOGUE: Readonly<Record<string, EventSpec>> = {
  'billing.invoice.issued': {
    title: 'Factura emitida',
    body: 'Se ha emitido una factura.',
    roles: ['owner', 'admin', 'approver'],
  },
  'billing.verifactu.rejected': {
    title: 'Verifactu rechazado',
    body: 'La AEAT ha rechazado un registro.',
    roles: ['owner', 'admin', 'approver'],
  },
  'billing.verifactu.send_failed': {
    title: 'Verifactu sin envío',
    body: 'No se ha podido enviar un registro a la AEAT.',
    roles: ['owner', 'admin', 'approver'],
  },
  'billing.invoice.overdue': {
    title: 'Factura vencida',
    body: 'Hay una factura vencida.',
    roles: ['owner', 'admin', 'approver'],
  },
  'sales.order.received': {
    title: 'Pedido recibido',
    body: 'Ha entrado un pedido.',
    roles: ['owner', 'admin', 'approver'],
  },
  'sales.delivery_note.issued': {
    title: 'Albarán emitido',
    body: 'Se ha emitido un albarán.',
    roles: ['owner', 'admin', 'approver'],
  },
  'inventory.reconciliation.differences': {
    title: 'Cuadre con diferencias',
    body: 'El cuadre de inventario tiene diferencias.',
    roles: ['owner', 'admin', 'cellar'],
  },
  'regulatory.submission.pending_approval': {
    title: 'Envío por aprobar',
    body: 'Hay un envío listo para aprobar.',
    roles: ['owner', 'approver'],
  },
  'regulatory.submission.accepted': {
    title: 'Envío aceptado',
    body: 'Un envío regulatorio ha sido aceptado.',
    roles: ['owner', 'admin', 'approver'],
  },
  'regulatory.submission.rejected': {
    title: 'Envío rechazado',
    body: 'Un envío regulatorio ha sido rechazado.',
    roles: ['owner', 'admin', 'approver'],
  },
  'regulatory.submission.needs_human': {
    title: 'Envío requiere persona',
    body: 'Un envío regulatorio necesita intervención.',
    roles: ['owner', 'admin', 'approver'],
  },
  'regulatory.obligation.due_soon': {
    title: 'Obligación próxima',
    body: 'Hay una obligación regulatoria próxima.',
    roles: ['owner', 'admin', 'approver', 'advisor'],
  },
  'regulatory.obligation.overdue': {
    title: 'Obligación vencida',
    body: 'Hay una obligación regulatoria vencida.',
    roles: ['owner', 'admin', 'approver', 'advisor'],
  },
  'ops.approval.requested': {
    title: 'Aprobación pendiente',
    body: 'Hay una aprobación pendiente.',
    roles: ['owner', 'approver'],
  },
  'ops.approval.decided': {
    title: 'Aprobación decidida',
    body: 'Se ha decidido una aprobación.',
    roles: ['owner', 'admin', 'approver'],
  },
  'purchasing.supplier_invoice.captured': {
    title: 'Gasto capturado',
    body: 'Se ha capturado un gasto.',
    roles: ['owner', 'admin', 'approver'],
  },
  'cellar.fermentation.alert': {
    title: 'Alerta de fermentación',
    body: 'Una fermentación requiere atención.',
    roles: ['owner', 'cellar'],
  },
  'ops.audit.chain_broken': {
    title: 'Cadena de auditoría rota',
    body: 'La verificación de la auditoría ha fallado.',
    roles: ['owner'],
  },
  'party.contact.created': {
    title: 'Contacto creado',
    body: 'Se ha creado un contacto.',
    roles: ['owner', 'admin', 'approver'],
  },
  'party.contact.archived': {
    title: 'Contacto archivado',
    body: 'Se ha archivado un contacto.',
    roles: ['owner', 'admin', 'approver'],
  },
};

export function eventSpec(type: string): EventSpec | undefined {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOGUE, type) ? EVENT_CATALOGUE[type] : undefined;
}
