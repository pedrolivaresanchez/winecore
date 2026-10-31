import { Decimal } from 'decimal.js';
import { duplicateKey } from '../../../src/core/party/duplicateKey';
import { sha256Hex } from '../../../src/core/hash';
import { finalizeDraft, type ContactDraft } from './contacts';
import { cleanText, integerText, normalizeEmails, normalizePhone, normalizePostal } from '../money';
import { bump } from '../report';

/** Q-023: keep customers with orders or email consent. The rest stay out of party. */
export function parseShopifyCustomers(rows: readonly Record<string, string>[]): {
  drafts: ContactDraft[];
  skipped: Record<string, number>;
  warnings: Record<string, number>;
  nifWarnings: number;
  rowsRead: number;
} {
  const skipped: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  const drafts: ContactDraft[] = [];
  for (const row of rows) {
    const orders = Number(integerText(row['Total Orders']) || '0');
    const marketing = cleanText(row['Accepts Email Marketing']).toLowerCase() === 'yes';
    if (!(orders > 0 || marketing)) {
      bump(skipped, 'not_selected');
      continue;
    }
    const customerId = cleanText(row['Customer ID']);
    if (customerId === '') {
      bump(skipped, 'missing_id');
      continue;
    }
    const person = cleanText(`${row['First Name'] ?? ''} ${row['Last Name'] ?? ''}`);
    const company = cleanText(row['Default Address Company']);
    const legalName = (person || company).slice(0, 120);
    if (legalName === '') {
      bump(skipped, 'missing_name');
      continue;
    }
    const country = countryOf(row['Default Address Country Code']);
    const emails = normalizeEmails(row.Email);
    if (emails.invalid) bump(warnings, 'INVALID_EMAIL');
    const phone = normalizePhone(row.Phone || row['Default Address Phone']);
    if (phone.warning) bump(warnings, 'INVALID_PHONE');
    const postal = normalizePostal(row['Default Address Zip'], country);
    const line1 = [cleanText(row['Default Address Address1']), cleanText(row['Default Address Address2'])]
      .filter((part) => part !== '')
      .join(', ');
    const city = cleanText(row['Default Address City']);
    if (line1 !== '' && (city === '' || postal === null)) bump(warnings, 'MISSING_ADDRESS');
    const legacy: Record<string, string> = {
      shopify: customerId,
      shopify_total_orders: String(Number.isFinite(orders) ? orders : 0),
    };
    const spent = cleanText(row['Total Spent']);
    if (spent) legacy.shopify_total_spent = spent;
    const tags = cleanText(row.Tags);
    if (tags) legacy.shopify_tags = tags;
    const note = cleanText(row.Note);
    if (note) legacy.shopify_note = note;
    const exempt = cleanText(row['Tax Exempt']);
    if (exempt) legacy.shopify_tax_exempt = exempt;
    const sms = cleanText(row['Accepts SMS Marketing']);
    if (sms) legacy.shopify_sms = sms;
    const whatsapp = cleanText(row['Accepts WhatsApp Marketing']);
    if (whatsapp) legacy.shopify_whatsapp = whatsapp;
    const nameKey = duplicateKey({ name: legalName, postalCode: postal });
    drafts.push(finalizeDraft({
      legalName,
      kind: company ? 'company' : 'person',
      taxId: null,
      taxType: 'none',
      taxCountry: null,
      country,
      language: 'es',
      currency: 'EUR',
      isCustomer: true,
      isSupplier: false,
      lead: false,
      paymentMethod: null,
      includeM347: false,
      email: emails.emails[0] ?? null,
      phone: phone.phone,
      line1: line1 || null,
      city: city || null,
      postal,
      province: cleanText(row['Default Address Province Code']) || null,
      discount: new Decimal(0),
      customerAccount: null,
      supplierAccount: null,
      ibanEnc: null,
      ibanLast4: null,
      sepaRef: null,
      marketing,
      marketingSource: marketing ? 'shopify' : null,
      legacy,
      nameHash: sha256Hex(nameKey),
      nameKey,
      rowKey: '',
      entityKey: 'shopify',
      score: 0,
    }));
  }
  return { drafts, skipped, warnings, nifWarnings: 0, rowsRead: rows.length };
}

function countryOf(raw: string | undefined): string {
  const text = cleanText(raw).toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : 'ES';
}
