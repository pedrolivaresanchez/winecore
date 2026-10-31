declare module "bun:test" {
  interface Matcher {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeGreaterThan(expected: number): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: RegExp | string): void;
    toBeDefined(): void;
    not: Matcher;
  }
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): Matcher;
}
