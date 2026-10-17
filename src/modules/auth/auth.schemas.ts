import { z } from "zod";

// Rules for choosing a new password. Length matters far more than symbols:
// a long passphrase is both stronger and easier to remember.
export const newPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters");

// POST /api/auth/login
// The password is only length-capped here (to bound hashing work); the
// strength rules apply when a password is set, not when logging in.
export const loginBody = z.strictObject({
  organization: z.string().trim().min(1).max(100),
  email: z.email().max(255),
  password: z.string().min(1).max(128),
});
