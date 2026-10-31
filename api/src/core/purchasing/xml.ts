import { domainError } from '../errors';
import { buildExtraction, type Extraction, type RawLine } from './extraction';

type XmlNode = {
  name: string;
  children: XmlNode[];
  text: string;
};

const MAX_XML_CHARS = 2_000_000;
const MAX_NODES = 10_000;
const MAX_DEPTH = 40;

function invalid(message: string): never {
  throw domainError('WC_VALIDATION', { file: message });
}

function localName(raw: string): string {
  const index = raw.lastIndexOf(':');
  return index === -1 ? raw : raw.slice(index + 1);
}

function decode(value: string): string {
  const decoded = value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all, token: string) => {
    if (token === 'amp') return '&';
    if (token === 'lt') return '<';
    if (token === 'gt') return '>';
    if (token === 'quot') return '"';
    if (token === 'apos') return "'";
    const code = token.startsWith('#x') ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
    if (!Number.isInteger(code) || code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d || code > 0x10ffff) {
      return all;
    }
    return String.fromCodePoint(code);
  });
  if (/&(?:#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/u.test(decoded)) {
    invalid('El XML no puede declarar entidades');
  }
  return decoded;
}

class Parser {
  private index = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): XmlNode {
    this.skipProlog();
    const root = this.element(0);
    return root;
  }

  private skipProlog(): void {
    for (;;) {
      this.skipSpace();
      if (this.source.startsWith('<?', this.index)) {
        this.skipUntil('?>');
        continue;
      }
      if (this.source.startsWith('<!--', this.index)) {
        this.skipComment();
        continue;
      }
      return;
    }
  }

  private element(depth: number): XmlNode {
    if (depth > MAX_DEPTH || ++this.nodes > MAX_NODES) invalid('El XML de la factura es demasiado grande');
    this.expect('<');
    if (this.source[this.index] === '/' || this.source[this.index] === '!') invalid('El XML de la factura no se puede leer');
    const name = localName(this.readName());
    this.attributes();
    this.skipSpace();
    if (this.source.startsWith('/>', this.index)) {
      this.index += 2;
      return { name, children: [], text: '' };
    }
    this.expect('>');
    const children: XmlNode[] = [];
    let text = '';
    while (this.index < this.source.length) {
      if (this.source.startsWith('</', this.index)) {
        this.index += 2;
        const end = localName(this.readName());
        if (end !== name) invalid('El XML de la factura no se puede leer');
        this.skipSpace();
        this.expect('>');
        return { name, children, text: decode(text).trim() };
      }
      if (this.source.startsWith('<!--', this.index)) {
        this.skipComment();
        continue;
      }
      if (this.source.startsWith('<?', this.index)) {
        this.skipUntil('?>');
        continue;
      }
      if (this.source.startsWith('<![CDATA[', this.index)) {
        const start = this.index + 9;
        const end = this.source.indexOf(']]>', start);
        if (end < 0) invalid('El XML de la factura no se puede leer');
        text += this.source.slice(start, end);
        this.index = end + 3;
        continue;
      }
      if (this.source[this.index] === '<') {
        children.push(this.element(depth + 1));
        continue;
      }
      const next = this.source.indexOf('<', this.index);
      const end = next === -1 ? this.source.length : next;
      text += this.source.slice(this.index, end);
      this.index = end;
    }
    invalid('El XML de la factura no se puede leer');
  }

  private attributes(): void {
    while (this.index < this.source.length) {
      this.skipSpace();
      const current = this.source[this.index];
      if (current === '>' || current === '/' || current === undefined) return;
      this.readName();
      this.skipSpace();
      this.expect('=');
      this.skipSpace();
      const quote = this.source[this.index];
      if (quote !== '"' && quote !== "'") invalid('El XML de la factura no se puede leer');
      this.index += 1;
      const end = this.source.indexOf(quote, this.index);
      if (end < 0) invalid('El XML de la factura no se puede leer');
      decode(this.source.slice(this.index, end));
      this.index = end + 1;
    }
  }

  private readName(): string {
    const match = /^[A-Za-z_:][\w:.-]*/u.exec(this.source.slice(this.index));
    const name = match?.[0];
    if (!name) invalid('El XML de la factura no se puede leer');
    this.index += name.length;
    return name;
  }

  private skipSpace(): void {
    while (this.index < this.source.length && /\s/u.test(this.source[this.index] ?? '')) this.index += 1;
  }

  private skipComment(): void {
    const end = this.source.indexOf('-->', this.index + 4);
    if (end < 0) invalid('El XML de la factura no se puede leer');
    this.index = end + 3;
  }

  private skipUntil(token: string): void {
    const end = this.source.indexOf(token, this.index);
    if (end < 0) invalid('El XML de la factura no se puede leer');
    this.index = end + token.length;
  }

  private expect(token: string): void {
    if (!this.source.startsWith(token, this.index)) invalid('El XML de la factura no se puede leer');
    this.index += token.length;
  }
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((item) => item.name === name);
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((item) => item.name === name) ?? [];
}

