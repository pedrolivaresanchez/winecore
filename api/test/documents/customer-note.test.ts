import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { isCustomerGiftLine, printableLot, printableStatus, splitStoredNote } from '../../src/core/documents/customer-note';

const INTERNAL = 'Venta a tarifa distribuidor. Origen Almacén TFRP, condicionado a los traspasos en borrador del 17/11/2026 (Chemic y, si Pedro lo aprueba, Bobal 2024 de Bodega a TFRP). Sustituye el borrador anterior 01a1e629-3f4d-79eb-848b-445c7cec883e (origen Bodega), que no se ha anulado. No incluye la devolución de 84 botellas en depósito (42 Piroclástica, 18 Código de Parras, 24 Molinera), pendiente de decidir transportista (Nacex o TFRP).';
const GIFT = 'Obsequio Pack Navidad 2026 (PACK-NAV-2026)';

describe('notas que ya existían', () => {
  it('deja interno el párrafo operativo y conserva el obsequio para el cliente', () => {
    expect(splitStoredNote(INTERNAL)).toEqual({ internal: INTERNAL, customer: null });
    expect(splitStoredNote(GIFT)).toEqual({ internal: null, customer: GIFT });
    expect(splitStoredNote(`${GIFT}\n${INTERNAL}`)).toEqual({ internal: INTERNAL, customer: GIFT });
    expect(splitStoredNote('Entregar por la mañana')).toEqual({ internal: 'Entregar por la mañana', customer: null });
    expect(splitStoredNote('Cortesía de la bodega')).toEqual({ internal: null, customer: 'Cortesía de la bodega' });
    expect(splitStoredNote('Obsequio condicionado al traspaso')).toEqual({
      internal: 'Obsequio condicionado al traspaso',
      customer: null,
    });
    expect(isCustomerGiftLine(GIFT)).toBe(true);
    expect(splitStoredNote('{"source_delivery_note_id":"abc","user_notes":"Obsequio Pack"}')).toEqual({
      internal: '{"source_delivery_note_id":"abc","user_notes":"Obsequio Pack"}',
      customer: null,
    });
  });

  it('no imprime un lote vacío ni el estado de cobro en un documento con número', () => {
    expect(printableLot('Sin lote')).toBeNull();
    expect(printableLot('L25T01B1')).toBe('L25T01B1');
    expect(printableStatus('Borrador', true)).toBe('');
    expect(printableStatus('Borrador', false)).toBe('Borrador');
    expect(printableStatus('Pagado', true)).toBe('');
    expect(printableStatus('Pendiente', true)).toBe('');
    expect(printableStatus('Emitido', true)).toBe('Emitido');
  });

  it('la migración SQL clasifica igual que la aplicación', async () => {
    const migration = readFileSync(new URL('../../db/migrations/0055_document_notes.sql', import.meta.url), 'utf8');
    const macros = migration.split('-- split-macros')[1]?.split('-- end-split-macros')[0] ?? '';
    expect(macros).toContain('gift_line');
    const samples = [
      INTERNAL,
      GIFT,
      `${GIFT}\nVenta a tarifa distribuidor.`,
      '{"source_delivery_note_id":"abc","user_notes":"Obsequio Pack"}',
      'Entregar por la mañana',
      'Cortesía de la bodega',
      'Obsequio botella\nRegalo caja',
      'Obsequio condicionado al traspaso',
    ];
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    await conn.run(`CREATE TABLE t(id INTEGER, notes VARCHAR, customer_note VARCHAR);\n${macros}`);
    for (let index = 0; index < samples.length; index += 1) {
      const note = samples[index];
      if (note === undefined) continue;
      await conn.run('INSERT INTO t VALUES (?, ?, NULL)', [index, note]);
    }
    await conn.run(`
      UPDATE t SET customer_note = customer_note_of(notes), notes = internal_note_of(notes)
      WHERE notes IS NOT NULL AND NOT starts_with(trim(notes), '{') AND customer_note_of(notes) IS NOT NULL
    `);
    const rows = await conn.runAndReadAll('SELECT id, notes, customer_note FROM t ORDER BY id');
    const got = rows.getRowObjectsJson() as { id: number; notes: string | null; customer_note: string | null }[];
    for (const row of got) {
      const source = samples[row.id];
      if (source === undefined) throw new Error(`falta la muestra ${row.id}`);
      const expected = splitStoredNote(source);
      expect(row.notes).toBe(expected.internal);
      expect(row.customer_note).toBe(expected.customer);
    }
  });
});
