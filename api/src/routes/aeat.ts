import { requestIdFor, sessionOf } from '../auth/guard';
import { bookCsv } from '../core/aeat/compute';
import { resolveEntity } from '../core/aeat/load';
import { isModel, parsePeriod, type ModelCode } from '../core/aeat/period';
import {
  generateAeat,
  getAeat,
  listAeat,
  markAeatFiled,
  previewBook,
  previewDraft,
  requestAeatApproval,
  validateAeat,
} from '../core/aeat/workflow';
import { can, type Permission, type UserCtx } from '../core/auth/permissions';
import type { Writer } from '../core/db/writer';
import { DomainError, domainError } from '../core/errors';

export interface AeatDeps {
  writer: Writer;
  now: () => Date;
}

export async function getAeatBooks(deps: AeatDeps, request: Request): Promise<Response | Record<string, unknown>> {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const book = url.searchParams.get('book') === 'received' ? 'received' : 'issued';
  const preview = await previewBook(
    deps.writer,
    requiredToken(url.searchParams.get('entity'), 'entity'),
    requiredToken(url.searchParams.get('period'), 'period'),
    book,
  );
  assertCan(user, 'regulatory.read', preview.entity.id);
  if (url.pathname.endsWith('.csv') || url.searchParams.get('format') === 'csv') {
    if (preview.book.checks.some((check) => !check.ok)) {
      throw new DomainError('WC_INV_BOOK', 422, 'El libro no cuadra; no se exporta', undefined, {
        checks: preview.book.checks,
      });
    }
    const filename = `libro-${book === 'issued' ? 'emitidas' : 'recibidas'}-${preview.entity.code}-${preview.period.token}.csv`;
    return new Response(new TextEncoder().encode(bookCsv(preview.book)), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  }
  return {
    entity_id: preview.entity.id,
    entity_code: preview.entity.code,
    period: preview.period.token,
    book: preview.book.book,
    columns: preview.book.columns,
    rows: preview.book.rows,
    checks: preview.book.checks,
    export_blocked: preview.book.checks.some((check) => !check.ok),
    totals: preview.book.totals,
    missing: preview.book.missing,
    notes: preview.book.notes,
  };
}

export async function getAeatDraft(deps: AeatDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const model = requiredModel(url.searchParams.get('model'));
  const preview = await previewDraft(
    deps.writer,
    requiredToken(url.searchParams.get('entity'), 'entity'),
    model,
    requiredToken(url.searchParams.get('period'), 'period'),
  );
  assertCan(user, 'regulatory.read', preview.entity.id);
  return {
    entity_id: preview.entity.id,
    entity_code: preview.entity.code,
    content_sha256: preview.content_sha256,
    ...preview.draft,
  };
}

export async function listAeatSubmissions(deps: AeatDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const entityToken = url.searchParams.get('entity');
  let entityId: string | undefined;
  if (entityToken) {
    const entity = await resolveEntity(deps.writer, entityToken);
    assertCan(user, 'regulatory.read', entity.id);
    entityId = entity.id;
  }
  const modelToken = url.searchParams.get('model');
  const model = modelToken ? requiredModel(modelToken) : undefined;
  const periodToken = url.searchParams.get('period');
  const period = periodToken ? parsePeriod(periodToken) : null;
  if (periodToken && !period) throw domainError('WC_VALIDATION', { period: 'El periodo no es válido' });
  const items = await listAeat(deps.writer, {
    entityId,
    model,
    period: period ?? undefined,
  });
  return { items: items.filter((item) => can(user, 'regulatory.read', item.legal_entity_id)) };
}

export async function postAeatSubmission(deps: AeatDeps, request: Request) {
  const user = sessionOf(request);
  const body = await jsonBody(request);
  const entityToken = requiredToken(
    typeof body.legal_entity_id === 'string' ? body.legal_entity_id : typeof body.entity === 'string' ? body.entity : null,
    'legal_entity_id',
  );
  const model = requiredModel(typeof body.model === 'string' ? body.model : null);
  const period = requiredToken(typeof body.period === 'string' ? body.period : null, 'period');
  const entity = await resolveEntity(deps.writer, entityToken);
  assertCan(user, 'regulatory.prepare', entity.id);
  return generateAeat(deps.writer, actor(user, request), {
    entityToken,
    model,
    periodToken: period,
    createdBy: user.id,
  }, { now: deps.now });
}

export async function getAeatSubmission(deps: AeatDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await getAeat(deps.writer, id);
  assertCan(user, 'regulatory.read', view.legal_entity_id);
  return view;
}

export async function postValidateAeat(deps: AeatDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await getAeat(deps.writer, id);
  assertCan(user, 'regulatory.prepare', view.legal_entity_id);
  return validateAeat(deps.writer, actor(user, request), id);
}

export async function postRequestAeatApproval(deps: AeatDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await getAeat(deps.writer, id);
  assertCan(user, 'regulatory.prepare', view.legal_entity_id);
  return requestAeatApproval(deps.writer, actor(user, request), id, { now: deps.now });
}

export async function postMarkAeatFiled(deps: AeatDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await getAeat(deps.writer, id);
  assertCan(user, 'regulatory.prepare', view.legal_entity_id);
  const body = await jsonBody(request);
  const ref = typeof body.external_ref === 'string' ? body.external_ref : '';
  return markAeatFiled(deps.writer, actor(user, request), id, ref, { now: deps.now });
}

function assertCan(user: UserCtx, permission: Permission, entityId: string): void {
  if (!can(user, permission, entityId)) throw domainError('WC_FORBIDDEN');
}

function actor(user: UserCtx, request: Request) {
  return { type: 'user' as const, id: user.id, requestId: requestIdFor(request) };
}

function requiredModel(value: string | null): ModelCode {
  if (!value || !isModel(value)) throw domainError('WC_VALIDATION', { model: 'El modelo no está en el alcance de WineCore' });
  return value;
}

function requiredToken(value: string | null | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw domainError('WC_VALIDATION', { [field]: 'Dato obligatorio' });
  }
  return value.trim();
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo no es JSON' });
  });
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  throw domainError('WC_VALIDATION', { body: 'El cuerpo no es un objeto' });
}
