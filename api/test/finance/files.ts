export function n43Amount(amount: string): string {
  const [whole, frac = '00'] = amount.replace('-', '').split('.');
  return `${(whole ?? '0').padStart(12, '0').slice(-12)}${frac.padEnd(2, '0').slice(0, 2)}`;
}

function yymmdd(iso: string): string {
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
}

function pad(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, ' ');
}

export function n43AccountHeader(account: string, from: string, to: string): string {
  const line = `1100990001${account}${yymmdd(from)}${yymmdd(to)}2${'0'.repeat(14)}9783`;
  return line.padEnd(80, ' ');
}

export function n43Movement(input: {
  bookingDate: string;
  valueDate?: string;
  amount: string;
  credit?: boolean;
  document?: string;
  reference?: string;
  concept?: string;
}): string {
  const credit = input.credit ?? !input.amount.startsWith('-');
  const magnitude = input.amount.replace('-', '');
  let line = '22    0001';
  line += yymmdd(input.bookingDate);
  line += yymmdd(input.valueDate ?? input.bookingDate);
  line += '14000';
  line += credit ? '2' : '1';
  line += n43Amount(magnitude);
  line += pad(input.document ?? '', 10);
  line += pad(input.reference ?? '', 12);
  line += pad('', 16);
  if (line.length !== 80) throw new Error(`Norma 43 de prueba: ${line.length}`);
  const rows = [line];
  if (input.concept) rows.push(`2301${pad(input.concept, 38)}${pad('', 38)}`.slice(0, 80));
  return rows.join('\n');
}

export function camtEntry(input: {
  amount: string;
  credit?: boolean;
  bookingDate: string;
  valueDate?: string;
  reference: string;
  endToEnd?: string;
  remittance?: string;
  counterparty?: string;
}): string {
  const credit = input.credit ?? !input.amount.startsWith('-');
  const amount = input.amount.replace('-', '');
  const party = credit ? 'Dbtr' : 'Cdtr';
  return `
      <Ntry>
        <Amt Ccy="EUR">${amount}</Amt>
        <CdtDbtInd>${credit ? 'CRDT' : 'DBIT'}</CdtDbtInd>
        <BookgDt><Dt>${input.bookingDate}</Dt></BookgDt>
        <ValDt><Dt>${input.valueDate ?? input.bookingDate}</Dt></ValDt>
        <AcctSvcrRef>${input.reference}</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>${input.endToEnd ?? input.reference}</EndToEndId></Refs>
            <RltdPties><${party}><Nm>${input.counterparty ?? 'Cliente Ejemplo SL'}</Nm></${party}></RltdPties>
            <RmtInf><Ustrd>${input.remittance ?? 'Apunte'}</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`;
}

export function camtStatement(entries: string, from: string, to: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-SINTETICO</Id>
      <CreDtTm>${from}T08:00:00</CreDtTm>
      <FrToDt>
        <FrDtTm>${from}T00:00:00</FrDtTm>
        <ToDtTm>${to}T23:59:59</ToDtTm>
      </FrToDt>
      <Acct><Id><Othr><Id>CUENTA-SINTETICA</Id></Othr></Id></Acct>
      ${entries}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
}
