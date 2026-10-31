import { describe, expect, it } from 'bun:test';
import { checkOperation, type CheckOperationInput } from '../../src/core/enology/checks';
import { templateSettings } from '../../src/core/enology/defaults';
import type { SettingsView } from '../../src/core/enology/types';

const REQUIRED = ['abv', 'total_acidity', 'volatile_acidity', 'ph', 'free_so2', 'total_so2', 'glucose_fructose'];

function input(patch: {
  as_of?: string;
  operation?: Partial<CheckOperationInput['operation']>;
  lot?: Partial<CheckOperationInput['lot']>;
  settings?: SettingsView;
} = {}): CheckOperationInput {
  return {
    as_of: patch.as_of ?? '2026-04-15',
    operation: {
      op_type: 'racking',
      process: null,
      product_state: 'wine',
      input_volume_ml: '100000',
      loss_volume_ml: '0',
      reason: null,
      additions: [],
      practices: [],
      ...patch.operation,
    },
    lot: {
      kind: null,
      has_volume: false,
      racked_this_winter: false,
      malolactic_finished: null,
      malic_acid_g_l: null,
      volatile_acidity_g_l: null,
      analyses: [],
      ...patch.lot,
    },
    settings: patch.settings ?? templateSettings(),
  };
}

function codes(result: ReturnType<typeof checkOperation>): string[] {
  return result.findings.map((row) => row.code);
}

function withRackingTolerance(max: string | null): SettingsView {
  const settings = templateSettings();
  const row = settings.loss_tolerances.find((item) => item.process === 'racking' && item.product_state === 'wine');
  if (!row) throw new Error('falta la tolerancia');
  row.max_pct = max;
  row.pending = max === null;
  row.basis = max === null ? 'pendiente' : 'supuesto';
  row.status_label = max === null ? 'pendiente de confirmar' : 'confirmado';
  return settings;
}

