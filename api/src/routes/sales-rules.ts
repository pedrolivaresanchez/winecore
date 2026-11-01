import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { actorOf, asRecord, optionalText, pathId, readJson, throwIf } from '../core/sales/db';
import {
  activateRuleSet,
  createRuleSet,
  listRuleSets,
  parseRuleInputs,
  previewIssuingEntity,
  replaceRules,
  requestActivation,
  resolutionJson,
  ruleImpact,
  rulesState,
} from '../core/sales/rules';
import { businessDate } from '../core/time';

export async function getRuleSets(writer: Writer, request: Request) {
  sessionOf(request);
  const items = await writer.withWrite(systemActor(), (tx) => listRuleSets(tx));
  return { items };
}

export async function postRuleSet(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readJson(request).catch(() => ({}));
  const body = asRecord(raw);
  const notes = optionalText(body.notes, 'notes', {}, 500);
  throwIf({});
  const created = await writer.withWrite(actorOf(user, request), (tx) => createRuleSet(tx, user.id, notes));
  return { status: 201, body: created };
}

export async function putRuleSet(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const rules = parseRuleInputs(await readJson(request));
  const setId = pathId(id);
  const body = await writer.withWrite(actorOf(user, request), (tx) => replaceRules(tx, setId, rules));
  return body;
}

export async function getResolve(writer: Writer, request: Request) {
  sessionOf(request);
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customer_id') ?? '';
  const channel = url.searchParams.get('channel') ?? '';
  const setId = url.searchParams.get('set_id');
  return writer.withWrite(systemActor(), async (tx) => {
    const resolved = await previewIssuingEntity(tx, {
      customerId,
      channel,
      ...(setId ? { setId: pathId(setId) } : {}),
    });
    return resolved ? resolutionJson(resolved) : null;
  });
}

export async function getRulesState(writer: Writer, request: Request) {
  sessionOf(request);
  return { state: await writer.withWrite(systemActor(), (tx) => rulesState(tx)) };
}

export async function getImpact(writer: Writer, request: Request, id: string) {
  sessionOf(request);
  const daysRaw = new URL(request.url).searchParams.get('days');
  const days = daysRaw == null ? 90 : Number(daysRaw);
  const safeDays = Number.isInteger(days) && days > 0 && days <= 3660 ? days : 90;
  return writer.withWrite(systemActor(), (tx) => ruleImpact(tx, pathId(id), safeDays, businessDate(new Date())));
}

export async function postRequestActivation(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  return writer.withWrite(actorOf(user, request), (tx) => requestActivation(tx, pathId(id), user.id));
}

export async function postActivate(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  return writer.withWrite(actorOf(user, request), (tx) => activateRuleSet(tx, pathId(id)));
}

function systemActor() {
  return { type: 'system' as const, id: 'sales-rules', requestId: 'sales-rules' };
}
