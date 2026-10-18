// Typed client for the FixFlow API.

export type Role = "resident" | "technician" | "manager" | "admin";
export type Status = "open" | "assigned" | "in_progress" | "resolved" | "closed";
export type Priority = "low" | "medium" | "high" | "urgent";

export const STATUSES: Status[] = ["open", "assigned", "in_progress", "resolved", "closed"];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
}

export interface Ticket {
  id: string;
  propertyId: string;
  createdBy: string;
  assignedTo: string | null;
  title: string;
  description: string | null;
  priority: Priority;
  status: Status;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEvent {
  id: string;
  actorId: string;
  type: "created" | "assigned" | "status_changed" | "commented" | "edited";
  fromStatus: Status | null;
  toStatus: Status | null;
  assignedTo: string | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; role: Role };
}

export interface Property {
  id: string;
  name: string;
  address: string | null;
}

export interface Stats {
  total: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
  averageResolutionHours: number | null;
  resolvedTickets: number;
  technicians: { id: string; name: string; active: number; completed: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

// Empty in development (Vite forwards /api to the local backend).
const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Called when the server says the session is no longer valid.
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  // Files go as FormData: the browser sets the multipart Content-Type (with
  // its boundary) itself, so we mustn't. Everything else is JSON.
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? null : isForm ? (options.body as FormData) : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. It may be waking up; try again in a moment.");
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = json?.error ?? {};
    if (res.status === 401 && options.token) onUnauthorized();
    throw new ApiError(res.status, error.code ?? "ERROR", error.message ?? res.statusText, error.details ?? []);
  }
  return json as T;
}

// Turns an error into one line for the screen, including field details.
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message));
    return fields.length ? `${err.message} (${fields.join("; ")})` : err.message;
  }
  return "Something went wrong";
}

export interface AppNotification {
  id: string;
  type: "ticket_assigned" | "status_changed" | "comment_added";
  message: string;
  ticketId: string;
  actorId: string;
  readAt: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  ticketId: string;
  uploadedBy: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  // Signed download links, valid for 5 minutes: the full photo and a small preview.
  url: string;
  thumbnailUrl: string;
}

// Same limits as the API, checked first so people get instant feedback.
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_TICKET = 10;
