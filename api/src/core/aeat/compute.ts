import { abs, gt, nonzero, norm, percent, same, sub, sum } from './amounts';
import { esAmount, esDate, toCsv } from './csv';
import { periodLabelOf, quarterOfDate, type ModelCode } from './period';
import type {
  BookCheck,
  BookModel,
  Box,
  CashIn,
  DraftLine,
  DraftModel,
  ExcludedDoc,
  FiscalPack,
  IssuedDoc,
  MissingSection,
  ReceivedDoc,
  ReceivedLine,
  Reconciliation,
  SourceDoc,
  TaxSlice,
} from './types';

/** Umbral del 347: operaciones con terceros por importe superior a 3.005,06 €. */
export const THRESHOLD_347 = '3005.06';

const EU = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'EL', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'SE',
]);

const ISSUED_COLUMNS = [
  'Ejercicio', 'Periodo', 'Fecha de expedición', 'Fecha de operación', 'Número', 'Tipo',
  'Facturas rectificadas', 'NIF', 'Nombre', 'Clave de régimen', 'Base', 'Tipo impositivo',
  'Cuota', 'Tipo recargo', 'Cuota recargo', 'Exención', 'Calificación', 'Total factura',
  'Retención', 'Cobro', 'CSV Verifactu',
];

const RECEIVED_COLUMNS = [
  'Ejercicio', 'Periodo', 'Fecha de expedición', 'Fecha contable', 'Número', 'Tipo',
  'Facturas rectificadas', 'NIF', 'Nombre', 'Régimen', 'Base', 'Tipo IVA', 'Cuota',
  'Recargo', 'Total factura', 'Retención',
];

export function isIntraEuSupplier(doc: ReceivedDoc): boolean {
  if (doc.supplierVatRegime === 'intra_eu') return true;
  return doc.supplierTaxIdType === 'vat_eu' && doc.supplierCountry !== 'ES' && EU.has(doc.supplierCountry);
}

export function isIntraEuSupply(tax: TaxSlice): boolean {
  return tax.exemption === 'E5' || tax.taxCode === 'INTRA_E5';
}

export function buildIssuedBook(pack: FiscalPack): BookModel {
  const rows: BookModel['rows'] = [];
  const failures: string[] = [];
  let base = '0.00';
  let quota = '0.00';
  let surcharge = '0.00';
  let withholding = '0.00';
  let total = '0.00';
  const seen = new Set<string>();
  for (const doc of pack.issued) {
    seen.add(doc.id);
    if (!issuedConsistent(doc)) failures.push(doc.number);
    const taxes = doc.taxes.length > 0 ? doc.taxes : [emptyTax()];
    const importe = issuedImporte(doc);
    taxes.forEach((tax, index) => {
      const first = index === 0;
      base = sum([base, tax.base]);
      quota = sum([quota, tax.quota]);
      surcharge = sum([surcharge, tax.surchargeQuota]);
      rows.push({
        id: `${doc.id}:${index}`,
        cells: [
          doc.issueDate.slice(0, 4),
          periodLabelOf(doc.issueDate),
          esDate(doc.issueDate),
          esDate(doc.operationDate),
          doc.number,
          doc.invoiceType,
          rectifiedText(doc),
          doc.customerTaxId,
          doc.customerName,
          tax.regimeKey,
          esAmount(tax.base),
          esAmount(tax.rate),
          esAmount(tax.quota),
          esAmount(tax.surchargeRate),
          esAmount(tax.surchargeQuota),
          tax.exemption ?? '',
          tax.qualification ?? '',
          first ? esAmount(importe) : '',
          first ? esAmount(doc.withholdingTotal) : '',
          '',
          first ? (doc.verifactuCsv ?? '') : '',
        ],
      });
    });
    withholding = sum([withholding, doc.withholdingTotal]);
    total = sum([total, importe]);
  }
  const checks: BookCheck[] = [
    failures.length === 0
      ? { name: 'libro_vs_facturas', ok: true, detail: `El libro de emitidas cuadra con las facturas (${esAmount(total)})` }
      : { name: 'libro_vs_facturas', ok: false, detail: `Estas facturas no cuadran con su desglose: ${failures.join(', ')}` },
    verifactuCheck(pack),
  ];
  return {
    book: 'issued',
    columns: ISSUED_COLUMNS,
    rows,
    checks,
    totals: { invoices: seen.size, base, quota, surcharge, withholding, total },
    missing: [],
    notes: ['Criterio de caja: no aplica. La columna de cobro queda vacía.'],
  };
}

