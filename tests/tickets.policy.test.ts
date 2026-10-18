// Unit tests: the permission rules on their own. No database, no HTTP.

import { describe, expect, it } from "vitest";
import type { UserRole } from "../src/db/schema.js";
import type { AuthContext } from "../src/middleware/auth.js";
import {
  canAssign,
  canCreateTicket,
  canEditTicket,
  canViewTicket,
  findTransition,
  isAssignable,
  ticketScope,
} from "../src/modules/tickets/tickets.policy.js";

const as = (userId: string, role: UserRole): AuthContext => ({ sessionId: "s", userId, organizationId: "org", role });

const ticket = { createdBy: "creator", assignedTo: "tech" };

const creator = as("creator", "resident");
const otherResident = as("someone-else", "resident");
const assignee = as("tech", "technician");
const otherTech = as("other-tech", "technician");
const manager = as("boss", "manager");
const admin = as("root", "admin");

describe("canAssign", () => {
  it.each([
    ["manager", true, manager],
    ["admin", true, admin],
    ["technician", false, assignee],
    ["resident", false, creator],
  ])("%s → %s", (_name, expected, auth) => {
    expect(canAssign(auth)).toBe(expected);
  });
});

describe("canCreateTicket", () => {
  it.each([
    ["resident", true, creator],
    ["manager", true, manager],
    ["admin", true, admin],
    ["technician", false, assignee],
  ])("%s → %s", (_name, expected, auth) => {
    expect(canCreateTicket(auth)).toBe(expected);
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

describe("ticket visibility", () => {
  it.each([
    ["resident", "createdBy", creator],
    ["technician", "assignedTo", assignee],
    ["manager", "all", manager],
    ["admin", "all", admin],
  ] as const)("role %s → scope %s", (_name, scope, auth) => {
    expect(ticketScope(auth)).toBe(scope);
  });

  it.each([
    ["the creator", creator, true],
    ["another resident", otherResident, false],
    ["the assigned technician", assignee, true],
    ["another technician", otherTech, false],
    ["a manager", manager, true],
    ["an admin", admin, true],
  ] as const)("%s can see the ticket: %s", (_name, auth, expected) => {
    expect(canViewTicket(auth, ticket)).toBe(expected);
  });

  it("a technician can't see an unassigned ticket", () => {
    expect(canViewTicket(assignee, { createdBy: "creator", assignedTo: null })).toBe(false);
  });
});

describe("canEditTicket", () => {
  const at = (status: "open" | "assigned" | "in_progress" | "resolved" | "closed") => ({ ...ticket, status });

  it.each(["open", "assigned"] as const)("the creator can edit while %s", (status) => {
    expect(canEditTicket(creator, at(status))).toBe(true);
  });

  it.each(["in_progress", "resolved", "closed"] as const)("the creator can't once it's %s", (status) => {
    expect(canEditTicket(creator, at(status))).toBe(false);
  });

  it.each(["open", "assigned", "in_progress", "resolved"] as const)("a manager can edit while %s", (status) => {
    expect(canEditTicket(manager, at(status))).toBe(true);
    expect(canEditTicket(admin, at(status))).toBe(true);
  });

  it("nobody can edit a closed ticket", () => {
    for (const who of [creator, manager, admin, assignee]) expect(canEditTicket(who, at("closed"))).toBe(false);
  });

  it("technicians and other residents can't edit", () => {
    expect(canEditTicket(assignee, at("assigned"))).toBe(false);
    expect(canEditTicket(otherResident, at("open"))).toBe(false);
  });
});
