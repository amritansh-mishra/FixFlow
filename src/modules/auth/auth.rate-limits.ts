// Brute-force protection for login.
//
// Two limits work together:
// - per account: 5 FAILED attempts per 15 minutes, against one org + email.
//   Stops password guessing against a single account.
// - per IP address: 20 attempts (of any result) per 15 minutes.
//   Stops one machine trying a common password against many accounts.

import { FixedWindowLimiter } from "../../lib/rate-limiter.js";

const WINDOW_MS = 15 * 60 * 1000;

export const loginLimits = {
  account: new FixedWindowLimiter(5, WINDOW_MS),
  ip: new FixedWindowLimiter(20, WINDOW_MS),
};

export function accountKey(organization: string, email: string): string {
  return `${organization}\n${email.toLowerCase()}`;
}

// For tests: start every test with clean counts.
export function resetLoginLimits(): void {
  loginLimits.account.clear();
  loginLimits.ip.clear();
}

// Clear out old windows every minute. unref() lets the process exit anyway.
setInterval(() => {
  loginLimits.account.prune();
  loginLimits.ip.prune();
}, 60_000).unref();