export function buildReceivedBook(pack: FiscalPack): BookModel {
  const rows: BookModel['rows'] = [];
  const failures: string[] = [];
  let base = '0.00';
  let quota = '0.00';
  let withholding = '0.00';
  let total = '0.00';
  for (const doc of pack.received) {
    if (!receivedConsistent(doc)) failures.push(doc.number);
    const groups = groupLines(doc.lines);
    const regime = isIntraEuSupplier(doc) ? 'Intracomunitaria' : 'General';
    groups.forEach((group, index) => {
      const first = index === 0;
      rows.push({
        id: `${doc.id}:${group.rate}`,
        cells: [
          doc.accountingDate.slice(0, 4),
          periodLabelOf(doc.accountingDate),
          esDate(doc.issueDate),
          esDate(doc.accountingDate),
          doc.number,
          doc.categoryName,
          '',
          doc.supplierTaxId,
          doc.supplierName,
          regime,
          esAmount(group.base),
          esAmount(group.rate),
          esAmount(group.quota),
          esAmount('0.00'),
          first ? esAmount(doc.total) : '',
          first ? esAmount(doc.withholdingTotal) : '',
        ],
      });
      base = sum([base, group.base]);
      quota = sum([quota, group.quota]);
    });
    withholding = sum([withholding, doc.withholdingTotal]);
    total = sum([total, doc.total]);
  }
  const checks: BookCheck[] = [
    failures.length === 0
      ? { name: 'libro_vs_gastos', ok: true, detail: `El libro de recibidas cuadra con los gastos aprobados (${esAmount(total)})` }
      : { name: 'libro_vs_gastos', ok: false, detail: `Estos gastos no cuadran con sus líneas: ${failures.join(', ')}` },
  ];
  return {
    book: 'received',
    columns: RECEIVED_COLUMNS,
    rows,
    checks,
    totals: { invoices: pack.received.length, base, quota, surcharge: '0.00', withholding, total },
    missing: [{
      code: 'rectificativas_recibidas',
      label: 'Facturas de proveedor rectificadas',
      reason: 'No hay un registro de la factura del proveedor que se rectifica. La columna queda vacía; no se inventa.',
    }],
    notes: ['El recargo de las recibidas no está en la factura de gasto. La columna sale a cero.'],
  };
}

export function buildDraft(model: ModelCode, pack: FiscalPack): DraftModel {
  if (model === '303' || model === '390') return vatReturn(model, pack);
  if (model === '347') return model347(pack);
  if (model === '349') return model349(pack);
  if (model === '115') return model115(pack);
  return model130(pack);
}

