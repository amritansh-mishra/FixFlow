// Who may do what to a ticket. Pure functions with no database and no HTTP,
// so the rules are easy to read in one place and to unit-test.

import type { Ticket, TicketStatus, UserRole } from "../../db/schema.js";
import type { AuthContext } from "../../middleware/auth.js";

type TicketParties = Pick<Ticket, "createdBy" | "assignedTo">;
type Rule = (auth: AuthContext, ticket: TicketParties) => boolean;

// Which tickets each role can see, within their own organization:
// "all", or only tickets where this column is the user themselves.
// Tickets you can't see behave as if they don't exist (404).
export type TicketScope = "all" | keyof TicketParties;

const VISIBLE_BY_ROLE: Record<UserRole, TicketScope> = {
  resident: "createdBy", // tickets they reported
  technician: "assignedTo", // tickets assigned to them
  manager: "all",
  admin: "all",
};

export function ticketScope(auth: AuthContext): TicketScope {
  return VISIBLE_BY_ROLE[auth.role];
}

export function canViewTicket(auth: AuthContext, ticket: TicketParties): boolean {
  const scope = ticketScope(auth);
  return scope === "all" || ticket[scope] === auth.userId;
}

const isManager = (auth: AuthContext) => auth.role === "manager" || auth.role === "admin";
const isAssignee: Rule = (auth, ticket) => ticket.assignedTo === auth.userId;
const isCreatorOrManager: Rule = (auth, ticket) => ticket.createdBy === auth.userId || isManager(auth);

// The allowed status changes and who may make each one. Any change not listed
// here is invalid, whoever asks. Assignment (open → assigned) has its own
// endpoint, so it isn't listed.
const TRANSITIONS: Partial<Record<TicketStatus, Partial<Record<TicketStatus, Rule>>>> = {
  assigned: { in_progress: isAssignee },
  in_progress: { resolved: isAssignee },
  resolved: {
    closed: isCreatorOrManager, // the fix is confirmed
    in_progress: isCreatorOrManager, // reopen: the fix didn't work
  },
};

// Returns the rule for a status change, or undefined if the change is not allowed at all.
export function findTransition(from: TicketStatus, to: TicketStatus): Rule | undefined {
  return TRANSITIONS[from]?.[to];
}

// Residents report problems; managers and admins also log them on residents'
// behalf (phone calls, shared areas). Technicians work on tickets rather than
// report them. Their scope only covers tickets assigned to them, so they
// couldn't even see a ticket they had created.
export function canCreateTicket(auth: AuthContext): boolean {
  return auth.role !== "technician";
}

export function canAssign(auth: AuthContext): boolean {
  return isManager(auth);
}

// A ticket can be (re)assigned until work has started.
export const ASSIGNABLE_STATUSES = ["open", "assigned"] as const satisfies readonly TicketStatus[];

export function isAssignable(status: TicketStatus): boolean {
  return (ASSIGNABLE_STATUSES as readonly TicketStatus[]).includes(status);
}