function text(node: XmlNode | undefined): string {
  return node?.text ?? '';
}

function amountNode(node: XmlNode | undefined): string {
  if (!node) return '';
  return text(child(node, 'TotalAmount')) || text(node);
}

function partyName(party: XmlNode | undefined): string | null {
  const corporate = text(child(child(party, 'LegalEntity'), 'CorporateName'));
  if (corporate) return corporate;
  const individual = child(party, 'Individual');
  const parts = [
    text(child(individual, 'Name')),
    text(child(individual, 'FirstSurname')),
    text(child(individual, 'SecondSurname')),
  ].filter((part) => part !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

function partyTax(party: XmlNode | undefined): string | null {
  const value = text(child(child(party, 'TaxIdentification'), 'TaxIdentificationNumber'));
  return value || null;
}

const FACTURAE_PAYMENTS: Record<string, Extraction['payment_method']> = {
  '01': 'cash',
  '02': 'direct_debit',
  '04': 'transfer',
  '19': 'card',
};

function facturaeLine(node: XmlNode, headerRate: string | null): RawLine {
  const tax = child(child(node, 'TaxesOutputs'), 'Tax');
  const held = child(child(node, 'TaxesWithheld'), 'Tax');
  return {
    description: text(child(node, 'ItemDescription')),
    quantity: text(child(node, 'Quantity')),
    unit_price: text(child(node, 'UnitPriceWithoutTax')),
    line_base: text(child(node, 'GrossAmount')) || text(child(node, 'TotalCost')),
    vat_rate: text(child(tax, 'TaxRate')),
    vat_quota: amountNode(child(tax, 'TaxAmount')),
    withholding_rate: text(child(held, 'TaxRate')) || headerRate,
  };
}

function fromFacturae(root: XmlNode): Extraction {
  const invoices = children(child(root, 'Invoices'), 'Invoice');
  const invoice = invoices[0];
  if (!invoice || invoices.length !== 1) invalid('El fichero debe contener una sola factura');
  const seller = child(child(root, 'Parties'), 'SellerParty');
  const buyer = child(child(root, 'Parties'), 'BuyerParty');
  const totals = child(invoice, 'InvoiceTotals');
  const issue = child(invoice, 'InvoiceIssueData');
  const installment = child(child(invoice, 'PaymentDetails'), 'Installment');
  const held = children(child(invoice, 'TaxesWithheld'), 'Tax');
  const headerRate = held.length === 1 ? text(child(held[0], 'TaxRate')) || null : null;
  const taxes = children(child(invoice, 'TaxesOutputs'), 'Tax').map((tax) => ({
    rate: text(child(tax, 'TaxRate')),
    base: amountNode(child(tax, 'TaxableBase')),
    quota: amountNode(child(tax, 'TaxAmount')),
  }));
  const means = text(child(installment, 'PaymentMeans'));
  return buildExtraction({
    extractor: 'facturae',
    supplier_name: partyName(seller),
    supplier_tax_id: partyTax(seller),
    buyer_tax_id: partyTax(buyer),
    number: text(child(child(invoice, 'InvoiceHeader'), 'InvoiceNumber')),
    issue_date: text(child(issue, 'IssueDate')),
    due_date: text(child(installment, 'InstallmentDueDate')),
    currency: text(child(issue, 'InvoiceCurrencyCode')) || 'EUR',
    payment_method: FACTURAE_PAYMENTS[means] ?? null,
    subtotal: text(child(totals, 'TotalGrossAmountBeforeTaxes')) || text(child(totals, 'TotalGrossAmount')),
    tax_total: text(child(totals, 'TotalTaxOutputs')),
    withholding_total: text(child(totals, 'TotalTaxesWithheld')) || '0.00',
    total: text(child(totals, 'InvoiceTotal')),
    lines: children(child(invoice, 'Items'), 'InvoiceLine').map((line) => facturaeLine(line, headerRate)),
    vat_by_rate: taxes,
    confidence: {
      supplier_name: 1,
      supplier_tax_id: 1,
      number: 1,
      issue_date: 1,
      due_date: 1,
      lines: 1,
      vat: 1,
      totals: 1,
    },
  });
}

function ublParty(party: XmlNode | undefined): { name: string | null; tax: string | null } {
  const root = child(party, 'Party') ?? party;
  const legal = child(root, 'PartyLegalEntity');
  const name = text(child(legal, 'RegistrationName')) || text(child(child(root, 'PartyName'), 'Name')) || null;
  const tax = text(child(child(root, 'PartyTaxScheme'), 'CompanyID'))
    || text(child(legal, 'CompanyID'))
    || null;
  return { name: name || null, tax };
}

function ublLine(node: XmlNode): RawLine {
  const tax = child(child(child(node, 'TaxTotal'), 'TaxSubtotal'), 'TaxCategory');
  const quota = text(child(child(child(node, 'TaxTotal'), 'TaxSubtotal'), 'TaxAmount'));
  const item = child(node, 'Item');
  return {
    description: text(child(item, 'Description')) || text(child(item, 'Name')),
    quantity: text(child(node, 'InvoicedQuantity')),
    unit_price: text(child(child(node, 'Price'), 'PriceAmount')),
    line_base: text(child(node, 'LineExtensionAmount')),
    vat_rate: text(child(tax, 'Percent')),
    vat_quota: quota,
    withholding_rate: text(child(child(child(child(node, 'WithholdingTaxTotal'), 'TaxSubtotal'), 'TaxCategory'), 'Percent')),
  };
}

function fromUbl(root: XmlNode): Extraction {
  const supplier = ublParty(child(root, 'AccountingSupplierParty'));
  const buyer = ublParty(child(root, 'AccountingCustomerParty'));
  const monetary = child(root, 'LegalMonetaryTotal');
  const subtotals = children(root, 'TaxTotal').flatMap((total) => children(total, 'TaxSubtotal'));
  const withheld = children(child(root, 'WithholdingTaxTotal'), 'TaxSubtotal');
  const withholding = withheld.reduce((sum, item) => sum + (Number(text(child(item, 'TaxAmount'))) || 0), 0);
  return buildExtraction({
    extractor: 'ubl',
    supplier_name: supplier.name,
    supplier_tax_id: supplier.tax,
    buyer_tax_id: buyer.tax,
    number: text(child(root, 'ID')),
    issue_date: text(child(root, 'IssueDate')),
    due_date: text(child(root, 'DueDate')),
    currency: text(child(root, 'DocumentCurrencyCode')) || 'EUR',
    subtotal: text(child(monetary, 'TaxExclusiveAmount')),
    tax_total: text(child(child(root, 'TaxTotal'), 'TaxAmount')),
    withholding_total: withheld.length > 0 ? withholding.toFixed(2) : '0.00',
    total: text(child(monetary, 'PayableAmount')) || text(child(monetary, 'TaxInclusiveAmount')),
    lines: children(root, 'InvoiceLine').map(ublLine),
    vat_by_rate: subtotals.map((item) => ({
      rate: text(child(child(item, 'TaxCategory'), 'Percent')),
      base: text(child(item, 'TaxableAmount')),
      quota: text(child(item, 'TaxAmount')),
    })),
    confidence: {
      supplier_name: 1,
      supplier_tax_id: 1,
      number: 1,
      issue_date: 1,
      due_date: 1,
      lines: 1,
      vat: 1,
      totals: 1,
    },
  });
}

export function extractXmlInvoice(bytes: Uint8Array): Extraction {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
  } catch {
    invalid('El XML de la factura no se puede leer');
  }
  if (source.length > MAX_XML_CHARS) invalid('El XML de la factura es demasiado grande');
  if (/<!DOCTYPE/iu.test(source) || /<!ENTITY/iu.test(source)) invalid('El XML no puede declarar entidades');
  const root = new Parser(source).parse();
  if (root.name === 'Facturae') return fromFacturae(root);
  if (root.name === 'Invoice') return fromUbl(root);
  invalid('No es una factura electrónica Facturae ni UBL');
}