function vatReturn(model: '303' | '390', pack: FiscalPack): DraftModel {
  const rated = new Map<string, { base: string; quota: string }>();
  const surcharge = new Map<string, { base: string; quota: string }>();
  let e2 = '0.00';
  let e5 = '0.00';
  let otherExempt = '0.00';
  let notSubject = '0.00';
  let ispBase = '0.00';
  let ispQuota = '0.00';
  const documents: SourceDoc[] = [];

  for (const doc of pack.issued) {
    const boxes: string[] = [];
    if (doc.invoiceType.startsWith('R')) boxes.push('rectificativa');
    for (const tax of doc.taxes) {
      const rate = norm(tax.rate);
      if (tax.exemption === 'E2') {
        e2 = sum([e2, tax.base]);
        boxes.push('exenta_e2');
      } else if (isIntraEuSupply(tax)) {
        e5 = sum([e5, tax.base]);
        boxes.push('exenta_e5');
      } else if (tax.exemption) {
        otherExempt = sum([otherExempt, tax.base]);
        boxes.push('exenta_otras');
      } else if (tax.qualification === 'N1' || tax.qualification === 'N2') {
        notSubject = sum([notSubject, tax.base]);
        boxes.push('no_sujeta');
      } else if (tax.qualification === 'S2') {
        ispBase = sum([ispBase, tax.base]);
        ispQuota = sum([ispQuota, tax.quota]);
        boxes.push('12', '13');
      } else {
        addPair(rated, rate, tax.base, tax.quota);
        boxes.push(rateCode(rate).base, rateCode(rate).quota);
      }
      if (nonzero(tax.surchargeQuota)) {
        const key = norm(tax.surchargeRate);
        addPair(surcharge, key, tax.base, tax.surchargeQuota);
        boxes.push(surchargeCode(key));
      }
    }
    documents.push(sourceIssued(doc, issuedImporte(doc), boxes));
  }

  let intraBase = '0.00';
  let intraQuota = '0.00';
  let domesticBase = '0.00';
  let domesticQuota = '0.00';
  let deductible = '0.00';
  for (const doc of pack.received) {
    const intra = isIntraEuSupplier(doc);
    const boxes = intra ? ['10', '11', 'deducible'] : ['base_soportada', 'deducible'];
    for (const line of doc.lines) {
      const share = percent(line.quota, line.deductiblePct);
      deductible = sum([deductible, share]);
      if (intra) {
        intraBase = sum([intraBase, line.base]);
        intraQuota = sum([intraQuota, line.quota]);
      } else {
        domesticBase = sum([domesticBase, line.base]);
        domesticQuota = sum([domesticQuota, line.quota]);
      }
    }
    documents.push(sourceReceived(doc, doc.total, boxes));
  }

  const boxes: Box[] = [
    ...rateBoxes(rated, '4.00', '01', '03', '4 %'),
    ...rateBoxes(rated, '10.00', '04', '06', '10 %'),
    ...rateBoxes(rated, '21.00', '07', '09', '21 %'),
    ...rateBoxes(rated, '0.00', 'base_0', 'cuota_0', '0 %'),
    ...optionalRate(rated, 'base_otras', 'cuota_otras', 'otro tipo'),
    box('10', '10', 'Base adquisiciones intracomunitarias', intraBase),
    box('11', '11', 'Cuota adquisiciones intracomunitarias', intraQuota),
    box('12', '12', 'Base inversión del sujeto pasivo', ispBase),
    box('13', '13', 'Cuota inversión del sujeto pasivo', ispQuota),
    box('exenta_e2', null, 'Exportaciones exentas (E2)', e2),
    box('exenta_e5', null, 'Entregas intracomunitarias exentas (E5)', e5),
    box('exenta_otras', null, 'Otras exentas', otherExempt),
    box('no_sujeta', null, 'No sujetas', notSubject),
    box('base_soportada', null, 'Base IVA soportado interior', domesticBase),
    box('cuota_soportada', null, 'Cuota IVA soportado interior', domesticQuota),
    ...surchargeBoxes(surcharge),
    box('deducible', null, 'IVA deducible', deductible),
  ];
  const outputQuota = sum([
    pair(rated, '4.00').quota,
    pair(rated, '10.00').quota,
    pair(rated, '21.00').quota,
    pair(rated, '0.00').quota,
    otherRatedQuota(rated),
    ispQuota,
  ]);
  const recargo = sum([...surcharge.values()].map((item) => item.quota));
  const devengada = sum([outputQuota, recargo, intraQuota]);
  const result = sub(devengada, deductible);
  boxes.push(box('resultado', null, 'Resultado (cuota devengada − IVA deducible)', result));

  const issuedBook = buildIssuedBook(pack);
  const receivedBook = buildReceivedBook(pack);
  const draftBases = sum([
    pair(rated, '4.00').base, pair(rated, '10.00').base, pair(rated, '21.00').base, pair(rated, '0.00').base,
    otherRatedBase(rated), e2, e5, otherExempt, notSubject, ispBase,
  ]);
  const reconciliation: Reconciliation[] = [
    compare('base_emitidas', 'Base de emitidas', issuedBook.totals.base, draftBases),
    compare('cuota_emitidas', 'Cuota de emitidas', issuedBook.totals.quota, outputQuota),
    compare('recargo', 'Recargo de equivalencia', issuedBook.totals.surcharge, recargo),
    compare('base_recibidas', 'Base de recibidas', receivedBook.totals.base, sum([intraBase, domesticBase])),
    compare('cuota_recibidas', 'Cuota de recibidas', receivedBook.totals.quota, sum([intraQuota, domesticQuota])),
    compare('resultado', 'Resultado frente a las casillas', result, amountOf(boxes, 'resultado')),
    ...failedChecks(issuedBook, receivedBook),
  ];
  return {
    model,
    period: pack.period.token,
    applies: true,
    boxes,
    lines: [],
    documents,
    excluded: [],
    reconciliation,
    missing: receivedBook.missing,
    notes: model === '390'
      ? ['El 390 suma el ejercicio con las mismas casillas que el 303.']
      : ['Las rectificativas entran por su desglose, con signo, en el trimestre de expedición.'],
    result,
  };
}

