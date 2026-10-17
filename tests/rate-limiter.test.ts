// Unit tests for the rate limiter, using a fake clock so no test has to wait.

import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../src/lib/rate-limiter.js";

function setup(limit = 3, windowMs = 1000) {
  const clock = { now: 0 };
  const limiter = new FixedWindowLimiter(limit, windowMs, () => clock.now);
  return { clock, limiter };
}

describe("FixedWindowLimiter", () => {
  it("allows hits up to the limit, then blocks", () => {
    const { limiter } = setup(3);

    limiter.hit("k");
    limiter.hit("k");
    expect(limiter.retryAfterMs("k")).toBe(0);
    limiter.hit("k");
    expect(limiter.retryAfterMs("k")).toBeGreaterThan(0);
  });

  it("says how long until the window ends", () => {
    const { clock, limiter } = setup(1, 1000);

    limiter.hit("k"); // window: 0 → 1000
    clock.now = 400;

    expect(limiter.retryAfterMs("k")).toBe(600);
  });

  it("unblocks when the window ends", () => {
    const { clock, limiter } = setup(1, 1000);

    limiter.hit("k");
    clock.now = 1000;

    expect(limiter.retryAfterMs("k")).toBe(0);
  });

  it("starts a fresh count after the window ends", () => {
    const { clock, limiter } = setup(2, 1000);

    limiter.hit("k");
    limiter.hit("k");
    clock.now = 1500;
    limiter.hit("k");

    expect(limiter.retryAfterMs("k")).toBe(0);
  });

  it("keeps separate counts per key", () => {
    const { limiter } = setup(1);

    limiter.hit("a");

    expect(limiter.retryAfterMs("a")).toBeGreaterThan(0);
    expect(limiter.retryAfterMs("b")).toBe(0);
  });

  it("reset() clears one key", () => {
    const { limiter } = setup(1);

    limiter.hit("k");
    limiter.reset("k");

    expect(limiter.retryAfterMs("k")).toBe(0);
  });

  it("prune() forgets finished windows only", () => {
    const { clock, limiter } = setup(1, 1000);

    limiter.hit("old");
    clock.now = 600;
    limiter.hit("new"); // window: 600 → 1600
    clock.now = 1200;
    limiter.prune();
    clock.now = 1300;

    expect(limiter.retryAfterMs("old")).toBe(0);
    expect(limiter.retryAfterMs("new")).toBe(300);
  });
});
