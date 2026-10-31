import { sessionOf } from '../../auth/guard';
import type { Actor, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { aggregateSamples, type DayBallot, type SampleAggregate } from './aggregate';
import { resolveTaster } from './notes';
import { loadLot, requireRow } from './refs';
import { asDate, asId, asInstant, asInt, asNumber, asText } from './rows';
import type { SessionStatus } from './types';
import {
  invalid,
  isUuid,
  optionalText,
  optionalUuid,
  parseScore,
  rejectUnknown,
  requireDay,
  requireObject,
  requireText,
  requireUuid,
} from './validate';

export interface PublicSample {
  sample_no: number;
  lot_id?: string;
  lot_code?: string;
  vessel_id?: string | null;
  vessel_code?: string | null;
}

export interface SessionVoteView {
  id: string;
  sample_no: number;
  day_no: number;
  taster_name: string;
  vote: 'yes' | 'no';
  score: number | null;
  comment: string | null;
}

export interface SessionAggregate extends SampleAggregate {
  lot_id?: string;
  lot_code?: string;
  vessel_id?: string | null;
  vessel_code?: string | null;
}

/** Quién ha votado, sin el contenido del voto. Solo lo ve el organizador antes del revelado. */
export interface VoteProgress {
  taster_name: string;
  sample_no: number;
  day_no: number;
}

export interface SessionViewer {
  userId: string;
}

export interface SessionView {
  id: string;
  title: string;
  target: string;
  status: SessionStatus;
  started_on: string;
  days: number;
  notes: string | null;
  revealed: boolean;
  revealed_at: string | null;
  samples: PublicSample[];
  votes: SessionVoteView[];
  progress: VoteProgress[] | null;
  aggregate: SessionAggregate[] | null;
}

export interface SelectionView {
  session_id: string;
  target: string;
  revealed: true;
  lots: {
    lot_id: string;
    lot_code: string;
    vessel_id: string | null;
    vessel_code: string | null;
    sample_no: number;
    yes_ratio: number;
    mean_score: number | null;
    consistency: number | null;
  }[];
}

export interface VoteResult {
  vote_id: string;
  session_id: string;
  sample_no: number;
  day_no: number;
  vote: 'yes' | 'no';
  score: number | null;
  taster_name: string;
  updated: boolean;
}

interface SampleRow {
  id: string;
  sample_no: number;
  lot_id: string;
  lot_code: string;
  vessel_id: string | null;
  vessel_code: string | null;
}

const SESSION_KEYS = ['title', 'target', 'started_on', 'days', 'notes'];
const SAMPLE_KEYS = ['session_id', 'lot_id', 'vessel_id'];
const VOTE_KEYS = ['session_id', 'sample_no', 'day_no', 'vote', 'score', 'comment', 'taster_name', 'taster_user_id'];

export async function listSessions(writer: Writer, request: Request): Promise<{ items: SessionView[] }> {
  const url = new URL(request.url);
  const where = ['TRUE'];
  const target = url.searchParams.get('target');
  const status = url.searchParams.get('status');
  if (target) where.push(sql`target = ${target}`);
  if (status) where.push(sql`status = ${status}`);
  const rows = await writer.read<{ id: string }>(
    `SELECT id::VARCHAR AS id FROM tasting.blind_session WHERE ${where.join(' AND ')} ORDER BY started_on DESC, id DESC LIMIT 100`,
  );
  const viewer = { userId: sessionOf(request).id };
  const items: SessionView[] = [];
  for (const row of rows) items.push(await getSession(writer, asId(row.id), viewer));
  return { items };
}

export async function createSession(writer: Writer, actor: Actor, body: unknown): Promise<SessionView> {
  const record = requireObject(body);
  rejectUnknown(record, SESSION_KEYS);
  const title = requireText(record.title, 'title', 160);
  const target = requireText(record.target, 'target', 120);
  const startedOn = requireDay(record.started_on, 'started_on');
  if (typeof record.days !== 'number' || (record.days !== 2 && record.days !== 3)) {
    invalid({ days: 'La sesión dura 2 o 3 días' });
  }
  const days = record.days;
  const notes = optionalText(record.notes, 'notes', 2000);
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO tasting.blind_session (id, title, target, started_on, days, notes, created_by)
      VALUES (CAST(${id} AS UUID), ${title}, ${target}, CAST(${startedOn} AS DATE), ${days}, ${notes}, ${actor.id})
    `);
    tx.audit({
      table: 'tasting.blind_session',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { title, target, started_on: startedOn, days },
    });
  });
  return getSession(writer, id);
}

export async function getSession(writer: Writer, id: string, viewer: SessionViewer | null = null): Promise<SessionView> {
  const session = await loadSession(writer, id);
  const samples = await loadSamples(writer, session.id);
  const votes = await loadVotes(writer, session.id);
  const revealed = session.status === 'revealed';
  const aggregate = revealed ? await withSelection(writer, session.id, samples, votes) : null;
  return presentSession(session, samples, votes, aggregate, viewer);
}

export async function listSessionSamples(writer: Writer, body: unknown): Promise<{
  session_id: string;
  status: SessionStatus;
  revealed: boolean;
  target: string;
  samples: PublicSample[];
}> {
  const record = requireObject(body);
  rejectUnknown(record, ['session_id']);
  const session = await getSession(writer, requireUuid(record.session_id, 'session_id'));
  return {
    session_id: session.id,
    status: session.status,
    revealed: session.revealed,
    target: session.target,
    samples: session.revealed
      ? session.samples
      : session.samples.map((sample) => ({ sample_no: sample.sample_no })),
  };
}

export async function addSample(writer: Writer, actor: Actor, body: unknown): Promise<{
  sample_no: number;
  lot_id: string;
  vessel_id: string | null;
}> {
  const record = requireObject(body);
  rejectUnknown(record, SAMPLE_KEYS);
  const sessionId = requireUuid(record.session_id, 'session_id');
  const lotId = requireUuid(record.lot_id, 'lot_id');
  const vesselId = optionalUuid(record.vessel_id, 'vessel_id');
  const id = newId();
  let sampleNo = 0;
  await writer.withWrite(actor, async (tx) => {
    const session = await loadSession(tx, sessionId);
    if (session.status !== 'open') throw domainError('WC_TASTING_CLOSED');
    const lot = await loadLot(tx, lotId);
    if (!lot) invalid({ lot_id: 'El lote no existe' });
    if (vesselId) await requireRow(tx, 'cellar.vessel', vesselId, 'vessel_id');
    const clash = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM tasting.blind_sample
      WHERE session_id = CAST(${sessionId} AS UUID) AND lot_id = CAST(${lotId} AS UUID)
      LIMIT 1
    `);
    if (clash[0]) invalid({ lot_id: 'Ese lote ya está en la sesión' });
    const maxRows = await tx.read<{ n: unknown }>(sql`
      SELECT COALESCE(MAX(sample_no), 0) AS n FROM tasting.blind_sample
      WHERE session_id = CAST(${sessionId} AS UUID)
    `);
    sampleNo = (asInt(maxRows[0]?.n) ?? 0) + 1;
    tx.write(sql`
      INSERT INTO tasting.blind_sample (id, session_id, sample_no, lot_id, vessel_id)
      VALUES (
        CAST(${id} AS UUID), CAST(${sessionId} AS UUID), ${sampleNo},
        CAST(${lotId} AS UUID), CAST(${vesselId} AS UUID)
      )
    `);
    tx.audit({
      table: 'tasting.blind_sample',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { session_id: sessionId, sample_no: sampleNo, lot_id: lotId, vessel_id: vesselId },
    });
  });
  return { sample_no: sampleNo, lot_id: lotId, vessel_id: vesselId };
}