function model347(pack: FiscalPack): DraftModel {
  const parties = new Map<string, Party>();
  const documents: SourceDoc[] = [];
  const excluded: ExcludedDoc[] = [];
  for (const doc of pack.issued) {
    if (withholdingIssued(doc)) {
      excluded.push({ id: doc.id, kind: 'issued', number: doc.number, reason: 'Lleva retención' });
      continue;
    }
    if (!doc.includeIn347) {
      excluded.push({ id: doc.id, kind: 'issued', number: doc.number, reason: 'El contacto está fuera del 347' });
      continue;
    }
    if (!doc.customerId) continue;
    let amount = '0.00';
    let intraOnly = doc.taxes.length > 0;
    for (const tax of doc.taxes) {
      if (isIntraEuSupply(tax)) {
        excluded.push({ id: doc.id, kind: 'issued', number: doc.number, reason: 'Ya se declara en el 349' });
        continue;
      }
      intraOnly = false;
      amount = sum([amount, tax.base, tax.quota, tax.surchargeQuota]);
    }
    if (intraOnly || same(amount, '0.00')) continue;
    const party = partyOf(parties, `B:${doc.customerId}`, 'B', doc.customerName, doc.customerTaxId);
    addQuarter(party, quarterOfDate(doc.issueDate), amount, doc.id);
  }
  for (const doc of pack.received) {
    if (withholdingReceived(doc)) {
      excluded.push({ id: doc.id, kind: 'received', number: doc.number, reason: 'Lleva retención' });
      continue;
    }
    if (isIntraEuSupplier(doc)) {
      excluded.push({ id: doc.id, kind: 'received', number: doc.number, reason: 'Ya se declara en el 349' });
      continue;
    }
    if (!doc.includeIn347) {
      excluded.push({ id: doc.id, kind: 'received', number: doc.number, reason: 'El contacto está fuera del 347' });
      continue;
    }
    const party = partyOf(parties, `A:${doc.supplierId}`, 'A', doc.supplierName, doc.supplierTaxId);
    addQuarter(party, quarterOfDate(doc.accountingDate), doc.total, doc.id);
  }
  const lines: DraftLine[] = [];
  let declared = '0.00';
  for (const party of parties.values()) {
    const annual = sum(party.q);
    if (!gt(abs(annual), THRESHOLD_347)) continue;
    declared = sum([declared, annual]);
    lines.push(lineFrom(party, annual, false, null));
    for (const id of party.docs) {
      const doc = findDoc(pack, id);
      if (doc) documents.push(doc);
    }
  }
  const cashLines: DraftLine[] = [];
  const cashParties = new Map<string, Party>();
  let cashTotal = '0.00';
  for (const payment of pack.cash) {
    if (!payment.includeIn347) {
      excluded.push({ id: payment.id, kind: 'payment', number: payment.id, reason: 'El contacto está fuera del 347' });
      continue;
    }
    const key = payment.counterpartyId ?? payment.id;
    const party = partyOf(cashParties, key, 'C', payment.name, payment.taxId);
    addQuarter(party, quarterOfDate(payment.valueDate), payment.amount, payment.id);
    cashTotal = sum([cashTotal, payment.amount]);
    documents.push({
      id: payment.id,
      kind: 'payment',
      number: payment.id.slice(0, 8),
      date: payment.valueDate,
      counterparty: payment.name,
      tax_id: payment.taxId,
      amount: payment.amount,
      boxes: ['efectivo'],
    });
  }
  for (const party of cashParties.values()) {
    cashLines.push(lineFrom(party, sum(party.q), false, null));
  }
  lines.sort(sortLines);
  cashLines.sort(sortLines);
  const all = [...lines, ...cashLines];
  const reconciliation: Reconciliation[] = [
    compare('operaciones', 'Suma de las operaciones declaradas', declared, sum(lines.map((item) => item.annual))),
    compare('efectivo', 'Cobros en efectivo', cashTotal, sum(cashLines.map((item) => item.annual))),
  ];
  return {
    model: '347',
    period: pack.period.token,
    applies: true,
    boxes: [
      box('operaciones', null, 'Operaciones sobre 3.005,06 €', declared),
      box('efectivo', null, 'Cobros en efectivo', cashTotal),
    ],
    lines: all,
    documents,
    excluded: uniqueExcluded(excluded),
    reconciliation,
    missing: [],
    notes: [
      'Fuera: lo ya declarado en el 349 y lo que lleva retención. El umbral es 3.005,06 € por tercero y año.',
      'Los cobros en efectivo salen de los cobros registrados en metálico. La spec no fija el umbral de 6.000 €: se listan todos.',
    ],
    result: declared,
  };
}

function model349(pack: FiscalPack): DraftModel {
  const groups = new Map<string, Party & { rectification: boolean }>();
  const documents: SourceDoc[] = [];
  for (const doc of pack.issued) {
    let base = '0.00';
    for (const tax of doc.taxes) {
      if (!isIntraEuSupply(tax)) continue;
      base = sum([base, tax.base]);
    }
    if (same(base, '0.00')) continue;
    const vat = vatNumber(doc.customerCountry, doc.customerTaxId);
    const quarter = periodLabelOf(doc.issueDate);
    const party = partyOf(groups, `E:${vat}:${quarter}`, 'E', doc.customerName, vat);
    addQuarter(party, quarterOfDate(doc.issueDate), base, doc.id);
    if (doc.invoiceType.startsWith('R')) party.rectification = true;
    documents.push(sourceIssued(doc, base, ['E']));
  }
  for (const doc of pack.received) {
    if (!isIntraEuSupplier(doc)) continue;
    const base = sum(doc.lines.map((line) => line.base));
    const vat = vatNumber(doc.supplierCountry, doc.supplierTaxId);
    const quarter = periodLabelOf(doc.accountingDate);
    const party = partyOf(groups, `A:${vat}:${quarter}`, 'A', doc.supplierName, vat);
    addQuarter(party, quarterOfDate(doc.accountingDate), base, doc.id);
    documents.push(sourceReceived(doc, base, ['A']));
  }
  const lines = [...groups.values()]
    .map((party) => lineFrom(party, sum(party.q), party.rectification, null))
    .sort(sortLines);
  const supplies = sum(lines.filter((line) => line.clave === 'E').map((line) => line.annual));
  const acquisitions = sum(lines.filter((line) => line.clave === 'A').map((line) => line.annual));
  const supplyBase = sum(pack.issued.flatMap((doc) => doc.taxes.filter(isIntraEuSupply).map((tax) => tax.base)));
  const acquisitionBase = sum(pack.received.filter(isIntraEuSupplier).flatMap((doc) => doc.lines.map((line) => line.base)));
  return {
    model: '349',
    period: pack.period.token,
    applies: true,
    boxes: [
      box('E', 'E', 'Entregas intracomunitarias', supplies),
      box('A', 'A', 'Adquisiciones intracomunitarias', acquisitions),
    ],
    lines,
    documents,
    excluded: [],
    reconciliation: [
      compare('entregas', 'Entregas del libro', supplyBase, supplies),
      compare('adquisiciones', 'Adquisiciones del libro', acquisitionBase, acquisitions),
    ],
    missing: [],
    notes: ['Clave E: ventas INTRA_E5. Clave A: compras a un proveedor marcado como intracomunitario. La base es la de la factura, incluidas las rectificativas.'],
    result: sum([supplies, acquisitions]),
  };
}

