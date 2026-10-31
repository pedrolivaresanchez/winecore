import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { ibanLast4, isValidIban, normalizeIban } from '../party/iban';
import { actorOf, idempotencyKey, readJson, remember, replay, requestHash, storedResponse } from './idempotency';
import { assertScope } from './payments';
import { requireDataKey } from './runtime';
import { isCreditorId, sepaCreditorId } from './sepa';
import { sealIban } from './ibanSeal';
import { findEntity } from './store';
import { objectOf, optionalText, pick, requiredText } from './support';

const BIC = /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/;
const ROUTE = 'POST /v1/bank-accounts';

export async function createBankAccount(writer: Writer, user: UserCtx, request: Request) {
  const key = idempotencyKey(request);
  const raw = await readJson(request);
  const input = parseAccount(raw);
  const hash = requestHash(raw);
  const now = new Date();
  const dataKey = requireDataKey(writer);
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const entity = await findEntity(tx, input.legalEntityId);
    if (!entity) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
    assertScope(user, 'finance.manage', entity.id);
    const creditor = input.sepaCreditorId ?? sepaCreditorId('ES', entity.taxId);
    if (!isCreditorId(creditor)) {
      throw domainError('WC_VALIDATION', { sepa_creditor_id: 'El identificador de acreedor no es válido' });
    }
    if (input.isDefault) {
      tx.write(sql`
        UPDATE finance.bank_account
        SET is_default = FALSE
        WHERE legal_entity_id = CAST(${entity.id} AS UUID) AND is_default AND is_active
      `);
    }
    const id = newId();
    const iban = normalizeIban(input.iban);
    tx.write(sql`
      INSERT INTO finance.bank_account (
        id, legal_entity_id, bank_name, iban_enc, iban_last4, bic, currency, sepa_creditor_id, is_default, is_active, created_at
      ) VALUES (
        CAST(${id} AS UUID), CAST(${entity.id} AS UUID), ${input.bankName}, ${sealIban(iban, dataKey)},
        ${ibanLast4(iban)}, ${input.bic}, 'EUR', ${creditor}, ${input.isDefault}, TRUE, ${now}
      )
    `);
    tx.audit({
      table: 'finance.bank_account',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        legal_entity_id: entity.id,
        bank_name: input.bankName,
        iban_last4: ibanLast4(iban),
        bic: input.bic,
        sepa_creditor_id: creditor,
        is_default: input.isDefault,
      },
    });
    const body = accountBody({
      id,
      legal_entity_id: entity.id,
      bank_name: input.bankName,
      iban_last4: ibanLast4(iban),
      bic: input.bic,
      sepa_creditor_id: creditor,
      is_default: input.isDefault,
      is_active: true,
    });
    remember(tx, user.id, key, hash, ROUTE, 201, body, now);
    return { status: 201, body };
  });
}

export async function listBankAccounts(writer: Writer, user: UserCtx, request: Request) {
  const entityValue = new URL(request.url).searchParams.get('entity')?.trim() || null;
  let entityId: string | null = null;
  if (entityValue) {
    const entity = await findEntity(writer, entityValue);
    if (!entity) throw domainError('WC_VALIDATION', { entity: 'La entidad no existe' });
    assertScope(user, 'finance.read', entity.id);
    entityId = entity.id;
  }
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id, legal_entity_id, bank_name, iban_last4, bic, sepa_creditor_id, is_default, is_active
    FROM finance.bank_account
    WHERE is_active
      AND (${entityId} IS NULL OR legal_entity_id = CAST(${entityId} AS UUID))
    ORDER BY is_default DESC, bank_name, id
  `);
  return {
    items: rows
      .filter((row) => {
        const scopeOk = entityId !== null || assertVisible(user, String(row.legal_entity_id).toLowerCase());
        return scopeOk;
      })
      .map(accountBody),
  };
}

function assertVisible(user: UserCtx, entityId: string): boolean {
  try {
    assertScope(user, 'finance.read', entityId);
    return true;
  } catch {
    return false;
  }
}

function parseAccount(raw: unknown) {
  const body = objectOf(raw);
  const legalEntityId = requiredText(pick(body, 'legal_entity_id', 'legalEntityId', 'entity'), 'legal_entity_id', 2, 36);
  const bankName = requiredText(pick(body, 'bank_name', 'bankName'), 'bank_name', 2, 80);
  const ibanRaw = requiredText(pick(body, 'iban'), 'iban', 15, 42);
  if (!isValidIban(ibanRaw)) throw domainError('WC_VALIDATION', { iban: 'El IBAN no es válido' });
  const bicRaw = optionalText(pick(body, 'bic'), 'bic', 11);
  const bic = bicRaw ? bicRaw.toUpperCase() : null;
  if (bic && !BIC.test(bic)) throw domainError('WC_VALIDATION', { bic: 'El BIC no es válido' });
  const creditorRaw = optionalText(pick(body, 'sepa_creditor_id', 'sepaCreditorId'), 'sepa_creditor_id', 35);
  const sepaCreditorIdValue = creditorRaw ? creditorRaw.toUpperCase() : null;
  if (sepaCreditorIdValue && !isCreditorId(sepaCreditorIdValue)) {
    throw domainError('WC_VALIDATION', { sepa_creditor_id: 'El identificador de acreedor no es válido' });
  }
  const flag = pick(body, 'is_default', 'isDefault');
  if (flag !== undefined && typeof flag !== 'boolean') {
    throw domainError('WC_VALIDATION', { is_default: 'Debe ser verdadero o falso' });
  }
  return {
    legalEntityId,
    bankName,
    iban: ibanRaw,
    bic,
    sepaCreditorId: sepaCreditorIdValue,
    isDefault: flag === true,
  };
}

function accountBody(row: Record<string, unknown>) {
  return {
    id: String(row.id).toLowerCase(),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    bank_name: String(row.bank_name),
    iban_last4: String(row.iban_last4),
    bic: row.bic == null ? null : String(row.bic),
    sepa_creditor_id: row.sepa_creditor_id == null ? null : String(row.sepa_creditor_id),
    is_default: row.is_default === true,
    is_active: row.is_active !== false,
  };
}
