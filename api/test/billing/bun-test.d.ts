declare module "bun:test" {
  interface Assertions {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: string): void;
    toBeInstanceOf(expected: new (...args: any[]) => unknown): void;
    toThrow(expected?: string | RegExp | (new (...args: any[]) => unknown)): void;
  }

  interface Expect {
    (actual: unknown): Assertions;
  }

  export const expect: Expect;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void): void;
}
