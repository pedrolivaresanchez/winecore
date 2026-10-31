import { describe, expect, it } from 'bun:test';
import { addCalendarDays, todayMadrid } from '../../src/core/finance/support';
import { bodyOf, financeApp, insertContact, insertInvoice, insertOpenItem, world } from './fixture';

describe('pendientes y vencidos', () => {
  it('agrupa por cliente, etiqueta Holded y corta en 30, 60 y 90 días', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Antigüedad SL', customer: true });
      const other = await insertContact(ctx.writer, ids.ownerId, { name: 'Otra Bodega SL', customer: true });
      const cases = [
        ['due-hoy', 0, '10.00'],
        ['due-30', -30, '11.00'],
        ['due-31', -31, '12.00'],
        ['due-60', -60, '13.00'],
        ['due-61', -61, '14.00'],
        ['due-90', -90, '15.00'],
        ['due-91', -91, '16.00'],
      ] as const;
      for (const [number, shift, total] of cases) {
        await insertInvoice(ctx.writer, ids.ownerId, {
          entityId: ids.po.id,
          customerId: customer,
          total,
          dueDate: addCalendarDays(today, shift),
          issueDate: addCalendarDays(today, shift - 10),
          number,
        });
      }
      await insertOpenItem(ctx.writer, ids.ownerId, {
        entityId: ids.po.id,
        contactId: customer,
        amount: '7.00',
        dueDate: addCalendarDays(today, -91),
        number: 'H-ANTIGUA',
      });
      await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.cvpo.id, customerId: other, total: '99.00', dueDate: today, number: 'CV-0001',
      });

      const page = await bodyOf(await ctx.app.handle(new Request(`http://localhost/v1/receivables?entity=PO&contact_id=${customer}`)));
      expect(page.as_of).toBe(today);
      const groups = page.groups as Array<{ customer_name: string; amounts: Record<string, string>; items: Array<Record<string, unknown>> }>;
      expect(groups).toHaveLength(1);
      expect(groups[0]?.customer_name).toBe('Cliente Antigüedad SL');
      expect(groups[0]?.amounts).toMatchObject({
        '0-30': '21.00',
        '31-60': '25.00',
        '61-90': '29.00',
        '>90': '23.00',
        total: '98.00',
      });
      const holded = groups[0]?.items.find((item) => item.document_number === 'H-ANTIGUA');
      expect(holded).toMatchObject({ source_label: 'Holded', origin: 'holded', aging: '>90', is_overdue: true });
      const dueToday = groups[0]?.items.find((item) => item.document_number === 'due-hoy');
      expect(dueToday).toMatchObject({ aging: '0-30', is_overdue: false });
      const due30 = groups[0]?.items.find((item) => item.document_number === 'due-30');
      expect(due30).toMatchObject({ aging: '0-30', is_overdue: true, days: 30 });
      const due31 = groups[0]?.items.find((item) => item.document_number === 'due-31');
      expect(due31).toMatchObject({ aging: '31-60', days: 31 });
      const due90 = groups[0]?.items.find((item) => item.document_number === 'due-90');
      expect(due90).toMatchObject({ aging: '61-90', days: 90 });

      const bucket = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/receivables?entity=PO&aging=31-60')));
      const only = (bucket.groups as Array<{ items: Array<{ aging: string }> }>)[0]?.items ?? [];
      expect(only.length).toBeGreaterThan(0);
      expect(only.every((item) => item.aging === '31-60')).toBe(true);

      const advisor = await ctx.app.handle(new Request('http://localhost/v1/receivables', {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(advisor.status).toBe(200);
      const cellar = await ctx.app.handle(new Request('http://localhost/v1/receivables', {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(cellar.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
