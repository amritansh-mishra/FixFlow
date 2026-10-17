# FixFlow

A multi-tenant REST API for maintenance and work-order management. FixFlow replaces scattered WhatsApp messages, calls and spreadsheets with a structured workflow for apartment complexes, hostels, offices and college campuses.

A resident reports a leaking tap, a manager assigns a technician, the technician updates progress, and the resident confirms the fix. Every step is recorded.

**Live API:** `https://<your-service>.onrender.com` (free tier: the first request after a while can take ~1 minute while the server wakes up)

## Highlights

- **Multi-tenant isolation:** every query is scoped to the user's organization. Composite foreign keys make cross-organization references impossible at the database level.
- **Authentication:** scrypt password hashing, server-side sessions with hashed tokens, login rate limiting (per account and per IP), and generic errors with equal timing so attackers can't discover which accounts exist.
- **Role-based access:** residents, technicians, managers and admins each see and do only what their role allows. Hidden tickets return `404`.
- **Workflow as a state machine:** `open → assigned → in_progress → resolved → closed` (with reopen), with the rules in one policy module.
- **Audit history:** an append-only event log for every ticket, written in the same transaction as each change.
- **Concurrency-safe updates:** optimistic concurrency returns `409 CONFLICT` instead of losing a simultaneous change.
- **Least-privilege database role:** the app's database user can't alter tables or rewrite history.
- **155 automated tests** (Vitest + Supertest) against a real PostgreSQL database, including a deterministic race-condition test.

**Tech stack:** TypeScript, Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod, Vitest. Deployed on Render.

## Try the demo

The deployed API has a demo organization (`demo`). All demo accounts share the password set when deploying:

| Email | Role |
|---|---|
| `manager@example.com` | manager: sees all tickets, assigns technicians |
| `technician@example.com` | technician: sees assigned tickets, starts and resolves them |
| `resident@example.com` | resident: reports tickets, closes resolved ones |
| `admin@example.com` | admin |

```bash
API=https://<your-service>.onrender.com

# 1. Log in (returns a token)
curl -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d '{"organization":"demo","email":"manager@example.com","password":"<demo-password>"}'

# 2. Use the token
curl $API/api/tickets -H "Authorization: Bearer <token>"
```

## Deploying to Render

1. Push this repository to GitHub.
2. In the Render dashboard: **New → Blueprint**, then pick the repository. `render.yaml` creates the web service and a PostgreSQL database.
3. When asked, set `DEMO_PASSWORD` (at least 12 characters). It becomes the password of the demo accounts.
4. Every deploy runs migrations, seeds the demo organization once, then starts the server (`npm run start:prod`).

## Local development

Requires Node 24 (`nvm use`) and PostgreSQL.

```bash
cp .env.example .env      # then set DATABASE_URL
npm install
npm run db:migrate        # apply database migrations (add -- --status to preview)
npm run dev               # start the API with auto-reload
npm test                  # run the tests (uses a separate fixflow_test database)
```

## API

### Authentication

Log in with your organization's slug, email and password. The response contains a session token, valid for 7 days:

```bash
curl -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"organization":"my-org","email":"me@example.com","password":"…"}'
# → { "data": { "token": "…", "expiresAt": "…", "user": { … } } }

curl localhost:3000/api/tickets -H "Authorization: Bearer <token>"
```

Every other `/api` route needs that header and only sees data from the user's own organization.

Login is rate-limited: 5 failed attempts per account, or 20 attempts per IP address, within 15 minutes returns `429 TOO_MANY_ATTEMPTS` with a `Retry-After` header.

Within an organization, users see tickets according to their role. Tickets outside a user's scope return `404`:

| Role | Sees |
|---|---|
| resident | tickets they created |
| technician | tickets assigned to them |
| manager, admin | every ticket in the organization | Passwords are set from the terminal (the prompt is hidden; it logs the user out everywhere):

```bash
npm run user:set-password -- --org <organization-slug> --email <email>
```

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service and database status |
| `POST` | `/api/auth/login` | `{ organization, email, password }` → session token |
| `POST` | `/api/auth/logout` | End the current session → 204 |
| `GET` | `/api/auth/me` | The logged-in user |
| `GET` | `/api/properties` | The organization's properties (needed to create tickets) |
| `GET` | `/api/tickets?status=&limit=` | List the organization's tickets, newest first (`limit` 1–50, default 20) |
| `GET` | `/api/tickets/:id` | One ticket (404 if it doesn't exist or belongs to another organization) |
| `POST` | `/api/tickets` | Create a ticket: `{ propertyId, title, description?, priority? }` → 201 |
| `PATCH` | `/api/tickets/:id/assign` | Assign to a technician: `{ technicianId }` (managers and admins) |
| `PATCH` | `/api/tickets/:id/status` | Change status: `{ status }` (see workflow below) |
| `GET` | `/api/tickets/:id/history` | Everything that happened to the ticket, oldest first |

### Ticket workflow

```
open ──assign──▶ assigned ──start──▶ in_progress ──resolve──▶ resolved ──close──▶ closed
                 (reassign ok)                         ▲                │
                                                       └────reopen──────┘
```

| Change | Who |
|---|---|
| assign / reassign (`open` or `assigned`) | manager, admin |
| `assigned → in_progress`, `in_progress → resolved` | the assigned technician |
| `resolved → closed`, `resolved → in_progress` (reopen) | the ticket's creator, manager, admin |

Any other change returns `409 INVALID_TRANSITION`, and a permitted change by the wrong person returns `403 FORBIDDEN`. If two people change the same ticket at once, the second gets `409 CONFLICT`.

Errors always look like `{ "error": { "code", "message", "details"? } }`. Validation errors list each problem in `details` as `{ path, message }`.

### Database users

The app should connect as `fixflow_app`, a restricted role created by migration `0004`. It can only read and change the rows the app needs; it can't alter tables or rewrite ticket history. Migrations and test setup connect as the table owner through `DATABASE_ADMIN_URL`.

The role starts with no password and login disabled. One-time setup:

```bash
openssl rand -base64 24 | tr '+/' '-_' | tr -d '='   # generate a URL-safe password
psql -h localhost -U postgres -d flixflow
#   \password fixflow_app          (hidden prompt; hashed before it's sent)
#   ALTER ROLE fixflow_app LOGIN;
#   \q
```

Then in `.env`, rename the current `DATABASE_URL` to `DATABASE_ADMIN_URL` and set `DATABASE_URL=postgresql://fixflow_app:<password>@localhost:5432/flixflow`. If `DATABASE_ADMIN_URL` is missing, migrations and tests fall back to `DATABASE_URL`, and the permission tests are skipped.

### Database schema and migrations

The schema is defined in TypeScript in `src/db/schema.ts` using [Drizzle ORM](https://orm.drizzle.team). Migrations are SQL files in `drizzle/`, managed by Drizzle Kit.

```bash
# 1. edit src/db/schema.ts
npm run db:generate       # 2. write a new SQL migration into drizzle/
                          # 3. review the generated SQL
npm run db:migrate        # 4. apply it
npm run db:studio         # browse tables and data in the browser
```

For things Drizzle can't generate (triggers, functions), use `npx drizzle-kit generate --custom --name <name>` and write the SQL by hand. Never edit a migration that has already been applied, and never use `drizzle-kit push` against a database with real data.
