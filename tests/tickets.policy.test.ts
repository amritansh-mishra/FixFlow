// Unit tests: the permission rules on their own. No database, no HTTP.

import { describe, expect, it } from "vitest";
import type { UserRole } from "../src/db/schema.js";
import type { AuthContext } from "../src/middleware/auth.js";
import { canAssign, findTransition, isAssignable } from "../src/modules/tickets/tickets.policy.js";

const as = (userId: string, role: UserRole): AuthContext => ({ userId, organizationId: "org", role });

const ticket = { createdBy: "creator", assignedTo: "tech" };

const creator = as("creator", "resident");
const otherResident = as("someone-else", "resident");
const assignee = as("tech", "technician");
const otherTech = as("other-tech", "technician");
const manager = as("boss", "manager");
const admin = as("root", "admin");

describe("canAssign", () => {
  it.each([
    ["manager", manager, true],
    ["admin", admin, true],
    ["technician", assignee, false],
    ["resident", creator, false],
  ])("%s → %s", (_name, auth, expected) => {
    expect(canAssign(auth)).toBe(expected);
  });
});

describe("isAssignable", () => {
  it.each([
    ["open", true],
    ["assigned", true],
    ["in_progress", false],
    ["resolved", false],
    ["closed", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(isAssignable(status)).toBe(expected);
  });
});

describe("findTransition", () => {
  it.each([
    ["open", "resolved"],
    ["open", "in_progress"],
    ["assigned", "resolved"],
    ["in_progress", "closed"],
    ["closed", "open"],
    ["closed", "in_progress"],
    ["resolved", "resolved"],
  ] as const)("does not allow %s → %s for anyone", (from, to) => {
    expect(findTransition(from, to)).toBeUndefined();
  });

  it("start work: only the assigned technician", () => {
    const rule = findTransition("assigned", "in_progress")!;
    expect(rule(assignee, ticket)).toBe(true);
    expect(rule(otherTech, ticket)).toBe(false);
    expect(rule(manager, ticket)).toBe(false);
    expect(rule(creator, ticket)).toBe(false);
  });

  it("resolve: only the assigned technician", () => {
    const rule = findTransition("in_progress", "resolved")!;
    expect(rule(assignee, ticket)).toBe(true);
    expect(rule(otherTech, ticket)).toBe(false);
    expect(rule(admin, ticket)).toBe(false);
  });

  it.each([
    ["close", "closed"],
    ["reopen", "in_progress"],
  ] as const)("%s: the creator, a manager or an admin", (_name, to) => {
    const rule = findTransition("resolved", to)!;
    expect(rule(creator, ticket)).toBe(true);
    expect(rule(manager, ticket)).toBe(true);
    expect(rule(admin, ticket)).toBe(true);
    expect(rule(otherResident, ticket)).toBe(false);
    expect(rule(assignee, ticket)).toBe(false);
  });
});
