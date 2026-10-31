import { Decimal } from 'decimal.js';
import { normalizeIban } from '../party/iban';
import { moneyText } from './support';
import { xmlText } from './xml';

export interface Pain008Transaction {
  endToEndId: string;
  amount: string;
  mandateId: string;
  mandateDate: string;
  debtorName: string;
  debtorIban: string;
  debtorBic: string | null;
  remittance: string;
}

export interface Pain008Input {
  messageId: string;
  paymentInfoId: string;
  createdAt: string;
  collectionDate: string;
  initiatorName: string;
  creditorName: string;
  creditorIban: string;
  creditorBic: string | null;
  creditorSchemeId: string;
  transactions: Pain008Transaction[];
}

export interface Pain001Transaction {
  endToEndId: string;
  amount: string;
  creditorName: string;
  creditorIban: string;
  creditorBic: string | null;
  remittance: string;
}

export interface Pain001Input {
  messageId: string;
  paymentInfoId: string;
  createdAt: string;
  executionDate: string;
  initiatorName: string;
  debtorName: string;
  debtorIban: string;
  debtorBic: string | null;
  transactions: Pain001Transaction[];
}

const BIC = /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/;

export function sepaTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function sepaReference(prefix: string, id: string): string {
  return `${prefix}${id.replaceAll('-', '')}`.toUpperCase().slice(0, 35);
}

export function sepaCreditorId(country: string, nationalId: string, suffix = '000'): string {
  const body = `${suffix}${nationalId.toUpperCase()}`;
  const check = mod97Check(`${body}${country.toUpperCase()}00`);
  return `${country.toUpperCase()}${String(98 - check).padStart(2, '0')}${body}`;
}

export function isCreditorId(value: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3,31}$/.test(value)) return false;
  return mod97(value.slice(4) + value.slice(0, 4)) === 1;
}

export function buildPain008(input: Pain008Input): string {
  const count = String(input.transactions.length);
  const sum = moneyText(input.transactions.reduce((total, item) => total.plus(item.amount), new Decimal(0)));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">',
    '  <CstmrDrctDbtInitn>',
    '    <GrpHdr>',
    tag(3, 'MsgId', input.messageId),
    tag(3, 'CreDtTm', input.createdAt),
    tag(3, 'NbOfTxs', count),
    tag(3, 'CtrlSum', sum),
    '      <InitgPty>',
    tag(4, 'Nm', xmlText(input.initiatorName, 70)),
    '      </InitgPty>',
    '    </GrpHdr>',
    '    <PmtInf>',
    tag(3, 'PmtInfId', input.paymentInfoId),
    tag(3, 'PmtMtd', 'DD'),
    tag(3, 'BtchBookg', 'true'),
    tag(3, 'NbOfTxs', count),
    tag(3, 'CtrlSum', sum),
    '      <PmtTpInf>',
    '        <SvcLvl>',
    tag(5, 'Cd', 'SEPA'),
    '        </SvcLvl>',
    '        <LclInstrm>',
    tag(5, 'Cd', 'CORE'),
    '        </LclInstrm>',
    tag(4, 'SeqTp', 'RCUR'),
    '      </PmtTpInf>',
    tag(3, 'ReqdColltnDt', input.collectionDate),
    '      <Cdtr>',
    tag(4, 'Nm', xmlText(input.creditorName, 70)),
    '      </Cdtr>',
    account(3, 'CdtrAcct', input.creditorIban),
    agent(3, 'CdtrAgt', input.creditorBic),
    tag(3, 'ChrgBr', 'SLEV'),
    '      <CdtrSchmeId>',
    '        <Id>',
    '          <PrvtId>',
    '            <Othr>',
    tag(7, 'Id', input.creditorSchemeId),
    '              <SchmeNm>',
    tag(8, 'Prtry', 'SEPA'),
    '              </SchmeNm>',
    '            </Othr>',
    '          </PrvtId>',
    '        </Id>',
    '      </CdtrSchmeId>',
  ];
  for (const item of input.transactions) {
    lines.push(
      '      <DrctDbtTxInf>',
      '        <PmtId>',
      tag(5, 'EndToEndId', item.endToEndId),
      '        </PmtId>',
      amountTag(4, item.amount),
      '        <DrctDbtTx>',
      '          <MndtRltdInf>',
      tag(6, 'MndtId', item.mandateId),
      tag(6, 'DtOfSgntr', item.mandateDate),
      '          </MndtRltdInf>',
      '        </DrctDbtTx>',
      agent(4, 'DbtrAgt', item.debtorBic),
      '        <Dbtr>',
      tag(5, 'Nm', xmlText(item.debtorName, 70)),
      '        </Dbtr>',
      account(4, 'DbtrAcct', item.debtorIban),
      '        <RmtInf>',
      tag(5, 'Ustrd', xmlText(item.remittance, 140)),
      '        </RmtInf>',
      '      </DrctDbtTxInf>',
    );
  }
  lines.push('    </PmtInf>', '  </CstmrDrctDbtInitn>', '</Document>', '');
  return lines.join('\n');
}

