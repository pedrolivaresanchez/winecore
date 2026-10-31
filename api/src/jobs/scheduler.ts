const JOB_ID = /^[a-z][a-z0-9-]{0,62}$/;

export type JobResult = 'ran' | 'not_leader' | 'overlap' | 'error';

export interface Scheduler {
  register(id: string, everyMs: number, fn: () => Promise<void>): void;
  start(): void;
  stop(): void;
  run(id: string): Promise<JobResult>;
}

interface Timer {
  set(fn: () => void, everyMs: number): unknown;
  clear(handle: unknown): void;
}

export interface SchedulerOptions {
  isLeader: () => boolean | Promise<boolean>;
  log?: (line: string) => void;
  timer?: Timer;
}

interface Job {
  id: string;
  everyMs: number;
  fn: () => Promise<void>;
  running: boolean;
  handle?: unknown;
}

const defaultTimer: Timer = {
  set(fn, everyMs) {
    const handle = setInterval(fn, everyMs);
    if (typeof handle.unref === 'function') handle.unref();
    return handle;
  },
  clear(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export function createScheduler(options: SchedulerOptions): Scheduler {
  const jobs = new Map<string, Job>();
  const log = options.log ?? ((line: string) => console.log(line));
  const timer = options.timer ?? defaultTimer;
  let started = false;

  function arm(job: Job): void {
    if (!started || job.handle !== undefined) return;
    job.handle = timer.set(() => {
      void run(job.id);
    }, job.everyMs);
  }

  async function run(id: string): Promise<JobResult> {
    const job = jobs.get(id);
    if (!job) throw new Error('Job desconocido');
    if (job.running) {
      log(JSON.stringify({ level: 'info', component: 'scheduler', job: job.id, event: 'skip', reason: 'overlap' }));
      return 'overlap';
    }
    job.running = true;
    const startedAt = performance.now();
    try {
      let leader = false;
      try {
        leader = await options.isLeader();
      } catch {
        log(JSON.stringify({ level: 'error', component: 'scheduler', job: job.id, code: 'LEADER_CHECK' }));
        return 'error';
      }
      if (!leader) {
        log(JSON.stringify({ level: 'info', component: 'scheduler', job: job.id, event: 'skip', reason: 'not_leader' }));
        return 'not_leader';
      }
      log(JSON.stringify({ level: 'info', component: 'scheduler', job: job.id, event: 'start' }));
      try {
        await job.fn();
      } catch {
        log(JSON.stringify({ level: 'error', component: 'scheduler', job: job.id, code: 'JOB_FAILED' }));
        return 'error';
      }
      log(JSON.stringify({
        level: 'info',
        component: 'scheduler',
        job: job.id,
        event: 'finish',
        ms: Math.max(0, Math.round(performance.now() - startedAt)),
      }));
      return 'ran';
    } finally {
      job.running = false;
    }
  }

  return {
    register(id, everyMs, fn) {
      if (!JOB_ID.test(id)) throw new Error('Identificador de job no válido');
      if (!Number.isInteger(everyMs) || everyMs < 1) throw new Error('Intervalo de job no válido');
      if (jobs.has(id)) throw new Error('Job ya registrado');
      const job: Job = { id, everyMs, fn, running: false };
      jobs.set(id, job);
      arm(job);
    },
    start() {
      if (started) return;
      started = true;
      for (const job of jobs.values()) arm(job);
      log(JSON.stringify({
        level: 'info',
        component: 'scheduler',
        event: 'started',
        jobs: [...jobs.keys()],
      }));
    },
    stop() {
      started = false;
      for (const job of jobs.values()) {
        if (job.handle === undefined) continue;
        timer.clear(job.handle);
        job.handle = undefined;
      }
    },
    run,
  };
}
