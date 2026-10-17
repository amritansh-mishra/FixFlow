// Fixed-window rate limiter: allow at most `limit` hits per key in each
// window of `windowMs`. The first hit starts the window; when it ends, the
// count starts again from zero.
//
// Counts live in this process's memory, so they reset when the server
// restarts and aren't shared between several servers. That's fine for one
// server; with more, move the counts to Redis (same methods, different storage).

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    // Injectable clock, so tests can move time forward without waiting.
    private readonly now: () => number = Date.now,
  ) {}

  // Milliseconds until `key` may try again, or 0 if it isn't blocked.
  retryAfterMs(key: string): number {
    const window = this.current(key);
    return window && window.count >= this.limit ? window.resetAt - this.now() : 0;
  }

  hit(key: string): void {
    const window = this.current(key);
    if (window) window.count += 1;
    else this.windows.set(key, { count: 1, resetAt: this.now() + this.windowMs });
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  clear(): void {
    this.windows.clear();
  }

  // Drops finished windows so memory doesn't grow forever.
  prune(): void {
    const now = this.now();
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  private current(key: string): Window | undefined {
    const window = this.windows.get(key);
    if (window && window.resetAt <= this.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }
}
