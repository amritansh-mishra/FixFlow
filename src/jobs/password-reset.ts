// "Forgot password", run by the worker: if the account exists, create a
// one-time link and email it. If it doesn't, do nothing (the API already gave
// the same answer either way).

import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { organizations, passwordResets, users } from "../db/schema.js";
import { escapeHtml, mailer, type Mailer } from "../lib/email.js";
import { hashToken } from "../modules/auth/auth.service.js";

export const RESET_LINK_MINUTES = 30;

export async function processPasswordResetJob(
  organizationSlug: string,
  email: string,
  send: Mailer = mailer,
): Promise<"sent" | "skipped" | "no account"> {
  const [user] = await db
    .select({ id: users.id, organizationId: users.organizationId, name: users.name, email: users.email })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(organizations.slug, organizationSlug), sql`lower(${users.email}) = ${email.toLowerCase()}`));
  if (!user) return "no account";

  // The token exists only here and in the email. The database keeps its hash.
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    // A new link replaces any older ones that haven't been used.
    await tx
      .update(passwordResets)
      .set({ usedAt: sql`now()` })
      .where(and(eq(passwordResets.userId, user.id), sql`${passwordResets.usedAt} IS NULL`));
    await tx.insert(passwordResets).values({
      organizationId: user.organizationId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60_000),
    });
  });

  const link = `${env.appUrl}/#/reset-password?token=${token}`;
  return send.send({
    to: user.email,
    subject: "Reset your FixFlow password",
    text:
      `Hi ${user.name},\n\nSomeone asked to reset your FixFlow password. If it was you, open this link ` +
      `within ${RESET_LINK_MINUTES} minutes:\n\n${link}\n\nIf it wasn't you, ignore this email; ` +
      `your password hasn't changed.\n\n— FixFlow`,
    html:
      `<p>Hi ${escapeHtml(user.name)},</p>` +
      `<p>Someone asked to reset your FixFlow password. If it was you, use this link within ${RESET_LINK_MINUTES} minutes:</p>` +
      `<p><a href="${link}">Reset my password</a></p>` +
      `<p>If it wasn't you, ignore this email; your password hasn't changed.</p><p style="color:#6b7280">— FixFlow</p>`,
  });
}