function model115(pack: FiscalPack): DraftModel {
  const groups = new Map<string, Party & { rate: string; quota: string }>();
  const documents: SourceDoc[] = [];
  const excluded: ExcludedDoc[] = [];
  let stored = '0.00';
  for (const doc of pack.issued) {
    if (doc.taxes.some((tax) => tax.taxCode === 'IVA21_ALQ' || nonzero(tax.withholding))) {
      excluded.push({
        id: doc.id,
        kind: 'issued',
        number: doc.number,
        reason: 'La retención de la factura de alquiler emitida la declara el inquilino',
      });
    }
  }
  for (const doc of pack.received) {
    if (doc.categoryCode !== 'rent' || !withholdingReceived(doc)) continue;
    stored = sum([stored, doc.withholdingTotal]);
    const rated = doc.lines.filter((line) => nonzero(line.withholdingRate));
    if (rated.length === 0) {
      const party = rentParty(groups, `${doc.supplierId}:`, doc.supplierName, doc.supplierTaxId, '');
      addQuarter(party, quarterOfDate(doc.accountingDate), doc.subtotal, doc.id);
      documents.push(sourceReceived(doc, doc.withholdingTotal, ['115']));
      continue;
    }
    for (const line of rated) {
      const rate = norm(line.withholdingRate);
      const party = rentParty(groups, `${doc.supplierId}:${rate}`, doc.supplierName, doc.supplierTaxId, rate);
      addQuarter(party, quarterOfDate(doc.accountingDate), line.base, doc.id);
      party.quota = sum([party.quota, percent(line.base, rate)]);
    }
    documents.push(sourceReceived(doc, doc.withholdingTotal, ['115']));
  }
  const lines = [...groups.values()].map((party) => {
    const row = lineFrom(party, party.quota, false, party.rate || null);
    row.q1 = party.q[0] ?? '0.00';
    row.q2 = party.q[1] ?? '0.00';
    row.q3 = party.q[2] ?? '0.00';
    row.q4 = party.q[3] ?? '0.00';
    return row;
  }).sort(sortLines);
  const base = sum(lines.map((line) => sum([line.q1, line.q2, line.q3, line.q4])));
  const quota = sum(lines.map((line) => line.annual));
  const missing: MissingSection[] = lines.some((line) => !line.rate)
    ? [{
      code: 'tipo_retencion',
      label: 'Tipo de retención',
      reason: 'Hay una factura de arrendamiento con retención y las líneas no indican el tipo. No se calcula una cuota.',
    }]
    : [];
  return {
    model: '115',
    period: pack.period.token,
    applies: true,
    boxes: [
      box('base', null, 'Base de arrendamientos', base),
      box('cuota', null, 'Retención', quota),
    ],
    lines,
    documents,
    excluded,
    reconciliation: [
      compare('retencion', 'Retención de las facturas', stored, quota),
    ],
    missing,
    notes: ['Solo gastos de arrendamiento aprobados y con retención. El alquiler que emiten P.O y CVPO no entra aquí.'],
    result: quota,
  };
}

