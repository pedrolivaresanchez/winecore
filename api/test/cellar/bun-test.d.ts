declare module "bun:test" {
  interface Matchers {
    readonly not: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toHaveLength(expected: number): void;
    toContain(expected: string): void;
    toMatchObject(expected: object): void;
  }

  interface Expect {
    (actual: unknown): Matchers;
    objectContaining(expected: object): object;
  }

  export const expect: Expect;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void): void;
}
