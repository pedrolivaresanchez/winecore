import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, entityId } from '../cellar-api/fixtures';
import { templateSettings } from '../../src/core/enology/defaults';
import { sql } from '../../src/core/db/sql';
import type { SettingsView } from '../../src/core/enology/types';

function asSettings(body: Record<string, unknown>): SettingsView {
  return body as unknown as SettingsView;
}

describe('ajustes de enología', () => {
  it('siembra los supuestos como pendientes y no inventa tolerancias ni límites que faltan', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const response = await call(ctx, 'GET', `/v1/enology/settings?legal_entity_id=${po}`);
      expect(response.status).toBe(200);
      const view = asSettings(response.body);
      const template = templateSettings();
      expect(view.parameters).toEqual(template.parameters);
      expect(view.so2_limits).toEqual(template.so2_limits);
      expect(view.loss_tolerances).toEqual(template.loss_tolerances);
      expect(view.prohibited_practices).toEqual(template.prohibited_practices);
      expect(view.required_analysis).toEqual(template.required_analysis);
      expect(view.pending_confirmation).toContain('parameter:volatile_acidity_alert_g_l');
      expect(view.pending_confirmation).toContain('parameter:molecular_so2_tinto_mg_l');
      expect(view.pending_confirmation).toContain('loss:racking:wine');
      expect(view.so2_limits.find((row) => row.scope === 'legal' && row.wine_color === 'tinto')?.limit_mg_l).toBeNull();
      expect(view.loss_tolerances.every((row) => row.max_pct === null)).toBe(true);
      const volatile = view.parameters.find((row) => row.code === 'volatile_acidity_alert_g_l');
      expect(volatile).toMatchObject({ value: '0.6', status_label: 'pendiente de confirmar', basis: 'supuesto' });
    } finally {
      await ctx.close();
    }
  });

  it('el propietario confirma un umbral y queda en la auditoría; bodega no puede', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const cvpo = await entityId(ctx, 'CVPO');
      const denied = await call(ctx, 'PUT', '/v1/enology/settings', {
        legal_entity_id: po,
        parameters: [{ code: 'volatile_acidity_alert_g_l', value: '0.7', confirm: true }],
      }, 'bodega@winecore.test');
      expect(denied.status).toBe(403);

      const saved = await call(ctx, 'PUT', '/v1/enology/settings', {
        legal_entity_id: po,
        parameters: [{ code: 'volatile_acidity_alert_g_l', value: '0.7', confirm: true }],
        loss_tolerances: [{
          process: 'racking',
          product_state: 'wine',
          max_pct: '2.5',
          source_ref: 'Nota sintetica del asesor',
          confirm: true,
        }],
      });
      expect(saved.status).toBe(200);
      const view = asSettings(saved.body);
      expect(view.parameters.find((row) => row.code === 'volatile_acidity_alert_g_l')).toMatchObject({
        value: '0.7',
        status_label: 'confirmado',
        pending: false,
      });
      expect(view.pending_confirmation).not.toContain('parameter:volatile_acidity_alert_g_l');
      expect(view.loss_tolerances.find((row) => row.process === 'racking' && row.product_state === 'wine')).toMatchObject({
        max_pct: '2.5',
        status_label: 'confirmado',
        source_ref: 'Nota sintetica del asesor',
      });

      const again = asSettings((await call(ctx, 'GET', `/v1/enology/settings?legal_entity_id=${po}`)).body);
      expect(again.parameters.find((row) => row.code === 'volatile_acidity_alert_g_l')?.value).toBe('0.7');
      const retuned = await call(ctx, 'PUT', '/v1/enology/settings', {
        legal_entity_id: po,
        parameters: [{ code: 'volatile_acidity_alert_g_l', value: '0.65', confirm: true }],
      });
      expect(retuned.status).toBe(200);
      expect(asSettings(retuned.body).parameters.find((row) => row.code === 'volatile_acidity_alert_g_l')?.value).toBe('0.65');
      const other = asSettings((await call(ctx, 'GET', `/v1/enology/settings?legal_entity_id=${cvpo}`)).body);
      expect(other.parameters.find((row) => row.code === 'volatile_acidity_alert_g_l')?.value).toBe('0.6');

      const audit = await ctx.writer.read<{ before_data: unknown; after_data: unknown; action: string }>(sql`
        SELECT action, before_data, after_data
        FROM audit.audit_log
        WHERE table_name = 'enology.settings'
        ORDER BY id
      `);
      expect(audit).toHaveLength(2);
      expect(audit[0]?.action).toBe('UPDATE');
      expect(audit[1]?.action).toBe('UPDATE');
      expect(parameterValue(jsonRecord(audit[0]?.before_data), 'volatile_acidity_alert_g_l')).toBe('0.6');
      expect(parameterValue(jsonRecord(audit[0]?.after_data), 'volatile_acidity_alert_g_l')).toBe('0.7');
      expect(parameterValue(jsonRecord(audit[1]?.before_data), 'volatile_acidity_alert_g_l')).toBe('0.7');
      expect(parameterValue(jsonRecord(audit[1]?.after_data), 'volatile_acidity_alert_g_l')).toBe('0.65');

      const check = await call(ctx, 'POST', '/v1/enology/checks', {
        legal_entity_id: po,
        as_of: '2026-04-15',
        operation: {
          op_type: 'racking',
          product_state: 'wine',
          input_volume_ml: '100000',
          loss_volume_ml: '5000',
        },
      }, 'bodega@winecore.test');
      expect(check.status).toBe(200);
      const findings = check.body.findings as { code: string; requires_reason: boolean }[];
      expect(findings.some((item) => item.code === 'WC_ENOLOGY_LOSS' && item.requires_reason)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('persiste confirm:false y guarda la merma máxima con la fuente pendiente', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const confirmed = await call(ctx, 'PUT', '/v1/enology/settings', {
        legal_entity_id: po,
        parameters: [{ code: 'volatile_acidity_alert_g_l', value: '0.7', confirm: true }],
      });
      expect(confirmed.status).toBe(200);
      const off = await call(ctx, 'PUT', '/v1/enology/settings', {
        legal_entity_id: po,
        parameters: [{ code: 'volatile_acidity_alert_g_l', confirm: false }],
      });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      expect(asSettings(off.body).parameters.find((row) => row.code === 'volatile_acidity_alert_g_l')).toMatchObject({
        value: '0.7',
        pending: true,
        status_label: 'pendiente de confirmar',
      });

      const loss = await call(ctx, 'PUT', '/v1/enology/settings', {
        legal_entity_id: po,
        loss_tolerances: [{ process: 'filtration', product_state: 'wine', max_pct: '1.5' }],
      });
      expect(loss.status, JSON.stringify(loss.body)).toBe(200);
      const warnings = loss.body.warnings as { code: string; severity: string }[];
      expect(warnings).toEqual([expect.objectContaining({
        code: 'ENOLOGY_LOSS_SOURCE_PENDING',
        severity: 'warning',
      })]);
      expect(asSettings(loss.body).loss_tolerances.find((row) => row.process === 'filtration' && row.product_state === 'wine')).toMatchObject({
        max_pct: '1.5',
        pending: true,
      });
    } finally {
      await ctx.close();
    }
  });
});

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function parameterValue(view: Record<string, unknown>, code: string): string | null {
  const rows = view.parameters as { code: string; value: string | null }[];
  return rows.find((row) => row.code === code)?.value ?? null;
}