function model130(pack: FiscalPack): DraftModel {
  if (pack.entity.incomeTax !== 'IRPF' || pack.entity.personType !== 'natural') {
    return {
      model: '130',
      period: pack.period.token,
      applies: false,
      boxes: [],
      lines: [],
      documents: [],
      excluded: [],
      reconciliation: [],
      missing: [{
        code: 'no_aplica',
        label: 'Modelo 130',
        reason: 'El 130 es el pago fraccionado del IRPF. Esta entidad tributa por el Impuesto sobre Sociedades.',
      }],
      notes: [],
      result: null,
    };
  }
  const incomeQ = ['0.00', '0.00', '0.00', '0.00'];
  const expenseQ = ['0.00', '0.00', '0.00', '0.00'];
  let withheld = '0.00';
  const documents: SourceDoc[] = [];
  const upto = pack.period.quarter ?? 4;
  for (const doc of pack.issued) {
    const quarter = quarterOfDate(doc.issueDate);
    if (quarter > upto) continue;
    const base = sum(doc.taxes.map((tax) => tax.base));
    incomeQ[quarter - 1] = sum([incomeQ[quarter - 1] ?? '0.00', base]);
    withheld = sum([withheld, doc.withholdingTotal]);
    documents.push(sourceIssued(doc, base, ['ingresos']));
  }
  for (const doc of pack.received) {
    const quarter = quarterOfDate(doc.accountingDate);
    if (quarter > upto) continue;
    const base = sum(doc.lines.map((line) => line.base));
    expenseQ[quarter - 1] = sum([expenseQ[quarter - 1] ?? '0.00', base]);
    documents.push(sourceReceived(doc, base, ['gastos']));
  }
  const income = sum(incomeQ.slice(0, upto));
  const expenses = sum(expenseQ.slice(0, upto));
  const boxes: Box[] = [
    box('ingresos', null, 'Ingresos del ejercicio hasta el trimestre', income),
    box('gastos', null, 'Gastos del ejercicio hasta el trimestre', expenses),
    box('retenciones', null, 'Retenciones soportadas en facturas emitidas', withheld),
  ];
  for (let quarter = 1; quarter <= upto; quarter += 1) {
    boxes.push(box(`ingresos_${quarter}t`, null, `Ingresos ${quarter}T`, incomeQ[quarter - 1] ?? '0.00'));
    boxes.push(box(`gastos_${quarter}t`, null, `Gastos ${quarter}T`, expenseQ[quarter - 1] ?? '0.00'));
  }
  const issuedBook = buildIssuedBook({ ...pack, issued: pack.issued.filter((doc) => quarterOfDate(doc.issueDate) <= upto) });
  const receivedBook = buildReceivedBook({ ...pack, received: pack.received.filter((doc) => quarterOfDate(doc.accountingDate) <= upto) });
  return {
    model: '130',
    period: pack.period.token,
    applies: true,
    boxes,
    lines: [],
    documents,
    excluded: [],
    reconciliation: [
      compare('ingresos', 'Ingresos contra el libro de emitidas', issuedBook.totals.base, income),
      compare('gastos', 'Gastos contra el libro de recibidas', receivedBook.totals.base, expenses),
      compare('retenciones', 'Retenciones del libro de emitidas', issuedBook.totals.withholding, withheld),
      ...failedChecks(issuedBook, receivedBook),
    ],
    missing: [
      {
        code: 'cuota',
        label: 'Cuota del pago fraccionado',
        reason: 'Falta confirmar si la estimación directa de P.O es normal o simplificada. Sin eso no se calcula el porcentaje ni el 5 % de gastos de difícil justificación.',
      },
      {
        code: 'pagos_anteriores',
        label: 'Pagos fraccionados ya ingresados',
        reason: 'El importe ingresado en los trimestres anteriores lo tiene el asesor. WineCore no lo guarda.',
      },
    ],
    notes: ['Ingresos y gastos son las bases, sin IVA, desde el 1 de enero hasta el fin del trimestre.'],
    result: null,
  };
}

interface Party {
  clave: string;
  name: string;
  taxId: string;
  q: [string, string, string, string];
  docs: string[];
  rectification: boolean;
}

function rentParty(
  map: Map<string, Party & { rate: string; quota: string }>,
  key: string,
  name: string,
  taxId: string,
  rate: string,
): Party & { rate: string; quota: string } {
  const found = map.get(key);
  if (found) return found;
  const created = {
    clave: '115',
    name,
    taxId,
    q: ['0.00', '0.00', '0.00', '0.00'] as [string, string, string, string],
    docs: [] as string[],
    rectification: false,
    rate,
    quota: '0.00',
  };
  map.set(key, created);
  return created;
}

function partyOf<T extends Party>(map: Map<string, T>, key: string, clave: string, name: string, taxId: string): T {
  const found = map.get(key);
  if (found) return found;
  const created = {
    clave,
    name,
    taxId,
    q: ['0.00', '0.00', '0.00', '0.00'] as [string, string, string, string],
    docs: [] as string[],
    rectification: false,
  } as unknown as T;
  map.set(key, created);
  return created;
}

function addQuarter(party: Party, quarter: 1 | 2 | 3 | 4, amount: string, docId: string): void {
  const index = quarter - 1;
  party.q[index] = sum([party.q[index] ?? '0.00', amount]);
  if (!party.docs.includes(docId)) party.docs.push(docId);
}

function lineFrom(party: Party, annual: string, rectification: boolean, rate: string | null): DraftLine {
  return {
    clave: party.clave,
    tax_id: party.taxId,
    name: party.name,
    period: '',
    q1: party.q[0] ?? '0.00',
    q2: party.q[1] ?? '0.00',
    q3: party.q[2] ?? '0.00',
    q4: party.q[3] ?? '0.00',
    annual,
    rate,
    rectification: rectification || party.rectification,
    document_ids: party.docs,
  };
}

