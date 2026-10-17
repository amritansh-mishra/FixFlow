# FixFlow Work Log

One line per finished task. Details live in [docs.md](../docs.md) and the Git history.

| # | Date | Done | Next |
|---|---|---|---|
| 1 | 2026-09-29 | Repo created, PostgreSQL `flixflow` DB with 4 tables, basic Express server + `/health` | Audit the repo |
| 2 | 2026-10-17 | Audit done: found missing ticket indexes, no `updated_at` trigger, error leaks | Stabilize foundation |
| 3 | 2026-10-17 | Foundation stabilized: Node 24, env validation, JSON error handling, graceful shutdown (`d5ee72f`) | Migrations |
| 4 | 2026-10-17 | Baseline migration made, indexes + `updated_at` trigger added, own migration runner (`9b7de94`) | Learning notes |
| 5 | 2026-10-17 | `docs.md` learning notes created (`0c4f831`), chapter 18 added | Drizzle setup |
| 6 | 2026-10-17 | Drizzle set up: hand-checked `schema.ts`, Drizzle migrations proven identical to live DB, tracking handed over, old runner removed | First API endpoint: `GET /api/tickets` |
| 7 | 2026-10-17 | `GET /api/tickets` built (routes/controller/service, org-scoped, validated), Vitest + 13 tests on a separate test DB | Next ticket endpoints: `GET /api/tickets/:id`, `POST /api/tickets` |
| 8 | 2026-10-17 | Zod validation, `GET /api/tickets/:id` (404 across orgs), `POST /api/tickets` (property ownership check), `X-User-Id` placeholder; 29 tests | Ticket status updates + assignment (`PATCH`), with role rules |
| 9 | 2026-10-17 | Assignment + status workflow (state machine, role rules), `ticket_events` history table (migration 0002 applied), optimistic concurrency; 80 tests | Phase 3: real authentication (passwords, login tokens), visibility rules |
| 10 | 2026-10-17 | Real auth: scrypt password hashing, `POST /api/auth/login`/`logout`/`me`, hashed session tokens (migration 0003 applied), `user:set-password` CLI; `X-User-Id` removed; 103 tests | Login rate limiting + visibility rules (residents see own tickets) |
| 11 | 2026-10-17 | Login rate limiting (5 fails/account, 20/IP per 15 min → 429) + role-based ticket visibility (resident: own, technician: assigned, manager/admin: all; others 404); 137 tests | Least-privilege DB user, then Docker Compose for local dev |