export function buildPain001(input: Pain001Input): string {
  const count = String(input.transactions.length);
  const sum = moneyText(input.transactions.reduce((total, item) => total.plus(item.amount), new Decimal(0)));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">',
    '  <CstmrCdtTrfInitn>',
    '    <GrpHdr>',
    tag(3, 'MsgId', input.messageId),
    tag(3, 'CreDtTm', input.createdAt),
    tag(3, 'NbOfTxs', count),
    tag(3, 'CtrlSum', sum),
    '      <InitgPty>',
    tag(4, 'Nm', xmlText(input.initiatorName, 70)),
    '      </InitgPty>',
    '    </GrpHdr>',
    '    <PmtInf>',
    tag(3, 'PmtInfId', input.paymentInfoId),
    tag(3, 'PmtMtd', 'TRF'),
    tag(3, 'BtchBookg', 'true'),
    tag(3, 'NbOfTxs', count),
    tag(3, 'CtrlSum', sum),
    '      <PmtTpInf>',
    '        <SvcLvl>',
    tag(5, 'Cd', 'SEPA'),
    '        </SvcLvl>',
    '      </PmtTpInf>',
    tag(3, 'ReqdExctnDt', input.executionDate),
    '      <Dbtr>',
    tag(4, 'Nm', xmlText(input.debtorName, 70)),
    '      </Dbtr>',
    account(3, 'DbtrAcct', input.debtorIban),
    agent(3, 'DbtrAgt', input.debtorBic),
    tag(3, 'ChrgBr', 'SLEV'),
  ];
  for (const item of input.transactions) {
    lines.push(
      '      <CdtTrfTxInf>',
      '        <PmtId>',
      tag(5, 'EndToEndId', item.endToEndId),
      '        </PmtId>',
      '        <Amt>',
      amountTag(5, item.amount),
      '        </Amt>',
      agent(4, 'CdtrAgt', item.creditorBic),
      '        <Cdtr>',
      tag(5, 'Nm', xmlText(item.creditorName, 70)),
      '        </Cdtr>',
      account(4, 'CdtrAcct', item.creditorIban),
      '        <RmtInf>',
      tag(5, 'Ustrd', xmlText(item.remittance, 140)),
      '        </RmtInf>',
      '      </CdtTrfTxInf>',
    );
  }
  lines.push('    </PmtInf>', '  </CstmrCdtTrfInitn>', '</Document>', '');
  return lines.join('\n');
}

function tag(level: number, name: string, value: string): string {
  return `${'  '.repeat(level)}<${name}>${value}</${name}>`;
}

function amountTag(level: number, amount: string): string {
  return `${'  '.repeat(level)}<InstdAmt Ccy="EUR">${amount}</InstdAmt>`;
}

function account(level: number, name: string, iban: string): string {
  const pad = '  '.repeat(level);
  const inner = '  '.repeat(level + 1);
  const deep = '  '.repeat(level + 2);
  return [
    `${pad}<${name}>`,
    `${inner}<Id>`,
    `${deep}<IBAN>${normalizeIban(iban)}</IBAN>`,
    `${inner}</Id>`,
    `${pad}</${name}>`,
  ].join('\n');
}

function agent(level: number, name: string, bic: string | null): string {
  const pad = '  '.repeat(level);
  const inner = '  '.repeat(level + 1);
  const deep = '  '.repeat(level + 2);
  const id = bic && BIC.test(bic)
    ? `${deep}<BIC>${bic}</BIC>`
    : `${deep}<Othr>\n${'  '.repeat(level + 3)}<Id>NOTPROVIDED</Id>\n${deep}</Othr>`;
  return [
    `${pad}<${name}>`,
    `${inner}<FinInstnId>`,
    id,
    `${inner}</FinInstnId>`,
    `${pad}</${name}>`,
  ].join('\n');
}

function mod97(value: string): number {
  const digits = value.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (const char of digits) remainder = (remainder * 10 + Number(char)) % 97;
  return remainder;
}

function mod97Check(rearrangedWithZeroCheck: string): number {
  return mod97(rearrangedWithZeroCheck);
}
