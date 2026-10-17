// Logging in and out, sessions, and setting passwords. Knows nothing about HTTP.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { organizations, properties, sessions, users, type UserRole } from "../../db/schema.js";
import { generateJoinCode, isUniqueViolation } from "../../lib/codes.js";
import { hashPassword, verifyPassword } from "../../lib/passwords.js";
import { HttpError } from "../../middleware/errors.js";
import type { JoinBody, SignupBody } from "./auth.schemas.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionUser {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: UserRole;
}

// The token is 32 random bytes: impossible to guess. Only its SHA-256 hash is
// stored. A fast hash is fine here (unlike passwords) because the token is
// already random and long, so there's nothing to brute-force.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(user: { id: string; organizationId: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.insert(sessions).values({
    organizationId: user.organizationId,
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

// Returns the session's user, or null if the token is unknown or expired.
export async function findSessionUser(token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, and(eq(users.id, sessions.userId), eq(users.organizationId, sessions.organizationId)))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)));
  return row ?? null;
}

export async function deleteSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

async function findUserByLogin(organizationSlug: string, email: string) {
  const [user] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(organizations.slug, organizationSlug), sql`lower(${users.email}) = ${email.toLowerCase()}`));
  return user ?? null;
}

// Used when the user doesn't exist, so a failed login takes as long as a real
// password check. Otherwise response times would reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: Omit<NonNullable<Awaited<ReturnType<typeof findUserByLogin>>>, "passwordHash"> }
  | { ok: false; reason: "unknown_user" | "no_password" | "wrong_password" };

export async function login(organizationSlug: string, email: string, password: string): Promise<LoginResult> {
  const user = await findUserByLogin(organizationSlug, email);

  if (!user?.passwordHash) {
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(password, await dummyHash);
    return { ok: false, reason: user ? "no_password" : "unknown_user" };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, reason: "wrong_password" };
  }

  const { passwordHash: _omit, ...publicUser } = user;
  const { token, expiresAt } = await createSession(user);
  return { ok: true, token, expiresAt, user: publicUser };
}

// Sets (or replaces) a user's password and logs them out everywhere.
// Returns false if no such user exists.
export async function setUserPassword(organizationSlug: string, email: string, password: string) {
  const user = await findUserByLogin(organizationSlug, email);
  if (!user) return false;

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), eq(sessions.organizationId, user.organizationId)));
  });
  return true;
}

export async function getCurrentUser(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId));
  return user ?? null;
}

const publicUserFields = {
  id: users.id,
  organizationId: users.organizationId,
  name: users.name,
  email: users.email,
  role: users.role,
};

// Creates an organization with the caller as its admin and a first property,
// then logs them in. Everything is created together or not at all.
export async function signup(input: SignupBody) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: input.organizationName, slug: input.organizationSlug, joinCode: generateJoinCode() })
        .returning({ id: organizations.id });
      await tx.insert(properties).values({ organizationId: org!.id, name: "Main building" });
      const [admin] = await tx
        .insert(users)
        .values({ organizationId: org!.id, name: input.name, email: input.email, role: "admin", passwordHash })
        .returning(publicUserFields);
      return admin!;
    });
    return { ...(await createSession(user)), user };
  } catch (err) {
    // Checked by the database, so two simultaneous signups can't both win.
    if (isUniqueViolation(err, "organizations_slug_key")) {
      throw new HttpError(409, "SLUG_TAKEN", "That organization ID is already taken. Try another one.");
    }
    throw err;
  }
}

// Joins the organization that owns the code, as a resident, and logs in.
export async function joinWithCode(input: JoinBody) {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.joinCode, input.joinCode));
  if (!org) {
    throw new HttpError(400, "INVALID_JOIN_CODE", "That join code isn't valid. Ask your manager for the current one.");
  }

  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(users)
      .values({ organizationId: org.id, name: input.name, email: input.email, role: "resident", passwordHash })
      .returning(publicUserFields);
    return { ...(await createSession(user!)), user: user! };
  } catch (err) {
    if (isUniqueViolation(err, "users_organization_id_email_key")) {
      throw new HttpError(409, "EMAIL_TAKEN", "An account with that email already exists here. Log in instead.");
    }
    throw err;
  }
}
