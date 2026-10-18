import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { validate } from "../../lib/validate.js";
import { getAuth } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { enqueuePasswordReset } from "../../jobs/queue.js";
import { accountCreationLimit, accountKey, loginLimits, passwordResetLimits } from "./auth.rate-limits.js";
import {
  changePasswordBody,
  forgotPasswordBody,
  joinBody,
  loginBody,
  resetPasswordBody,
  signupBody,
} from "./auth.schemas.js";
import { changePassword, deleteSession, getCurrentUser, joinWithCode, login, resetPassword, signup } from "./auth.service.js";

// Security log lines, kept out of test output. Never include passwords.
function securityLog(message: string) {
  if (env.nodeEnv !== "test") console.warn(message);
}

// POST /api/auth/login
export const loginHandler: RequestHandler = async (req, res) => {
  const { organization, email, password } = validate(loginBody, req.body, "request body");
  const account = accountKey(organization, email);
  const ip = req.ip ?? "unknown";

  // Check the limits BEFORE checking the password: a blocked attempt is
  // refused even if the password is right, and costs no hashing work.
  const waitMs = Math.max(loginLimits.account.retryAfterMs(account), loginLimits.ip.retryAfterMs(ip));
  if (waitMs > 0) {
    const minutes = Math.ceil(waitMs / 60_000);
    res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
    securityLog(`Login rate-limited: org=${organization} ip=${ip}`);
    throw new HttpError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
  loginLimits.ip.hit(ip);

  const result = await login(organization, email, password);
  if (!result.ok) {
    loginLimits.account.hit(account);
    securityLog(`Failed login: org=${organization} reason=${result.reason} ip=${ip}`);
    // One message for every failure, so attackers can't learn which
    // organizations or emails exist.
    throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect organization, email or password");
  }

  // A successful login clears the account's failed attempts.
  loginLimits.account.reset(account);
  res.status(200).json({
    data: { token: result.token, expiresAt: result.expiresAt, user: result.user },
  });
};

// POST /api/auth/logout
export const logoutHandler: RequestHandler = async (req, res) => {
  await deleteSession(getAuth(req).sessionId);
  res.status(204).end();
};

// GET /api/auth/me
export const meHandler: RequestHandler = async (req, res) => {
  const user = await getCurrentUser(getAuth(req).userId);
  res.status(200).json({ data: user });
};

// Shared by signup and join: refuse once an IP has created too many accounts.
function checkAccountCreationLimit(ip: string, res: Parameters<RequestHandler>[1]) {
  const waitMs = accountCreationLimit.retryAfterMs(ip);
  if (waitMs > 0) {
    res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
    securityLog(`Account creation rate-limited: ip=${ip}`);
    throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many accounts created from this network. Try again later.");
  }
  accountCreationLimit.hit(ip);
}

// POST /api/auth/signup
export const signupHandler: RequestHandler = async (req, res) => {
  const body = validate(signupBody, req.body, "request body");
  checkAccountCreationLimit(req.ip ?? "unknown", res);

  const result = await signup(body);
  res.status(201).json({ data: { token: result.token, expiresAt: result.expiresAt, user: result.user } });
};

// POST /api/auth/join
export const joinHandler: RequestHandler = async (req, res) => {
  const body = validate(joinBody, req.body, "request body");
  checkAccountCreationLimit(req.ip ?? "unknown", res);

  const result = await joinWithCode(body);
  res.status(201).json({ data: { token: result.token, expiresAt: result.expiresAt, user: result.user } });
};

// POST /api/auth/password
export const changePasswordHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { currentPassword, newPassword } = validate(changePasswordBody, req.body, "request body");

  // Wrong current passwords count toward the same limit as failed logins, so
  // a stolen session can't be used to guess the password.
  const limitKey = `password-change\n${auth.userId}`;
  const waitMs = loginLimits.account.retryAfterMs(limitKey);
  if (waitMs > 0) {
    res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
    throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many wrong passwords. Try again later.");
  }

  if (!(await changePassword(auth, currentPassword, newPassword))) {
    loginLimits.account.hit(limitKey);
    securityLog(`Failed password change: user=${auth.userId} ip=${req.ip}`);
    throw new HttpError(400, "WRONG_PASSWORD", "Your current password is incorrect");
  }
  loginLimits.account.reset(limitKey);
  res.status(200).json({ data: { changed: true } });
};

// Same answer whether or not the account exists, so this can't be used to
// find out which emails are registered.
const RESET_REQUESTED = "If an account with that email exists, we've sent a link to reset the password.";

// POST /api/auth/forgot-password
export const forgotPasswordHandler: RequestHandler = async (req, res) => {
  const { organization, email } = validate(forgotPasswordBody, req.body, "request body");
  const ip = req.ip ?? "unknown";
  const account = accountKey(organization, email);

  // Over the limit: still the same answer, just no email.
  if (passwordResetLimits.ip.retryAfterMs(ip) > 0 || passwordResetLimits.account.retryAfterMs(account) > 0) {
    securityLog(`Password reset rate-limited: org=${organization} ip=${ip}`);
    res.status(200).json({ data: { message: RESET_REQUESTED } });
    return;
  }
  passwordResetLimits.ip.hit(ip);
  passwordResetLimits.account.hit(account);

  // The worker looks the person up. The API always queues, so the response
  // takes the same time either way (no timing clue).
  try {
    await enqueuePasswordReset(organization, email);
  } catch (err) {
    console.error("Could not queue password reset:", err);
    throw new HttpError(503, "TEMPORARILY_UNAVAILABLE", "Password reset is temporarily unavailable. Try again shortly.");
  }
  res.status(200).json({ data: { message: RESET_REQUESTED } });
};

// POST /api/auth/reset-password
export const resetPasswordHandler: RequestHandler = async (req, res) => {
  const { token, newPassword } = validate(resetPasswordBody, req.body, "request body");
  if (!(await resetPassword(token, newPassword))) {
    throw new HttpError(400, "INVALID_RESET_LINK", "This reset link is invalid, expired or already used. Request a new one.");
  }
  res.status(200).json({ data: { reset: true } });
};
