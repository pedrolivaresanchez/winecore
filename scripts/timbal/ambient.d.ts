// Tipos mínimos para `tsc --strict` sin @types/node. En ejecución los aporta Bun.

interface ImportMeta {
  main?: boolean;
}

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code: number): never;
};

declare module "node:child_process" {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding: "utf8";
      stdio?: ["ignore", "pipe", "pipe"];
    },
  ): {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
}

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void;
  export function chmodSync(path: string, mode: number): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "bun:test" {
  interface Assertion {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toThrow(expected?: unknown): void;
    toContain(expected: string): void;
    toBeGreaterThan(expected: number): void;
    not: {
      toBe(expected: unknown): void;
      toContain(expected: string): void;
    };
    rejects: {
      toThrow(expected?: unknown): Promise<void>;
    };
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): Assertion;
}
