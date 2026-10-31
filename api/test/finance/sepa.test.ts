import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPain001, buildPain008, sepaCreditorId, type Pain001Input, type Pain008Input } from '../../src/core/finance/sepa';
import { spanishIban } from './iban';

const pain008Input = (creditorIban: string, debtorIban: string, creditorId: string): Pain008Input => ({
  messageId: 'MSG00000000000000000000000000001',
  paymentInfoId: 'PMT00000000000000000000000000001',
  createdAt: '2026-11-02T09:30:00Z',
  collectionDate: '2026-11-15',
  initiatorName: 'Acreedor Ejemplo SL',
  creditorName: 'Acreedor Ejemplo SL',
  creditorIban,
  creditorBic: 'TESTESMMXXX',
  creditorSchemeId: creditorId,
  transactions: [{
    endToEndId: 'E2E00000000000000000000000000001',
    amount: '121.00',
    mandateId: 'MANDATO-0001',
    mandateDate: '2025-04-15',
    debtorName: 'Cliente Ejemplo SL',
    debtorIban,
    debtorBic: null,
    remittance: 'Factura FS26-0001',
  }],
});

const pain001Input = (debtorIban: string, creditorIban: string): Pain001Input => ({
  messageId: 'MSG00000000000000000000000000002',
  paymentInfoId: 'PMT00000000000000000000000000002',
  createdAt: '2026-11-02T09:30:00Z',
  executionDate: '2026-11-16',
  initiatorName: 'Acreedor Ejemplo SL',
  debtorName: 'Acreedor Ejemplo SL',
  debtorIban,
  debtorBic: 'TESTESMMXXX',
  transactions: [{
    endToEndId: 'E2E00000000000000000000000000002',
    amount: '80.50',
    creditorName: 'Proveedor Ejemplo SL',
    creditorIban,
    creditorBic: null,
    remittance: 'Factura PR-1001',
  }],
});

function xsd(kind: 'pain.008.001.02' | 'pain.001.001.03', xml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sepa-'));
  const file = join(dir, 'file.xml');
  writeFileSync(file, xml);
  const schema = join(import.meta.dir, '../fixtures/xsd', `${kind}.xsd`);
  const result = spawnSync('xmllint', ['--noout', '--schema', schema, file], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

describe('ficheros SEPA', () => {
  const creditor = spanishIban('0099', '0001', '0000000001');
  const debtor = spanishIban('0099', '0001', '0000000002');
  const supplier = spanishIban('0099', '0001', '0000000003');

  it('el adeudo pain.008.001.02 coincide con el fichero de referencia y el XSD', () => {
    const scheme = sepaCreditorId('ES', 'Q0000001A');
    const xml = buildPain008(pain008Input(creditor, debtor, scheme));
    const golden = readFileSync(join(import.meta.dir, 'golden/pain.008.001.02.xml'), 'utf8')
      .replaceAll('{{CREDITOR_IBAN}}', creditor)
      .replaceAll('{{DEBTOR_IBAN}}', debtor)
      .replaceAll('{{CREDITOR_ID}}', scheme);
    expect(xml).toBe(golden);
    expect(xml).toContain('MANDATO-0001');
    expect(xml).toContain('pain.008.001.02');
    xsd('pain.008.001.02', xml);
  });

  it('la transferencia pain.001.001.03 coincide con el fichero de referencia y el XSD', () => {
    const xml = buildPain001(pain001Input(creditor, supplier));
    const golden = readFileSync(join(import.meta.dir, 'golden/pain.001.001.03.xml'), 'utf8')
      .replaceAll('{{DEBTOR_IBAN}}', creditor)
      .replaceAll('{{CREDITOR_IBAN}}', supplier);
    expect(xml).toBe(golden);
    expect(xml).toContain('pain.001.001.03');
    xsd('pain.001.001.03', xml);
  });

  it('valida un adeudo con dos operaciones', () => {
    const input = pain008Input(creditor, debtor, sepaCreditorId('ES', 'Q0000001A'));
    input.transactions.push({
      ...input.transactions[0]!,
      endToEndId: 'E2E00000000000000000000000000009',
      amount: '10.00',
      debtorIban: supplier,
    });
    const xml = buildPain008(input);
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>131.00</CtrlSum>');
    xsd('pain.008.001.02', xml);
  });
});
