import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { findByCode, findLotByCode } from './refs';
import { asId, asInstant, asInt, asNumber, asText } from './rows';
import type { Subject } from './types';
import { invalid, optionalUuid } from './validate';

export interface EvolutionPoint {
  at: string;
  kind: 'tasting' | 'analysis';
  lot_id: string | null;
  lot_code: string | null;
  vintage: number | null;
  tasting?: {
    id: string;
    subject: Subject;
    taster_name: string;
    visual_score: number | null;
    nose_score: number | null;
    mouth_score: number | null;
    overall_score: number | null;
    defects: string[];
    decision: string | null;
  };
  analysis?: {
    id: string;
    analysis_kind: string;
    lab: string;
    results: { code: string; name: string; value: number; unit: string }[];
  };
}

export interface EvolutionView {
  scope:
    | { kind: 'lot'; lot_id: string; lot_code: string; vintage: number | null; wine_id: string | null; wine_code: string | null }
    | { kind: 'wine'; wine_id: string; wine_code: string; wine_name: string; vintages: number[] };
  points: EvolutionPoint[];
}

export async function getEvolution(writer: Writer, request: Request): Promise<EvolutionView> {
  const url = new URL(request.url);
  const lotId = optionalUuid(url.searchParams.get('lot_id'), 'lot_id');
  const wineIdParam = optionalUuid(url.searchParams.get('wine_id'), 'wine_id');
  const lotCode = url.searchParams.get('lot_code');
  const wineCode = url.searchParams.get('wine_code');
  const hasLot = lotId != null || (lotCode != null && lotCode.trim() !== '');
  const hasWine = wineIdParam != null || (wineCode != null && wineCode.trim() !== '');
  if (hasLot === hasWine) invalid({ scope: 'Indica un lote o un vino, no los dos' });
  if (hasLot) {
    const lot = lotId
      ? await lotById(writer, lotId)
      : await findLotByCode(writer, (lotCode ?? '').trim().toUpperCase());
    if (!lot) throw domainError('WC_NOT_FOUND');
    const wine = lot.wine_id ? await wineById(writer, lot.wine_id) : null;
    const points = await timeline(writer, { lotId: lot.id, wineId: null });
    return {
      scope: {
        kind: 'lot',
        lot_id: lot.id,
        lot_code: lot.code,
        vintage: lot.vintage,
        wine_id: lot.wine_id,
        wine_code: wine?.code ?? null,
      },
      points,
    };
  }
  const wine = wineIdParam
    ? await wineById(writer, wineIdParam)
    : await wineByCode(writer, (wineCode ?? '').trim().toUpperCase());
  if (!wine) throw domainError('WC_NOT_FOUND');
  const points = await timeline(writer, { lotId: null, wineId: wine.id });
  const vintages = [...new Set(points.map((point) => point.vintage).filter((vintage): vintage is number => vintage != null))].sort();
  return {
    scope: { kind: 'wine', wine_id: wine.id, wine_code: wine.code, wine_name: wine.name, vintages },
    points,
  };
}

async function timeline(writer: Writer, scope: { lotId: string | null; wineId: string | null }): Promise<EvolutionPoint[]> {
  const tastings = await tastingPoints(writer, scope);
  const analyses = await analysisPoints(writer, scope);
  return [...tastings, ...analyses].sort((a, b) => {
    const byTime = a.at.localeCompare(b.at);
    if (byTime !== 0) return byTime;
    if (a.kind !== b.kind) return a.kind === 'analysis' ? -1 : 1;
    const aId = a.tasting?.id ?? a.analysis?.id ?? '';
    const bId = b.tasting?.id ?? b.analysis?.id ?? '';
    return aId.localeCompare(bId);
  });
}