function sortLines(left: DraftLine, right: DraftLine): number {
  return left.clave.localeCompare(right.clave) || left.tax_id.localeCompare(right.tax_id) || left.name.localeCompare(right.name);
}

function findDoc(pack: FiscalPack, id: string): SourceDoc | null {
  const issued = pack.issued.find((doc) => doc.id === id);
  if (issued) return sourceIssued(issued, issuedOperation(issued), ['347']);
  const received = pack.received.find((doc) => doc.id === id);
  if (received) return sourceReceived(received, received.total, ['347']);
  return null;
}

function issuedOperation(doc: IssuedDoc): string {
  let amount = '0.00';
  for (const tax of doc.taxes) {
    if (isIntraEuSupply(tax)) continue;
    amount = sum([amount, tax.base, tax.quota, tax.surchargeQuota]);
  }
  return amount;
}

function uniqueExcluded(items: ExcludedDoc[]): ExcludedDoc[] {
  const seen = new Set<string>();
  const out: ExcludedDoc[] = [];
  for (const item of items) {
    const key = `${item.id}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function vatNumber(country: string, taxId: string): string {
  const id = taxId.toUpperCase();
  const prefix = country.toUpperCase();
  if (!prefix || id.startsWith(prefix)) return id;
  return `${prefix}${id}`;
}

function withholdingIssued(doc: IssuedDoc): boolean {
  return nonzero(doc.withholdingTotal) || doc.taxes.some((tax) => nonzero(tax.withholding));
}

function withholdingReceived(doc: ReceivedDoc): boolean {
  return nonzero(doc.withholdingTotal) || doc.lines.some((line) => nonzero(line.withholdingRate));
}

function sourceIssued(doc: IssuedDoc, amount: string, boxes: string[]): SourceDoc {
  return {
    id: doc.id,
    kind: 'issued',
    number: doc.number,
    date: doc.issueDate,
    counterparty: doc.customerName,
    tax_id: doc.customerTaxId,
    amount,
    boxes: [...new Set(boxes)],
  };
}

function sourceReceived(doc: ReceivedDoc, amount: string, boxes: string[]): SourceDoc {
  return {
    id: doc.id,
    kind: 'received',
    number: doc.number,
    date: doc.accountingDate,
    counterparty: doc.supplierName,
    tax_id: doc.supplierTaxId,
    amount,
    boxes: [...new Set(boxes)],
  };
}

function issuedImporte(doc: IssuedDoc): string {
  return sum(doc.taxes.flatMap((tax) => [tax.base, tax.quota, tax.surchargeQuota]));
}

function issuedConsistent(doc: IssuedDoc): boolean {
  if (doc.taxes.length === 0) return false;
  return same(sum(doc.taxes.map((tax) => tax.base)), doc.subtotal)
    && same(sum(doc.taxes.map((tax) => tax.quota)), doc.taxTotal)
    && same(sum(doc.taxes.map((tax) => tax.surchargeQuota)), doc.surchargeTotal);
}

function receivedConsistent(doc: ReceivedDoc): boolean {
  if (doc.lines.length === 0) return false;
  const base = sum(doc.lines.map((line) => line.base));
  const quota = sum(doc.lines.map((line) => line.quota));
  const withholding = sum(doc.lines.map((line) => percent(line.base, line.withholdingRate)));
  const total = sub(sum([base, quota]), withholding);
  return same(base, doc.subtotal)
    && same(quota, doc.taxTotal)
    && same(withholding, doc.withholdingTotal)
    && same(total, doc.total);
}

function groupLines(lines: readonly ReceivedLine[]): { rate: string; base: string; quota: string }[] {
  const map = new Map<string, { base: string; quota: string }>();
  for (const line of lines) {
    const rate = norm(line.rate);
    const current = map.get(rate) ?? { base: '0.00', quota: '0.00' };
    map.set(rate, { base: sum([current.base, line.base]), quota: sum([current.quota, line.quota]) });
  }
  return [...map.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([rate, amounts]) => ({ rate, base: amounts.base, quota: amounts.quota }));
}

function emptyTax(): TaxSlice {
  return {
    taxCode: '',
    regimeKey: '',
    rate: '0.00',
    base: '0.00',
    quota: '0.00',
    surchargeRate: '0.00',
    surchargeQuota: '0.00',
    exemption: null,
    qualification: null,
    withholding: '0.00',
  };
}

function rectifiedText(doc: IssuedDoc): string {
  return doc.rectified.map((item) => `${item.number} (${esDate(item.issueDate)})`).join(' | ');
}

function verifactuCheck(pack: FiscalPack): BookCheck {
  if (!pack.verifactuEnabled) {
    return { name: 'verifactu', ok: true, detail: 'Verifactu está apagado: no hay registros que cuadrar' };
  }
  const accepted = pack.issued.filter((doc) => doc.verifactuStatus === 'accepted' || doc.verifactuStatus === 'accepted_with_errors');
  const ok = accepted.length === pack.issued.length;
  return {
    name: 'verifactu',
    ok,
    detail: ok
      ? 'Cada factura del libro tiene registro Verifactu aceptado'
      : `Faltan registros Verifactu aceptados (${accepted.length} de ${pack.issued.length})`,
  };
}

function addPair(map: Map<string, { base: string; quota: string }>, key: string, base: string, quota: string): void {
  const current = map.get(key) ?? { base: '0.00', quota: '0.00' };
  map.set(key, { base: sum([current.base, base]), quota: sum([current.quota, quota]) });
}

function pair(map: Map<string, { base: string; quota: string }>, key: string): { base: string; quota: string } {
  return map.get(key) ?? { base: '0.00', quota: '0.00' };
}

function rateCode(rate: string): { base: string; quota: string } {
  if (rate === '4.00') return { base: '01', quota: '03' };
  if (rate === '10.00') return { base: '04', quota: '06' };
  if (rate === '21.00') return { base: '07', quota: '09' };
  if (rate === '0.00') return { base: 'base_0', quota: 'cuota_0' };
  return { base: 'base_otras', quota: 'cuota_otras' };
}

function rateBoxes(
  map: Map<string, { base: string; quota: string }>,
  rate: string,
  baseCode: string,
  quotaCode: string,
  label: string,
): Box[] {
  const item = pair(map, rate);
  const casillaBase = /^\d{2}$/.test(baseCode) ? baseCode : null;
  const casillaQuota = /^\d{2}$/.test(quotaCode) ? quotaCode : null;
  return [
    box(baseCode, casillaBase, `Base ${label}`, item.base),
    box(quotaCode, casillaQuota, `Cuota ${label}`, item.quota),
  ];
}

function optionalRate(
  map: Map<string, { base: string; quota: string }>,
  baseCode: string,
  quotaCode: string,
  label: string,
): Box[] {
  let base = '0.00';
  let quota = '0.00';
  for (const [rate, item] of map) {
    if (rate === '4.00' || rate === '10.00' || rate === '21.00' || rate === '0.00') continue;
    base = sum([base, item.base]);
    quota = sum([quota, item.quota]);
  }
  if (same(base, '0.00') && same(quota, '0.00')) return [];
  return [
    box(baseCode, null, `Base ${label}`, base),
    box(quotaCode, null, `Cuota ${label}`, quota),
  ];
}

function otherRatedBase(map: Map<string, { base: string; quota: string }>): string {
  return optionalRate(map, 'base_otras', 'cuota_otras', '')[0]?.amount ?? '0.00';
}

function otherRatedQuota(map: Map<string, { base: string; quota: string }>): string {
  return optionalRate(map, 'base_otras', 'cuota_otras', '')[1]?.amount ?? '0.00';
}

function surchargeCode(rate: string): string {
  if (rate === '5.20') return 're_52';
  if (rate === '1.40') return 're_14';
  if (rate === '0.50') return 're_05';
  return 're_otras';
}

function surchargeBoxes(map: Map<string, { base: string; quota: string }>): Box[] {
  const rates: [string, string][] = [['5.20', '5,2 %'], ['1.40', '1,4 %'], ['0.50', '0,5 %']];
  const boxes: Box[] = [];
  for (const [rate, label] of rates) {
    const item = pair(map, rate);
    boxes.push(box(`${surchargeCode(rate)}_base`, null, `Base recargo ${label}`, item.base));
    boxes.push(box(surchargeCode(rate), null, `Cuota recargo ${label}`, item.quota));
  }
  const extra = [...map.entries()].filter(([rate]) => rate !== '5.20' && rate !== '1.40' && rate !== '0.50');
  if (extra.length > 0) {
    boxes.push(box('re_otras', null, 'Cuota recargo otros tipos', sum(extra.map(([, item]) => item.quota))));
  }
  return boxes;
}

function box(code: string, casilla: string | null, label: string, amount: string): Box {
  return { code, casilla, label, amount: norm(amount) };
}

function amountOf(boxes: readonly Box[], code: string): string {
  return boxes.find((item) => item.code === code)?.amount ?? '0.00';
}

function compare(name: string, label: string, book: string, draft: string): Reconciliation {
  const left = norm(book);
  const right = norm(draft);
  return { name, label, book: left, draft: right, ok: same(left, right) };
}

function failedChecks(issued: BookModel, received: BookModel): Reconciliation[] {
  return [...issued.checks, ...received.checks].filter((check) => !check.ok).map((check) => ({
    name: check.name,
    label: check.detail,
    book: '0.00',
    draft: '0.00',
    ok: false,
  }));
}

export function bookCsv(model: BookModel): string {
  return toCsv(model.columns, model.rows.map((row) => row.cells));
}
