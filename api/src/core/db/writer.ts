import { domainError, DomainError, mapDatabaseError } from '../errors';
import { newId } from '../ids';
import { auditInserts, verifyAuditChain as verifyChain, type AuditChainStatus, type AuditChange } from './audit';
import type { KbClient } from './client';
import { sql } from './sql';

export type Actor = {
  type: 'user' | 'agent' | 'system' | 'migration';
  id: string;
  onBehalfOf?: string;
  requestId: string;
  reason?: string;
};

export interface Tx {
  read<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  write(sql: string): void;
  audit(change: AuditChange): void;
}

export interface Writer {
  readonly instanceId: string;
  read<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  withWrite<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T>;
  tryAcquireLease(): Promise<boolean>;
  currentRole(): Promise<'leader' | 'standby'>;
  verifyAuditChain(): Promise<AuditChainStatus>;
  startMaintenance(): void;
  stopMaintenance(): void;
}

export interface WriterOptions {
  instanceId?: string;
  log?: (line: string) => void;
}

const ACTOR_TYPES = new Set<Actor['type']>(['user', 'agent', 'system', 'migration']);

function assertActor(actor: Actor): void {
  if (!ACTOR_TYPES.has(actor.type) || actor.id.trim() === '' || actor.requestId.trim() === '') {
    throw domainError('WC002');
  }
}

function oneStatement(statement: string): string {
  return statement.trim().replace(/;+\s*$/u, '');
}

class FifoWriter implements Writer {
  readonly instanceId: string;
  private tail: Promise<void> = Promise.resolve();
  private leader = false;
  private lastRenewAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly log: (line: string) => void;

  constructor(
    private readonly client: KbClient,
    options: WriterOptions = {},
  ) {
    this.instanceId = options.instanceId ?? newId();
    this.log = options.log ?? ((line) => console.log(line));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  read<T = Record<string, unknown>>(statement: string): Promise<T[]> {
    return this.enqueue(() => this.client.query<T>(statement));
  }

  async withWrite<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    assertActor(actor);
    return this.enqueue(async () => {
      const writes: string[] = [];
      const audits: AuditChange[] = [];
      const tx: Tx = {
        read: (statement) => this.client.query(statement),
        write: (statement) => {
          writes.push(statement);
        },
        audit: (change) => {
          audits.push(change);
        },
      };
      const result = await fn(tx);
      if (writes.length === 0 && audits.length === 0) return result;
      await this.commit(actor, writes, audits);
      return result;
    });
  }

  tryAcquireLease(): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.leader) await this.client.query('ROLLBACK').catch(() => undefined);
      await this.client.query(sql`
        UPDATE core.writer_lease
        SET holder = ${this.instanceId}, expires_at = now() + INTERVAL 60 SECOND
        WHERE id = 1 AND (holder = ${this.instanceId} OR expires_at < now())
      `);
      const rows = await this.client.query<{ holder: string | null }>(sql`
        SELECT holder FROM core.writer_lease WHERE id = 1
      `);
      this.leader = rows[0]?.holder === this.instanceId;
      if (this.leader) this.lastRenewAt = Date.now();
      return this.leader;
    });
  }

  async currentRole(): Promise<'leader' | 'standby'> {
    const rows = await this.read<{ leader: boolean }>(sql`
      SELECT COALESCE(holder = ${this.instanceId} AND expires_at > now(), FALSE) AS leader
      FROM core.writer_lease
      WHERE id = 1
    `);
    return rows[0]?.leader === true ? 'leader' : 'standby';
  }

  verifyAuditChain(): Promise<AuditChainStatus> {
    return verifyChain({ query: (statement) => this.read(statement) });
  }

  startMaintenance(): void {
    if (this.timer) return;
    const tick = () => {
      const due = !this.leader || Date.now() - this.lastRenewAt >= 20_000;
      if (!due) return;
      const task = this.leader ? this.renew() : this.tryAcquireLease();
      void task.catch(() => {
        this.leader = false;
        this.log(JSON.stringify({ level: 'error', component: 'writer', code: 'WRITER_LEASE' }));
      });
    };
    this.timer = setInterval(tick, 5_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopMaintenance(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private renew(): Promise<void> {
    return this.enqueue(async () => {
      await this.client.query(sql`
        UPDATE core.writer_lease
        SET expires_at = now() + INTERVAL 60 SECOND
        WHERE id = 1 AND holder = ${this.instanceId} AND expires_at > now()
      `);
      const rows = await this.client.query<{ leader: boolean }>(sql`
        SELECT COALESCE(holder = ${this.instanceId} AND expires_at > now(), FALSE) AS leader
        FROM core.writer_lease
        WHERE id = 1
      `);
      this.leader = rows[0]?.leader === true;
      if (this.leader) this.lastRenewAt = Date.now();
    });
  }

  private async commit(actor: Actor, writes: string[], audits: AuditChange[]): Promise<void> {
    const auditSql = audits.length > 0 ? await auditInserts(this.client, actor, audits) : [];
    const script = [...[
      'BEGIN TRANSACTION',
      sql`
        SELECT CASE
          WHEN (
            SELECT holder = ${this.instanceId} AND expires_at > now()
            FROM core.writer_lease
            WHERE id = 1
          )
          THEN 1
          ELSE error('WRITER_LEASE_LOST')
        END
      `,
      sql`
        UPDATE core.writer_lease
        SET expires_at = now() + INTERVAL 60 SECOND
        WHERE id = 1 AND holder = ${this.instanceId}
      `,
    ], ...writes, ...auditSql, 'COMMIT']
      .map(oneStatement)
      .join(';\n')
      .concat(';');
    try {
      try {
        await this.client.query(script);
      } catch (error) {
        // The Knowledge Base keeps a failed transaction open on its shared connection until someone sends
        // ROLLBACK; if another client left it like that, clear it and retry this operation once.
        if (!isAbortedTransaction(error)) throw error;
        await this.client.query('ROLLBACK').catch(() => undefined);
        await this.client.query(script);
      }
      this.leader = true;
      this.lastRenewAt = Date.now();
    } catch (error) {
      await this.client.query('ROLLBACK').catch(() => undefined);
      const mapped = mapDatabaseError(error);
      if (mapped instanceof DomainError && mapped.code === 'WRITER_LEASE_LOST') {
        this.leader = false;
        this.log(JSON.stringify({ level: 'error', component: 'writer', code: 'WRITER_LEASE_LOST' }));
      }
      throw mapped;
    }
  }
}

function isAbortedTransaction(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Current transaction is aborted');
}

let active: Writer | undefined;

export function createWriter(client: KbClient, options?: WriterOptions): Writer {
  return new FifoWriter(client, options);
}

export function installWriter(writer: Writer): void {
  active = writer;
}

function currentWriter(): Writer {
  if (!active) throw new Error('Escritor no inicializado');
  return active;
}

export function withWrite<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return currentWriter().withWrite(actor, fn);
}

export function read<T = Record<string, unknown>>(statement: string): Promise<T[]> {
  return currentWriter().read<T>(statement);
}

export function verifyAuditChain(): Promise<AuditChainStatus> {
  return currentWriter().verifyAuditChain();
}
