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

// Lowercase letters, digits and single hyphens, e.g. "sunrise-hostel".
export const slugSchema = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters")
  .max(50, "Slug must be at most 50 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, e.g. sunrise-hostel");

const personFields = {
  name: z.string().trim().min(1).max(120),
  // Stored in lowercase so Me@x.com and me@x.com can't become two accounts.
  email: z.email().max(255).transform((email) => email.toLowerCase()),
  password: newPasswordSchema,
};

// POST /api/auth/signup: create an organization and become its admin.
export const signupBody = z.strictObject({
  organizationName: z.string().trim().min(2).max(150),
  organizationSlug: slugSchema,
  ...personFields,
});

// POST /api/auth/join: join an organization as a resident, using its code.
export const joinBody = z.strictObject({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Join codes look like K7QM-3XPA"),
  ...personFields,
});

export type SignupBody = z.infer<typeof signupBody>;
export type JoinBody = z.infer<typeof joinBody>;
