/** 60 calls per minute per client (ADR 010). */
export const MCP_RATE_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit = MCP_RATE_PER_MINUTE) {}

  /** Returns false when the client is already at the limit for this window. */
  allow(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => nowMs - at < WINDOW_MS);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return true;
  }
}