export async function castVote(writer: Writer, actor: Actor, body: unknown): Promise<VoteResult> {
  const record = requireObject(body);
  rejectUnknown(record, VOTE_KEYS);
  const sessionId = requireUuid(record.session_id, 'session_id');
  const sampleNo = positiveInt(record.sample_no, 'sample_no');
  const dayNo = positiveInt(record.day_no, 'day_no');
  if (record.vote !== 'yes' && record.vote !== 'no') invalid({ vote: 'El voto es yes o no' });
  const vote = record.vote;
  const score = parseScore(record.score, 'score', '0-100');
  const comment = optionalText(record.comment, 'comment', 2000);
  const requestedName = optionalText(record.taster_name, 'taster_name', 120);
  const requestedUser = optionalUuid(record.taster_user_id, 'taster_user_id');
  let result: VoteResult | null = null;
  await writer.withWrite(actor, async (tx) => {
    const session = await loadSession(tx, sessionId);
    if (session.status !== 'open') throw domainError('WC_TASTING_CLOSED');
    if (dayNo > session.days) throw domainError('WC_TASTING_DAY', { day_no: `La sesión tiene ${session.days} días` });
    const samples = await loadSamples(tx, sessionId);
    const sample = samples.find((item) => item.sample_no === sampleNo);
    if (!sample) invalid({ sample_no: 'No hay esa muestra' });
    const taster = await resolveTaster(tx, requestedUser, requestedName, actor.id);
    const tasterUserId = taster.userId ?? (isUuid(actor.id) ? actor.id.toLowerCase() : null);
    const existing = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM tasting.blind_vote
      WHERE sample_id = CAST(${sample.id} AS UUID)
        AND day_no = ${dayNo}
        AND lower(taster_name) = lower(${taster.name})
      LIMIT 1
    `);
    const current = existing[0];
    if (current) {
      const voteId = asId(current.id);
      tx.write(sql`
        UPDATE tasting.blind_vote
        SET vote = ${vote}, score = ${score}, comment = ${comment}, updated_at = now()
        WHERE id = CAST(${voteId} AS UUID)
      `);
      tx.audit({
        table: 'tasting.blind_vote',
        rowId: voteId,
        action: 'UPDATE',
        before: null,
        after: { vote, score, comment, day_no: dayNo, sample_no: sampleNo },
      });
      result = {
        vote_id: voteId,
        session_id: sessionId,
        sample_no: sampleNo,
        day_no: dayNo,
        vote,
        score,
        taster_name: taster.name,
        updated: true,
      };
      return;
    }
    const voteId = newId();
    tx.write(sql`
      INSERT INTO tasting.blind_vote (
        id, session_id, sample_id, day_no, taster_user_id, taster_name, vote, score, comment
      ) VALUES (
        CAST(${voteId} AS UUID), CAST(${sessionId} AS UUID), CAST(${sample.id} AS UUID), ${dayNo},
        CAST(${tasterUserId} AS UUID), ${taster.name}, ${vote}, ${score}, ${comment}
      )
    `);
    tx.audit({
      table: 'tasting.blind_vote',
      rowId: voteId,
      action: 'INSERT',
      before: null,
      after: {
        session_id: sessionId,
        sample_no: sampleNo,
        day_no: dayNo,
        vote,
        score,
        comment,
        taster_name: taster.name,
        taster_user_id: tasterUserId,
      },
    });
    result = {
      vote_id: voteId,
      session_id: sessionId,
      sample_no: sampleNo,
      day_no: dayNo,
      vote,
      score,
      taster_name: taster.name,
      updated: false,
    };
  });
  if (!result) throw domainError('WC_VALIDATION', { vote: 'No se ha guardado el voto' });
  return result;
}

export async function revealSession(writer: Writer, actor: Actor, body: unknown): Promise<SessionView> {
  const record = requireObject(body);
  rejectUnknown(record, ['session_id']);
  const sessionId = requireUuid(record.session_id, 'session_id');
  await writer.withWrite(actor, async (tx) => {
    const session = await loadSession(tx, sessionId);
    if (session.status !== 'open') throw domainError('WC_TASTING_CLOSED');
    const samples = await loadSamples(tx, sessionId);
    if (samples.length === 0) invalid({ samples: 'La sesión no tiene muestras' });
    const votes = await loadVotes(tx, sessionId);
    const aggregate = aggregateSamples(samples.map((sample) => sample.sample_no), votes.map(voteFact));
    tx.write(sql`
      UPDATE tasting.blind_session
      SET status = 'revealed', revealed_at = now(), revealed_by = ${actor.id}
      WHERE id = CAST(${sessionId} AS UUID)
    `);
    tx.audit({
      table: 'tasting.blind_session',
      rowId: sessionId,
      action: 'UPDATE',
      before: { status: 'open' },
      after: { status: 'revealed' },
    });
    for (const row of aggregate) {
      const sample = samples.find((item) => item.sample_no === row.sample_no);
      if (!sample) continue;
      const pickId = newId();
      tx.write(sql`
        INSERT INTO tasting.blind_pick (
          id, session_id, sample_id, lot_id, yes_ratio, mean_score, consistency, selected
        ) VALUES (
          CAST(${pickId} AS UUID), CAST(${sessionId} AS UUID), CAST(${sample.id} AS UUID),
          CAST(${sample.lot_id} AS UUID), ${row.yes_ratio}, ${row.mean_score}, ${row.consistency}, ${row.selected}
        )
      `);
      tx.audit({
        table: 'tasting.blind_pick',
        rowId: pickId,
        action: 'INSERT',
        before: null,
        after: { session_id: sessionId, lot_id: sample.lot_id, sample_no: row.sample_no, selected: row.selected },
      });
    }
  });
  return getSession(writer, sessionId);
}

/**
 * Borra una sesión que sigue abierta y en la que nadie ha votado.
 * Las muestras se borran en una escritura aparte: DuckDB no deja borrar
 * la sesión mientras la clave sigue referenciada en la misma transacción.
 */
export async function deleteSession(writer: Writer, actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  if (!isUuid(id)) invalid({ id: 'Debe ser un UUID' });
  const sessionId = id.toLowerCase();
  const session = await loadSession(writer, sessionId);
  const votes = await loadVotes(writer, sessionId);
  if (session.status !== 'open' || votes.length > 0) {
    throw domainError('WC_TASTING_CLOSED', { id: 'La sesión ya ha empezado' }, 'La sesión ya ha empezado');
  }
  const samples = await loadSamples(writer, sessionId);
  if (samples.length > 0) {
    await writer.withWrite(actor, async (tx) => {
      const still = await loadVotes(tx, sessionId);
      if (still.length > 0) {
        throw domainError('WC_TASTING_CLOSED', { id: 'La sesión ya ha empezado' }, 'La sesión ya ha empezado');
      }
      for (const sample of samples) {
        tx.audit({
          table: 'tasting.blind_sample',
          rowId: sample.id,
          action: 'DELETE',
          before: {
            session_id: sessionId,
            sample_no: sample.sample_no,
            lot_id: sample.lot_id,
            vessel_id: sample.vessel_id,
          },
          after: null,
        });
      }
      tx.write(sql`DELETE FROM tasting.blind_sample WHERE session_id = CAST(${sessionId} AS UUID)`);
    });
  }
  await writer.withWrite(actor, async (tx) => {
    const current = await loadSession(tx, sessionId);
    const remainingVotes = await loadVotes(tx, sessionId);
    const remainingSamples = await loadSamples(tx, sessionId);
    if (current.status !== 'open' || remainingVotes.length > 0 || remainingSamples.length > 0) {
      throw domainError('WC_TASTING_CLOSED', { id: 'La sesión ya ha empezado' }, 'La sesión ya ha empezado');
    }
    tx.audit({
      table: 'tasting.blind_session',
      rowId: sessionId,
      action: 'DELETE',
      before: {
        title: current.title,
        target: current.target,
        status: current.status,
        started_on: current.started_on,
      },
      after: null,
    });
    tx.write(sql`DELETE FROM tasting.blind_session WHERE id = CAST(${sessionId} AS UUID)`);
  });
  return { id: sessionId, deleted: true };
}

export async function getSelection(writer: Writer, sessionId: string): Promise<SelectionView> {
  if (!isUuid(sessionId)) invalid({ session_id: 'Debe ser un UUID' });
  const session = await loadSession(writer, sessionId);
  if (session.status !== 'revealed') throw domainError('WC_TASTING_HIDDEN');
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT p.lot_id::VARCHAR AS lot_id, l.code AS lot_code, s.vessel_id::VARCHAR AS vessel_id,
           v.code AS vessel_code, s.sample_no, p.yes_ratio, p.mean_score, p.consistency
    FROM tasting.blind_pick p
    JOIN tasting.blind_sample s ON s.id = p.sample_id
    JOIN inventory.lot l ON l.id = p.lot_id
    LEFT JOIN cellar.vessel v ON v.id = s.vessel_id
    WHERE p.session_id = CAST(${sessionId} AS UUID) AND p.selected
    ORDER BY s.sample_no
  `);
  return {
    session_id: session.id,
    target: session.target,
    revealed: true,
    lots: rows.map((row) => ({
      lot_id: asId(row.lot_id),
      lot_code: asText(row.lot_code),
      vessel_id: row.vessel_id == null ? null : asId(row.vessel_id),
      vessel_code: row.vessel_code == null ? null : asText(row.vessel_code),
      sample_no: asInt(row.sample_no) ?? 0,
      yes_ratio: asNumber(row.yes_ratio) ?? 0,
      mean_score: asNumber(row.mean_score),
      consistency: asNumber(row.consistency),
    })),
  };
}

export async function setSelection(writer: Writer, actor: Actor, body: unknown): Promise<SelectionView> {
  const record = requireObject(body);
  rejectUnknown(record, ['session_id', 'lot_ids']);
  const sessionId = requireUuid(record.session_id, 'session_id');
  if (!Array.isArray(record.lot_ids)) invalid({ lot_ids: 'Debe ser una lista de lotes' });
  const lotIds = record.lot_ids.map((item) => requireUuid(item, 'lot_ids'));
  await writer.withWrite(actor, async (tx) => {
    const session = await loadSession(tx, sessionId);
    if (session.status !== 'revealed') throw domainError('WC_TASTING_HIDDEN');
    const samples = await loadSamples(tx, sessionId);
    const known = new Set(samples.map((sample) => sample.lot_id));
    for (const lotId of lotIds) {
      if (!known.has(lotId)) invalid({ lot_ids: 'Hay un lote que no está en la sesión' });
    }
    const chosen = new Set(lotIds);
    const picks = await tx.read<{ id: string; lot_id: string; selected: boolean }>(sql`
      SELECT id::VARCHAR AS id, lot_id::VARCHAR AS lot_id, selected
      FROM tasting.blind_pick
      WHERE session_id = CAST(${sessionId} AS UUID)
    `);
    for (const pick of picks) {
      const lotId = asId(pick.lot_id);
      const selected = chosen.has(lotId);
      if (Boolean(pick.selected) === selected) continue;
      tx.write(sql`
        UPDATE tasting.blind_pick SET selected = ${selected} WHERE id = CAST(${asId(pick.id)} AS UUID)
      `);
      tx.audit({
        table: 'tasting.blind_pick',
        rowId: asId(pick.id),
        action: 'UPDATE',
        before: { selected: Boolean(pick.selected) },
        after: { selected, lot_id: lotId },
      });
    }
  });
  return getSelection(writer, sessionId);
}

async function withSelection(
  writer: Writer,
  sessionId: string,
  samples: readonly SampleRow[],
  votes: readonly VoteRow[],
): Promise<SessionAggregate[]> {
  const computed = aggregateSamples(samples.map((sample) => sample.sample_no), votes.map(voteFact));
  const picks = await writer.read<{ sample_no: unknown; selected: unknown }>(sql`
    SELECT s.sample_no, p.selected
    FROM tasting.blind_pick p
    JOIN tasting.blind_sample s ON s.id = p.sample_id
    WHERE p.session_id = CAST(${sessionId} AS UUID)
  `);
  const selected = new Map(picks.map((pick) => [asInt(pick.sample_no) ?? 0, Boolean(pick.selected)]));
  return computed.map((row) => {
    const sample = samples.find((item) => item.sample_no === row.sample_no);
    const flag = selected.get(row.sample_no);
    return {
      ...row,
      selected: flag ?? row.selected,
      lot_id: sample?.lot_id,
      lot_code: sample?.lot_code,
      vessel_id: sample?.vessel_id ?? null,
      vessel_code: sample?.vessel_code ?? null,
    };
  });
}

function presentSession(
  session: SessionRow,
  samples: readonly SampleRow[],
  votes: readonly VoteRow[],
  aggregate: SessionAggregate[] | null,
  viewer: SessionViewer | null,
): SessionView {
  const revealed = session.status === 'revealed';
  const organiser = viewer !== null && session.created_by.toLowerCase() === viewer.userId.toLowerCase();
  const visible = revealed
    ? votes
    : organiser
      ? []
      : votes.filter((vote) => ownsVote(vote, viewer));
  return {
    id: session.id,
    title: session.title,
    target: session.target,
    status: session.status,
    started_on: session.started_on,
    days: session.days,
    notes: session.notes,
    revealed,
    revealed_at: session.revealed_at,
    samples: samples.map((sample) => exposeSample(sample, revealed)),
    votes: visible.map(publicVote),
    progress: revealed || !organiser ? null : votes.map((vote) => ({
      taster_name: vote.taster_name,
      sample_no: vote.sample_no,
      day_no: vote.day_no,
    })),
    aggregate: revealed ? aggregate : null,
  };
}

function ownsVote(vote: VoteRow, viewer: SessionViewer | null): boolean {
  if (!viewer || !vote.taster_user_id) return false;
  return vote.taster_user_id === viewer.userId.toLowerCase();
}

function publicVote(vote: VoteRow): SessionVoteView {
  return {
    id: vote.id,
    sample_no: vote.sample_no,
    day_no: vote.day_no,
    taster_name: vote.taster_name,
    vote: vote.vote,
    score: vote.score,
    comment: vote.comment,
  };
}

function exposeSample(sample: SampleRow, revealed: boolean): PublicSample {
  if (!revealed) return { sample_no: sample.sample_no };
  return {
    sample_no: sample.sample_no,
    lot_id: sample.lot_id,
    lot_code: sample.lot_code,
    vessel_id: sample.vessel_id,
    vessel_code: sample.vessel_code,
  };
}

interface SessionRow {
  id: string;
  title: string;
  target: string;
  status: SessionStatus;
  started_on: string;
  days: number;
  notes: string | null;
  revealed_at: string | null;
  created_by: string;
}

async function loadSession(read: { read<T>(statement: string): Promise<T[]> }, id: string): Promise<SessionRow> {
  if (!isUuid(id)) invalid({ id: 'Debe ser un UUID' });
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, title, target, status, started_on, days, notes, revealed_at, created_by
    FROM tasting.blind_session
    WHERE id = CAST(${id} AS UUID)
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const status = asText(row.status);
  if (status !== 'open' && status !== 'revealed') throw domainError('WC_TASTING_CLOSED');
  return {
    id: asId(row.id),
    title: asText(row.title),
    target: asText(row.target),
    status,
    started_on: asDate(row.started_on),
    days: asInt(row.days) ?? 0,
    notes: row.notes == null ? null : asText(row.notes),
    revealed_at: row.revealed_at == null ? null : asInstant(row.revealed_at),
    created_by: asText(row.created_by),
  };
}

async function loadSamples(read: { read<T>(statement: string): Promise<T[]> }, sessionId: string): Promise<SampleRow[]> {
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT s.id::VARCHAR AS id, s.sample_no, s.lot_id::VARCHAR AS lot_id, s.vessel_id::VARCHAR AS vessel_id,
           l.code AS lot_code, v.code AS vessel_code
    FROM tasting.blind_sample s
    JOIN inventory.lot l ON l.id = s.lot_id
    LEFT JOIN cellar.vessel v ON v.id = s.vessel_id
    WHERE s.session_id = CAST(${sessionId} AS UUID)
    ORDER BY s.sample_no
  `);
  return rows.map((row) => ({
    id: asId(row.id),
    sample_no: asInt(row.sample_no) ?? 0,
    lot_id: asId(row.lot_id),
    lot_code: asText(row.lot_code),
    vessel_id: row.vessel_id == null ? null : asId(row.vessel_id),
    vessel_code: row.vessel_code == null ? null : asText(row.vessel_code),
  }));
}

interface VoteRow extends SessionVoteView {
  taster_user_id: string | null;
}

async function loadVotes(read: { read<T>(statement: string): Promise<T[]> }, sessionId: string): Promise<VoteRow[]> {
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT v.id::VARCHAR AS id, s.sample_no, v.day_no, v.taster_user_id::VARCHAR AS taster_user_id,
           v.taster_name, v.vote, v.score, v.comment
    FROM tasting.blind_vote v
    JOIN tasting.blind_sample s ON s.id = v.sample_id
    WHERE v.session_id = CAST(${sessionId} AS UUID)
    ORDER BY s.sample_no, v.day_no, v.taster_name
  `);
  return rows.map((row) => {
    const vote = asText(row.vote);
    return {
      id: asId(row.id),
      sample_no: asInt(row.sample_no) ?? 0,
      day_no: asInt(row.day_no) ?? 0,
      taster_user_id: row.taster_user_id == null ? null : asId(row.taster_user_id),
      taster_name: asText(row.taster_name),
      vote: vote === 'no' ? 'no' : 'yes',
      score: asNumber(row.score),
      comment: row.comment == null ? null : asText(row.comment),
    };
  });
}

function voteFact(vote: VoteRow): { sample_no: number; day_no: number; taster_name: string; vote: 'yes' | 'no'; score: number | null } {
  return {
    sample_no: vote.sample_no,
    day_no: vote.day_no,
    taster_name: vote.taster_name,
    vote: vote.vote,
    score: vote.score,
  };
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 30) {
    invalid({ [field]: 'Debe ser un entero positivo' });
  }
  return value;
}

export type { DayBallot };
