import { fold, isWineout, type BottledLine } from './bottled-snapshot';

export type WineRef = { id: string; code: string; name: string; color: string; organic: boolean };
export type LotRef = { id: string; code: string; wineId: string | null };
export type ProductRef = {
  id: string;
  name: string;
  wineId: string | null;
  vintage: number | null;
  nominalMl: number | null;
  kind: string;
  lotCode?: string | null;
};

export type LineMatch = {
  wineId: string | null;
  productId: string | null;
  lotId: string | null;
  status: 'matched' | 'unmatched' | 'empty' | 'note_only';
  note: string | null;
  notForSale: boolean;
};

const COLOR: Record<string, string> = {
  red: 'tinto',
  white: 'blanco',
  rose: 'rosado',
  orange: 'otro',
  sweet: 'otro',
  sparkling: 'otro',
  other: 'otro',
};

function words(value: string): string[] {
  return fold(value).split(' ').filter((word) => word.length > 0);
}

function hasPhrase(label: string, name: string): boolean {
  const haystack = ` ${words(label).join(' ')} `;
  const needle = words(name).join(' ');
  return needle.length >= 4 && haystack.includes(` ${needle} `);
}

function yearsOf(label: string): number[] {
  return [...label.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
}

function foldCode(code: string): string {
  return code.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, '');
}

export function matchWine(label: string, wines: readonly WineRef[]): { wine: WineRef | null; ambiguous: string[] } {
  const folded = fold(label);
  if (folded.length < 4) return { wine: null, ambiguous: [] };
  const exact = wines.filter((wine) => fold(wine.name) === folded || fold(wine.code) === folded.replace(/ /g, ''));
  if (exact.length === 1) return { wine: exact[0] ?? null, ambiguous: [] };
  if (exact.length > 1) return { wine: null, ambiguous: exact.map((wine) => wine.code) };
  const contained = wines.filter((wine) => hasPhrase(label, wine.name) || hasPhrase(label, wine.code));
  if (contained.length === 1) return { wine: contained[0] ?? null, ambiguous: [] };
  if (contained.length > 1) {
    const ranked = [...contained].sort((left, right) => fold(right.name).length - fold(left.name).length);
    const top = ranked[0];
    const next = ranked[1];
    if (top && next && fold(top.name).length > fold(next.name).length) return { wine: top, ambiguous: [] };
    return { wine: null, ambiguous: contained.map((wine) => wine.code) };
  }
  return { wine: null, ambiguous: [] };
}

export function matchLot(code: string | null, lots: readonly LotRef[]): { lot: LotRef | null; ambiguous: boolean } {
  if (!code || code === '0') return { lot: null, ambiguous: false };
  const key = foldCode(code);
  const hits = lots.filter((lot) => foldCode(lot.code) === key);
  if (hits.length === 1) return { lot: hits[0] ?? null, ambiguous: false };
  return { lot: null, ambiguous: hits.length > 1 };
}

const SHARED_LOT = new Set(['LAB2025', 'LAT2025']);

function sameLot(product: ProductRef, lotCode: string | null): boolean {
  return Boolean(lotCode && product.lotCode && foldCode(product.lotCode) === foldCode(lotCode));
}

function pickNamed(label: string, candidates: readonly ProductRef[]): ProductRef | null {
  const exact = candidates.filter((product) => fold(product.name) === fold(label));
  if (exact.length === 1) return exact[0] ?? null;
  const contained = candidates
    .filter((product) => fold(product.name).length >= 4 && fold(label).includes(fold(product.name)))
    .sort((left, right) => fold(right.name).length - fold(left.name).length);
  const top = contained[0];
  const next = contained[1];
  if (top && (!next || fold(top.name).length > fold(next.name).length)) return top;
  return null;
}

export function matchProduct(
  label: string,
  wineId: string | null,
  bottleMl: number | null,
  products: readonly ProductRef[],
  lotCode: string | null = null,
): ProductRef | null {
  if (!bottleMl) return null;
  const sized = products.filter((product) => product.kind === 'wine' && product.nominalMl === bottleMl);
  const byLot = lotCode ? sized.filter((product) => sameLot(product, lotCode)) : [];
  if (byLot.length === 1) return byLot[0] ?? null;
  const named = pickNamed(label, byLot.length > 0 ? byLot : sized.filter((product) => wineId == null || product.wineId === wineId));
  if (named) return named;
  const candidates = sized.filter((product) => wineId != null && product.wineId === wineId);
  const years = yearsOf(label);
  if (years.length >= 1) {
    const vintage = candidates.filter((product) => product.vintage != null && years.includes(product.vintage));
    if (vintage.length === 1) return vintage[0] ?? null;
  }
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

export function matchBottledLine(line: BottledLine, wines: readonly WineRef[], lots: readonly LotRef[], products: readonly ProductRef[]): LineMatch {
  const notForSale = line.not_for_sale || isWineout(line.wine_label);
  if (line.bottles === 0) {
    return {
      wineId: null,
      productId: null,
      lotId: null,
      status: line.note || line.wine_label ? 'note_only' : 'empty',
      note: line.note,
      notForSale,
    };
  }
  const notes: string[] = [];
  const sheetLot = fold(line.wine_label) === 'bobal xpo' && !line.lot_code
    ? 'EB2025V'
    : isWineout(line.wine_label) && !line.lot_code
      ? 'WINEOUT'
      : line.lot_code;
  if (fold(line.wine_label) === 'bobal xpo') notes.push('La hoja dice bobal xpo. Pedro lo nombra Las Virginias, lote EB2025V.');
  if (line.note) notes.push(line.note);
  if (line.bottle_ml == null) notes.push('Los litros no cuadran con un formato entero');
  const wineHit = matchWine(line.wine_label, wines);
  if (wineHit.ambiguous.length > 1) notes.push(`Varios vinos: ${wineHit.ambiguous.join(', ')}`);
  const lotHit = matchLot(sheetLot, lots);
  if (lotHit.ambiguous) notes.push('Varios lotes con el mismo código');
  let wine = wineHit.wine;
  let lot = lotHit.lot;
  const sharedLot = Boolean(lot && SHARED_LOT.has(lot.code));
  if (wine && lot?.wineId && lot.wineId !== wine.id && !sharedLot) {
    notes.push('El lote pertenece a otro vino');
    wine = null;
    lot = null;
  }
  if (!wine && lot?.wineId) wine = wines.find((item) => item.id === lot?.wineId) ?? null;
  const product = matchProduct(line.wine_label, wine?.id ?? null, line.bottle_ml, products, sheetLot);
  if (!wine && product?.wineId) wine = wines.find((item) => item.id === product.wineId) ?? null;
  if (wine && line.color && COLOR[wine.color] && COLOR[wine.color] !== line.color) {
    notes.push(`El catálogo dice ${COLOR[wine.color]} y la hoja ${line.color}`);
  }
  const matched = Boolean(wine && product && lot && line.bottle_ml);
  if (!matched) {
    if (!wine) notes.push('Sin vino en el catálogo');
    if (!product) notes.push('Sin producto de esa añada y formato');
    if (!lot) notes.push(sheetLot ? `Sin lote ${sheetLot}` : 'La hoja no trae lote');
  }
  return {
    wineId: wine?.id ?? null,
    productId: product?.id ?? null,
    lotId: lot?.id ?? null,
    status: matched ? 'matched' : 'unmatched',
    note: notes.length > 0 ? notes.join('. ') : null,
    notForSale,
  };
}