async function tastingPoints(writer: Writer, scope: { lotId: string | null; wineId: string | null }): Promise<EvolutionPoint[]> {
  const where = scope.lotId
    ? sql`n.lot_id = CAST(${scope.lotId} AS UUID)`
    : sql`(
        n.wine_id = CAST(${scope.wineId} AS UUID)
        OR n.lot_id IN (SELECT id FROM inventory.lot WHERE wine_id = CAST(${scope.wineId} AS UUID))
        OR n.product_id IN (SELECT id FROM catalog.product WHERE wine_id = CAST(${scope.wineId} AS UUID))
      )`;
  const rows = await writer.read<Record<string, unknown>>(
    `SELECT n.id::VARCHAR AS id, n.tasted_at, n.subject, n.taster_name,
            n.visual_score, n.nose_score, n.mouth_score, n.overall_score,
            n.defects, n.decision, n.lot_id::VARCHAR AS lot_id, n.vintage,
            l.code AS lot_code, l.vintage AS lot_vintage
     FROM tasting.note n
     LEFT JOIN inventory.lot l ON l.id = n.lot_id
     WHERE ${where}
     ORDER BY n.tasted_at, n.id`,
  );
  return rows.map((row) => {
    const subject = asText(row.subject);
    return {
      at: asInstant(row.tasted_at),
      kind: 'tasting' as const,
      lot_id: row.lot_id == null ? null : asId(row.lot_id),
      lot_code: row.lot_code == null ? null : asText(row.lot_code),
      vintage: asInt(row.vintage) ?? asInt(row.lot_vintage),
      tasting: {
        id: asId(row.id),
        subject: isSubject(subject) ? subject : 'wine_aging',
        taster_name: asText(row.taster_name),
        visual_score: asNumber(row.visual_score),
        nose_score: asNumber(row.nose_score),
        mouth_score: asNumber(row.mouth_score),
        overall_score: asNumber(row.overall_score),
        defects: defectsOf(row.defects),
        decision: row.decision == null ? null : asText(row.decision),
      },
    };
  });
}

async function analysisPoints(writer: Writer, scope: { lotId: string | null; wineId: string | null }): Promise<EvolutionPoint[]> {
  const where = scope.lotId
    ? sql`a.lot_id = CAST(${scope.lotId} AS UUID)`
    : sql`a.lot_id IN (SELECT id FROM inventory.lot WHERE wine_id = CAST(${scope.wineId} AS UUID))`;
  const rows = await writer.read<Record<string, unknown>>(
    `SELECT a.id::VARCHAR AS id, a.sampled_at, a.kind, a.lab, a.lot_id::VARCHAR AS lot_id,
            l.code AS lot_code, l.vintage,
            r.parameter_code, r.value, p.name_es, p.unit
     FROM cellar.analysis a
     LEFT JOIN inventory.lot l ON l.id = a.lot_id
     LEFT JOIN cellar.analysis_result r ON r.analysis_id = a.id
     LEFT JOIN cellar.analysis_parameter p ON p.code = r.parameter_code
     WHERE ${where}
     ORDER BY a.sampled_at, a.id, r.parameter_code`,
  );
  const grouped = new Map<string, EvolutionPoint>();
  for (const row of rows) {
    const id = asId(row.id);
    let point = grouped.get(id);
    if (!point) {
      point = {
        at: asInstant(row.sampled_at),
        kind: 'analysis',
        lot_id: row.lot_id == null ? null : asId(row.lot_id),
        lot_code: row.lot_code == null ? null : asText(row.lot_code),
        vintage: asInt(row.vintage),
        analysis: {
          id,
          analysis_kind: asText(row.kind),
          lab: asText(row.lab),
          results: [],
        },
      };
      grouped.set(id, point);
    }
    if (row.parameter_code != null && point.analysis) {
      point.analysis.results.push({
        code: asText(row.parameter_code),
        name: asText(row.name_es),
        value: asNumber(row.value) ?? 0,
        unit: asText(row.unit),
      });
    }
  }
  return [...grouped.values()];
}

async function lotById(writer: Writer, id: string): Promise<{ id: string; code: string; wine_id: string | null; vintage: number | null } | null> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, wine_id::VARCHAR AS wine_id, vintage
    FROM inventory.lot WHERE id = CAST(${id} AS UUID) LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: asId(row.id),
    code: asText(row.code),
    wine_id: row.wine_id == null ? null : asId(row.wine_id),
    vintage: asInt(row.vintage),
  };
}

async function wineById(writer: Writer, id: string): Promise<{ id: string; code: string; name: string } | null> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name FROM catalog.wine WHERE id = CAST(${id} AS UUID) LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return { id: asId(row.id), code: asText(row.code), name: asText(row.name) };
}

async function wineByCode(writer: Writer, code: string): Promise<{ id: string; code: string; name: string } | null> {
  const id = await findByCode(writer, 'catalog.wine', code, 'wine_code');
  if (!id) return null;
  return wineById(writer, id);
}

function defectsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isSubject(value: string): value is Subject {
  return value === 'grape' || value === 'must' || value === 'wine_aging' || value === 'blend_candidate' || value === 'bottle';
}
