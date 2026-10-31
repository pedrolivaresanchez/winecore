import { invalid } from '../cellar/service/http';
import type {
  FermentationEndRequest,
  FermentationPhaseName,
  FermentationStartRequest,
  FermentationVolumeLine,
  LossKind,
  LotRef,
  OperationHeader,
  PressingLine,
  PressingRequest,
} from '../cellar/types';

export interface PlainLine {
  role: string;
  lot_id: string | null;
  vessel_id: string | null;
  location_id: string | null;
  product_state: string;
  volume_ml: number;
  mass_g: number;
  loss_kind: LossKind | null;
}

type Common = Omit<OperationHeader, never>;

export function pressingRequest(
  common: Common,
  lines: readonly PlainLine[],
  lots: ReadonlyMap<string, LotRef>,
): PressingRequest {
  const engine: PressingLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const field = `lines[${index}]`;
    const lot = lotOf(lots, line.lot_id, `${field}.lot_id`);
    if (line.role === 'input') {
      if (line.product_state !== 'grape' && line.product_state !== 'must') {
        invalid({ [`${field}.product_state`]: 'La entrada es uva o mosto' });
      }
      engine.push({
        role: 'input',
        lot,
        vessel_id: line.vessel_id,
        location_id: line.location_id ?? '',
        product_state: line.product_state,
        mass_g: line.mass_g,
        volume_ml: line.volume_ml,
      });
      continue;
    }
    if (line.role === 'output') {
      if (!line.vessel_id) invalid({ [`${field}.vessel_id`]: 'Falta el recipiente' });
      engine.push({
        role: 'output',
        lot,
        vessel_id: line.vessel_id,
        volume_ml: line.volume_ml,
        product_state: 'must',
      });
      continue;
    }
    if (line.role === 'loss' && line.mass_g > 0 && line.volume_ml === 0) {
      engine.push({
        role: 'pomace',
        lot,
        location_id: line.location_id ?? '',
        mass_g: line.mass_g,
      });
      continue;
    }
    if (line.role === 'loss') {
      if (!line.vessel_id) invalid({ [`${field}.vessel_id`]: 'Falta el recipiente de la merma' });
      if (line.loss_kind !== 'authorized' && line.loss_kind !== 'incident') {
        invalid({ [`${field}.loss_kind`]: 'La merma necesita un tipo' });
      }
      engine.push({
        role: 'loss',
        lot,
        vessel_id: line.vessel_id,
        volume_ml: line.volume_ml,
        loss_kind: line.loss_kind,
        product_state: 'must',
      });
      continue;
    }
    invalid({ [`${field}.role`]: 'La línea de prensado no es válida' });
  }
  return { ...common, op_type: 'crushing_pressing', lines: engine };
}

export function fermentationStartRequest(
  common: Common,
  op: 'fermentation_start' | 'malolactic_start',
  vesselId: string,
  lot: LotRef,
  phase: FermentationPhaseName | null,
): FermentationStartRequest {
  return { ...common, op_type: op, vessel_id: vesselId, lot, current_phase: phase };
}

export function fermentationEndRequest(
  common: Common,
  op: 'fermentation_end' | 'malolactic_end',
  lines: readonly PlainLine[],
  lots: ReadonlyMap<string, LotRef>,
  phase: FermentationPhaseName | null,
  abv: string | null,
  excise: string | null,
): FermentationEndRequest {
  const expectedIn = op === 'fermentation_end' ? 'must' : 'wine';
  const engine: FermentationVolumeLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const field = `lines[${index}]`;
    if (!line.vessel_id) invalid({ [`${field}.vessel_id`]: 'Falta el recipiente' });
    const lot = withExcise(lotOf(lots, line.lot_id, `${field}.lot_id`), excise, abv);
    if (line.role !== 'input' && line.role !== 'output' && line.role !== 'loss') {
      invalid({ [`${field}.role`]: 'La línea de fermentación no es válida' });
    }
    const state = line.role === 'output' ? 'wine' : expectedIn;
    if (line.product_state !== state) {
      invalid({ [`${field}.product_state`]: line.role === 'output' ? 'La salida es vino' : 'El estado de entrada no coincide' });
    }
    engine.push({
      role: line.role,
      lot,
      vessel_id: line.vessel_id,
      volume_ml: line.volume_ml,
      product_state: state,
      loss_kind: line.role === 'loss' ? line.loss_kind : null,
    });
  }
  return { ...common, op_type: op, lines: engine, current_phase: phase, abv_pct: abv };
}

function lotOf(lots: ReadonlyMap<string, LotRef>, id: string | null, field: string): LotRef {
  if (!id) invalid({ [field]: 'Falta el lote' });
  const lot = lots.get(id);
  if (!lot) invalid({ [field]: 'El lote no existe' });
  return lot;
}

function withExcise(lot: LotRef, excise: string | null, abv: string | null): LotRef {
  if (!excise && !abv) return lot;
  return {
    ...lot,
    excise_product_key: excise ?? lot.excise_product_key,
    abv_pct: abv ?? lot.abv_pct,
  };
}