describe('comprobaciones de enología', () => {
  it('avisa la merma por encima de la tolerancia y exige motivo', () => {
    const settings = withRackingTolerance('2');
    const under = checkOperation(input({
      settings,
      operation: { loss_volume_ml: '1000' },
    }));
    expect(codes(under)).not.toContain('WC_ENOLOGY_LOSS');

    const over = checkOperation(input({
      settings,
      operation: { loss_volume_ml: '5000' },
    }));
    const finding = over.findings.find((row) => row.code === 'WC_ENOLOGY_LOSS');
    expect(finding?.severity).toBe('warning');
    expect(finding?.requires_reason).toBe(true);
    expect(finding?.reason_satisfied).toBe(false);
    expect(finding?.blocks).toBe(false);
    expect(over.ok).toBe(true);

    const justified = checkOperation(input({
      settings,
      operation: { loss_volume_ml: '5000', reason: 'lías del trasiego' },
    }));
    expect(justified.findings.find((row) => row.code === 'WC_ENOLOGY_LOSS')?.reason_satisfied).toBe(true);
  });

  it('no inventa un porcentaje si la tolerancia está vacía', () => {
    const result = checkOperation(input({ operation: { loss_volume_ml: '50000' } }));
    const finding = result.findings.find((row) => row.code === 'ENO_LOSS_TOLERANCE_PENDING');
    expect(finding?.severity).toBe('info');
    expect(finding?.message).toContain('pendiente');
    expect(codes(result)).not.toContain('WC_ENOLOGY_LOSS');
  });

  it('tras la maloláctica solo el SO2 pasa sin motivo', () => {
    const tartaric = checkOperation(input({
      lot: { malolactic_finished: true },
      operation: { op_type: 'addition', additions: [{ name: 'ácido tartárico', purpose: 'acidification', is_so2: null }] },
    }));
    expect(codes(tartaric)).toContain('ENO_ADDITION_AFTER_MLF');
    expect(tartaric.findings.find((row) => row.code === 'ENO_ADDITION_AFTER_MLF')?.requires_reason).toBe(true);

    const sulfite = checkOperation(input({
      lot: { malic_acid_g_l: '0.3' },
      operation: { op_type: 'addition', additions: [{ name: 'Metabisulfito potásico', purpose: null, is_so2: null }] },
    }));
    expect(codes(sulfite)).not.toContain('ENO_ADDITION_AFTER_MLF');

    const open = checkOperation(input({
      lot: { malic_acid_g_l: '1.2' },
      operation: { additions: [{ name: 'ácido tartárico', purpose: null, is_so2: false }] },
    }));
    expect(codes(open)).not.toContain('ENO_ADDITION_AFTER_MLF');
  });

  it('bloquea los carbones activos', () => {
    const blocked = checkOperation(input({
      operation: { practices: ['carbón activo'] },
    }));
    expect(blocked.ok).toBe(false);
    const finding = blocked.findings.find((row) => row.code === 'WC_ENOLOGY_PROHIBITED');
    expect(finding?.severity).toBe('error');
    expect(finding?.blocks).toBe(true);
    expect(finding?.message).toContain('prohibido');

    const english = checkOperation(input({
      operation: { additions: [{ name: 'Activated carbon', purpose: null, is_so2: false }] },
    }));
    expect(english.ok).toBe(false);

    const settings = templateSettings();
    const practice = settings.prohibited_practices[0];
    if (!practice) throw new Error('falta la práctica');
    practice.active = false;
    const allowed = checkOperation(input({
      settings,
      operation: { practices: ['carbones activos'] },
    }));
    expect(allowed.ok).toBe(true);
  });

  it('avisa el embotellado sin analítica fresca y puede bloquear', () => {
    const missing = checkOperation(input({
      operation: { op_type: 'bottling' },
    }));
    const warning = missing.findings.find((row) => row.code === 'ENO_BOTTLING_ANALYSIS');
    expect(warning?.severity).toBe('warning');
    expect(warning?.blocks).toBe(false);
    expect(warning?.message).toContain('30 días');
    expect(warning?.message).toContain('pendiente de confirmar');

    const fresh = checkOperation(input({
      as_of: '2026-04-20',
      operation: { op_type: 'bottling' },
      lot: { analyses: [{ sampled_on: '2026-04-01', parameters: REQUIRED }] },
    }));
    expect(codes(fresh)).not.toContain('ENO_BOTTLING_ANALYSIS');

    const stale = checkOperation(input({
      as_of: '2026-06-15',
      operation: { op_type: 'bottling' },
      lot: { kind: null, has_volume: false, analyses: [{ sampled_on: '2026-04-01', parameters: REQUIRED }] },
    }));
    expect(codes(stale)).toContain('ENO_BOTTLING_ANALYSIS');

    const settings = templateSettings();
    const mode = settings.parameters.find((row) => row.code === 'bottling_analysis_mode');
    if (!mode) throw new Error('falta el modo');
    mode.value_text = 'block';
    const blocked = checkOperation(input({ settings, operation: { op_type: 'bottling' } }));
    expect(blocked.ok).toBe(false);
    expect(blocked.findings.find((row) => row.code === 'ENO_BOTTLING_ANALYSIS')?.severity).toBe('error');
  });

  it('avisa la acidez volátil en el umbral y no inventa el máximo legal', () => {
    const at = checkOperation(input({ lot: { volatile_acidity_g_l: '0.6' } }));
    const finding = at.findings.find((row) => row.code === 'ENO_VOLATILE_ACIDITY');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('V13');
    expect(finding?.message).toContain('no recoge un máximo legal');
    const below = checkOperation(input({ lot: { volatile_acidity_g_l: '0.59' } }));
    expect(codes(below)).not.toContain('ENO_VOLATILE_ACIDITY');
  });

  it('recuerda el trasiego de invierno y el embotellado después de la primavera', () => {
    const winter = checkOperation(input({
      as_of: '2026-02-15',
      lot: { kind: 'wine', has_volume: true, racked_this_winter: false },
    }));
    expect(codes(winter)).toContain('ENO_SEASONAL_RACKING');
    expect(codes(winter)).not.toContain('ENO_SEASONAL_BOTTLING');

    const racked = checkOperation(input({
      as_of: '2026-03-20',
      lot: { kind: 'wine', has_volume: true, racked_this_winter: true },
    }));
    expect(codes(racked)).not.toContain('ENO_SEASONAL_RACKING');

    const summer = checkOperation(input({
      as_of: '2026-07-01',
      lot: { kind: 'wine', has_volume: true },
    }));
    expect(codes(summer)).toContain('ENO_SEASONAL_BOTTLING');
    expect(summer.findings.find((row) => row.code === 'ENO_SEASONAL_BOTTLING')?.message).toContain('pendiente de confirmar');

    const bottled = checkOperation(input({
      as_of: '2026-07-01',
      lot: { kind: 'bottled', has_volume: true },
    }));
    expect(codes(bottled)).not.toContain('ENO_SEASONAL_BOTTLING');
  });
});
