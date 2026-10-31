declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;
  export function expect(actual: unknown): {
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    not: { toEqual(expected: unknown): void };
  };
}

declare module "node:fs" {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function statSync(path: string): { mtimeMs: number; size: number };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}
