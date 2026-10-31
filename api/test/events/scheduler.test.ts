import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { createWriter } from '../../src/core/db/writer';
import { OUTBOX_INTERVAL_MS, OUTBOX_JOB_ID, registerOutboxDispatch } from '../../src/jobs/outbox';
import { createScheduler } from '../../src/jobs/scheduler';

describe('scheduler', () => {
  it('solo corre en el líder y no solapa el mismo job', async () => {
    let leader = false;
    let calls = 0;
    const lines: string[] = [];
    const scheduler = createScheduler({
      isLeader: () => leader,
      log: (line) => lines.push(line),
    });
    scheduler.register('job', 30_000, async () => {
      calls += 1;
    });
    expect(await scheduler.run('job')).toBe('not_leader');
    expect(calls).toBe(0);
    leader = true;

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = createScheduler({ isLeader: async () => true, log: () => undefined });
    let started = 0;
    slow.register('lento', 30_000, async () => {
      started += 1;
      await gate;
    });
    const first = slow.run('lento');
    const second = await slow.run('lento');
    expect(second).toBe('overlap');
    expect(started).toBe(1);
    release();
    expect(await first).toBe('ran');
    expect(started).toBe(1);

    expect(await scheduler.run('job')).toBe('ran');
    expect(calls).toBe(1);
    expect(lines.some((line) => line.includes('not_leader'))).toBe(true);
    for (const line of lines) {
      expect(line.includes('\n')).toBe(false);
      expect(JSON.parse(line)).toBeTruthy();
    }
  });

  it('no arranca el job de una instancia sin arrendamiento', async () => {
    const ctx = await createTestApp();
    try {
      const standby = createWriter(ctx.client);
      let calls = 0;
      const follower = createScheduler({
        isLeader: async () => (await standby.currentRole()) === 'leader',
        log: () => undefined,
      });
      follower.register('probe', 30_000, async () => {
        calls += 1;
      });
      expect(await follower.run('probe')).toBe('not_leader');
      expect(calls).toBe(0);

      const leader = createScheduler({
        isLeader: async () => (await ctx.writer.currentRole()) === 'leader',
        log: () => undefined,
      });
      leader.register('probe', 30_000, async () => {
        calls += 1;
      });
      expect(await leader.run('probe')).toBe('ran');
      expect(calls).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('programa el outbox cada 30 s y no escribe secretos si el job falla', async () => {
    const ctx = await createTestApp();
    const secret = 'super-secret-hmac-value';
    const lines: string[] = [];
    const timers: { ms: number; fn: () => void }[] = [];
    let cleared = 0;
    try {
      const scheduler = createScheduler({
        isLeader: () => true,
        log: (line) => lines.push(line),
        timer: {
          set(fn, ms) {
            timers.push({ ms, fn });
            return { id: timers.length };
          },
          clear() {
            cleared += 1;
          },
        },
      });
      registerOutboxDispatch(scheduler, { writer: ctx.writer, config: ctx.config });
      scheduler.register('falla', 30_000, async () => {
        throw new Error(`fallo ${secret}`);
      });
      scheduler.start();
      expect(timers.map((timer) => timer.ms)).toEqual([OUTBOX_INTERVAL_MS, 30_000]);
      expect(timers[0]?.ms).toBe(30_000);
      expect(lines.some((line) => line.includes(OUTBOX_JOB_ID))).toBe(true);
      expect(await scheduler.run('falla')).toBe('error');
      const text = lines.join('\n');
      expect(text).not.toContain(secret);
      expect(text).not.toContain('CVBOT_EVENTS_HMAC_KEY');
      scheduler.stop();
      expect(cleared).toBe(2);
    } finally {
      await ctx.close();
    }
  });
});
