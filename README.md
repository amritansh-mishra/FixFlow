# FixFlow

[![CI](https://github.com/amritansh-mishra/FixFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/amritansh-mishra/FixFlow/actions/workflows/ci.yml)

A multi-tenant REST API for maintenance and work-order management. FixFlow replaces scattered WhatsApp messages, calls and spreadsheets with a structured workflow for apartment complexes, hostels, offices and college campuses.

A resident reports a leaking tap, a manager assigns a technician, the technician updates progress, and the resident confirms the fix. Every step is recorded.

## Why we built it

**The problem.** In most hostels, apartment societies and campuses, repairs are reported on WhatsApp groups, phone calls or a notebook at the front desk. Messages get buried, nobody knows who's handling what, residents keep asking "any update?", and there's no record to show how long repairs actually take.

**The solution.** FixFlow gives every problem a **ticket** with a clear owner and status. Each person sees only what concerns them, gets notified when something changes, and every step is saved in a history that can't be edited.

**The second goal: learning.** FixFlow was also built to learn backend engineering properly, by doing what real production systems do rather than a basic to-do app: data separation between organizations, security, background jobs, file storage, two kinds of API, automated tests and CI. Every decision is explained in plain language in [`docs.md`](docs.md).

## Who it's for

| Who | What they get |
|---|---|
| **Residents, students, tenants** | Report a problem with photos in a minute, follow its progress, confirm when it's fixed |
| **Technicians** | A clear list of jobs assigned to them; no more chasing messages |
| **Managers, wardens, facility staff** | See every ticket, assign work, spot delays, check each technician's workload on a dashboard |
| **Organizations** | Hostels, apartment complexes, offices, college campuses. Many organizations share one installation, each fully separated from the others |
| **Developers and reviewers** | A readable, tested example of a multi-tenant backend, with the reasoning behind each choice |

**Live app:** `https://<frontend>.onrender.com` · **API:** `https://<api>.onrender.com` · **Interactive API docs:** `https://<api>.onrender.com/docs`
(free tier: the first request after a while can take ~1 minute while the server wakes up)

## Highlights

- **Multi-tenant isolation:** every query is scoped to the user's organization. Composite foreign keys make cross-organization references impossible at the database level.
- **Authentication:** scrypt password hashing, server-side sessions with hashed tokens, login rate limiting (per account and per IP), and generic errors with equal timing so attackers can't discover which accounts exist.
- **Self-serve onboarding:** create an organization (you become its admin), invite residents with a regenerable join code, and add staff from a Team page. Managers can add residents and technicians; only admins can add managers.
- **Role-based access:** residents, technicians, managers and admins each see and do only what their role allows. Hidden tickets return `404`.
- **Workflow as a state machine:** `open → assigned → in_progress → resolved → closed` (with reopen), with the rules in one policy module.
- **Audit history:** an append-only event log for every ticket, written in the same transaction as each change.
- **Background jobs:** assignments, status changes and comments queue notification jobs (BullMQ on Redis); a separate worker process turns them into in-app notifications and emails, idempotently, with retries.
- **Photo attachments:** uploads checked by their actual bytes (JPEG/PNG/WebP, ≤ 5 MB), re-encoded to strip hidden metadata such as GPS location, with small WebP thumbnails, stored in S3-compatible object storage (Cloudflare R2 in production, SeaweedFS locally), served through short-lived signed links.
- **GraphQL API alongside REST:** one query fetches a ticket with its people, comments, photos and history; per-request DataLoaders keep database queries constant (no N+1); same rules as REST; alias, size and depth limits.
- **Concurrency-safe updates:** optimistic concurrency returns `409 CONFLICT` instead of losing a simultaneous change.
- **Least-privilege database role:** the app's database user can't alter tables or rewrite history.
- **Comments, search and pagination:** ticket discussions, text search with filters, and cursor pagination that stays exact down to the microsecond.
- **Manager dashboard data:** tickets by status and priority, average resolution time, and technician workload, computed with SQL aggregates.
- **Interactive API docs:** OpenAPI 3.1 generated from the same Zod schemas used for validation, with Swagger UI at `/docs`.
- **369 automated tests** (Vitest + Supertest) against a real PostgreSQL database, including a deterministic race-condition test. They run in **GitHub Actions CI** on every push.

**Tech stack:** TypeScript, Node.js 24, Express 5, GraphQL (Yoga + Pothos), PostgreSQL, Redis + BullMQ, S3 API (Cloudflare R2), Drizzle ORM, Zod, Vitest, Docker Compose, OpenAPI/Swagger, GitHub Actions · React 19 + Vite frontend · deployed on Render.

**Frontend** (`frontend/`): sign up or join with a code, log in, browse and search tickets, report problems, assign technicians, move tickets through the workflow with role-aware buttons, comment, see each ticket's history, a manager dashboard, and a Team page (people, join code, properties).

## Why these technologies (and not the alternatives)

Each tool was picked for a reason. Here's the reason, and what we chose it over.

| Need | We used | Instead of | Why |
|---|---|---|---|
| Language | **TypeScript** | Plain JavaScript | The compiler catches mistakes (a wrong field name, a missing case) before the code runs. Database, validation and GraphQL types all connect, so a change in one place is checked everywhere |
| Server | **Node.js + Express 5** | NestJS, Fastify, Django, Spring Boot | Express is the most widely used Node framework and stays out of the way, so every piece (auth, errors, validation) is visible and written on purpose. NestJS adds a lot of structure that hides how things work; Fastify is faster, but speed isn't the bottleneck here |
| Database | **PostgreSQL** | MongoDB, MySQL | Tickets, users, properties and organizations are connected data, which suits a relational database. PostgreSQL lets the **database itself** enforce rules: composite foreign keys stop one organization's ticket pointing at another's user, transactions keep history in sync, and per-column permissions limit what the app can change. MongoDB would leave all of that to app code |
| Database access | **Drizzle ORM** | Prisma, TypeORM, raw SQL strings | Drizzle reads like SQL, so you still learn SQL. It's thin (no separate query engine) and writes plain, reviewable SQL migration files. Raw strings risk SQL injection; Prisma and TypeORM have their own language that hides the SQL |
| Validation | **Zod** | Joi, class-validator | One schema does three jobs: checks incoming data, gives TypeScript types, and generates the API documentation. The REST and GraphQL APIs share the same schemas |
| Login | **Server-side sessions** | JWT | A session is a row in the database, so logging out or changing a password takes effect **instantly** on every device. A JWT stays valid until it expires unless you build extra machinery |
| Password hashing | **scrypt** | bcrypt, Argon2 | Built into Node (no extra native package to install or patch) and designed to be slow and memory-hungry for attackers. Argon2 is equally good but needs an extra dependency |
| Background jobs | **Redis + BullMQ** | Sending emails inside the request, RabbitMQ, Kafka | Emails can be slow or fail; a queue lets the request finish instantly while a separate **worker** retries failed jobs. RabbitMQ and Kafka are powerful but far more than a notification queue needs; Redis is simple and widely used |
| File storage | **Cloudflare R2** (S3 API) | Amazon S3, storing files in the database | R2 has **no fee for downloads**, and photos are viewed far more often than uploaded. It speaks the same S3 API, so moving to Amazon S3 is a settings change. Files in the database would bloat it and slow backups |
| Local file storage | **SeaweedFS** | MinIO | MinIO was the usual choice, but its repository was archived (no longer maintained) when checked in 2026 |
| Image processing | **sharp** | Jimp, ImageMagick | Very fast (built on libvips). Re-encoding every photo removes hidden GPS location data and creates small thumbnails |
| Second API | **GraphQL** (Yoga + Pothos) | Apollo Server, schema-first GraphQL | Pothos defines the schema **in TypeScript**, so the compiler checks every resolver. Yoga is lightweight and follows the spec closely. Apollo Server is heavier and more tied to Apollo's commercial tools |
| Tests | **Vitest + Supertest** | Jest, Mocha | Vitest runs TypeScript and modern modules without extra setup and is fast. Supertest sends real HTTP requests to the app, and the tests run against a **real PostgreSQL**, not mocks |
| Local services | **Docker Compose** | Installing each service by hand | One command starts PostgreSQL, Redis, a test mail inbox (Mailpit) and file storage, the same way on every machine |
| CI | **GitHub Actions** | Jenkins, CircleCI | Built into GitHub and free for public repositories; every push runs the full test suite |
| Frontend | **React 19 + Vite** | Next.js, Angular | The app sits behind a login, so it doesn't need search-engine-friendly server rendering (Next.js's main strength). Vite builds plain static files that can be hosted anywhere for free. React is the library most reviewers know |
| Hosting | **Render** | AWS, Heroku, Vercel | Free tier, and a single `render.yaml` file describes the whole setup (infrastructure as code). It runs a normal long-lived Node server; Vercel is built for short-lived serverless functions, a poor fit for a queue worker. AWS is far more setup for a project this size |

## Limitations

Being honest about what FixFlow doesn't do (yet):

- **Not deployed yet.** `render.yaml` currently creates the API, the frontend and the database. The background worker, Redis, a real email provider and Cloudflare R2 still have to be added for notifications, emails and photos to work online.
- **Free hosting sleeps.** On Render's free tier, the first request after a quiet period can take about a minute.
- **No live updates.** Notifications appear when the page checks for them, not instantly (no WebSockets).
- **Login rate limits live in memory.** That's fine for one server; with several servers, each would keep its own count. They'd need to move into Redis.
- **Photos only.** Attachments are JPEG, PNG or WebP images up to 5 MB; no videos or PDFs.
- **Basic accounts.** No two-factor authentication and no "Sign in with Google".
- **No deadlines or recurring jobs.** Tickets don't have due dates, automatic escalation, or scheduled maintenance (e.g. "service the water pump monthly").
- **English only**, and no mobile app (the website works on phones).
- **The frontend uses REST only.** GraphQL is available for other clients.
- **Browser screens aren't tested automatically.** The 369 tests cover the API; the UI is tested by hand.

## Future scope

Ideas for what comes next, roughly in order of usefulness:

1. **Finish the deployment:** worker, Redis, email and R2 on Render.
2. **Live updates** with WebSockets or Server-Sent Events, so new tickets and status changes appear instantly.
3. **Deadlines and escalation:** a due date per priority, with a reminder or escalation to the manager when it's missed.
4. **Recurring maintenance:** scheduled tickets for routine checks.
5. **Mobile-friendly app** (an installable web app) with push notifications and taking photos from the camera.
6. **Reports:** export tickets to CSV, monthly summaries, ratings from residents after a fix.
7. **Stronger accounts:** two-factor authentication and single sign-on for colleges and companies.
8. **Scaling:** rate limits in Redis, structured logs, metrics and error tracking (e.g. Sentry).
9. **End-to-end browser tests** with Playwright.
10. **More languages,** starting with Hindi.

## Try the demo

The deployed API has a demo organization (`demo`). All demo accounts share the password set when deploying:

| Email | Role |
|---|---|
| `manager@example.com` | manager: sees all tickets, assigns technicians |
| `technician@example.com` | technician: sees assigned tickets, starts and resolves them |
| `resident@example.com` | resident: reports tickets, closes resolved ones |
| `admin@example.com` | admin |

Or try the other ways in: **Create organization** (your own empty one), or **Join with code** using `DEMO-2026` to join the demo as a new resident.

```bash
API=https://<your-service>.onrender.com

# 1. Log in (returns a token)
curl -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d '{"organization":"demo","email":"manager@example.com","password":"<demo-password>"}'

# 2. Use the token
curl $API/api/tickets -H "Authorization: Bearer <token>"
```

## Deploying to Render

`render.yaml` creates three things: the API (`fixflow-api`), the frontend (`fixflow-web`, a static site) and a PostgreSQL database.

1. Push this repository to GitHub.
2. In the Render dashboard: **New → Blueprint**, then pick the repository.
3. When asked, set:
   - `DEMO_PASSWORD` (at least 12 characters): the password of the demo accounts.
   - `CORS_ORIGINS`: the frontend's URL, e.g. `https://fixflow-web.onrender.com`.
   - `VITE_API_URL`: the API's URL, e.g. `https://fixflow-api.onrender.com`.

   The URLs are shown once the services are created. If you don't know them yet, enter a placeholder, then fix both in each service's **Environment** tab and redeploy. The frontend reads `VITE_API_URL` at build time.
4. Every API deploy runs migrations, seeds the demo organization once, then starts the server (`npm run start:prod`).

## Local development

Requires Node 24 (`nvm use`) and Docker. No local PostgreSQL install is needed.

```bash
docker compose up -d      # PostgreSQL (5433), Redis (6379), Mailpit (inbox: http://localhost:8025), SeaweedFS (S3: 8333)
cp .env.example .env      # defaults already point at the Docker database
npm install
npm run db:migrate        # create the tables (add -- --status to preview)
npm run dev               # start the API with auto-reload on http://localhost:3000
npm run worker            # in a second terminal: the background worker (notifications and emails)
npm test                  # run the tests (in a separate fixflow_test database)
```

Useful Docker commands: `docker compose ps` (is it healthy?), `docker compose logs postgres`, `docker compose stop` (keeps data), `docker compose down -v` (deletes the data for a fresh start).

Prefer your own PostgreSQL? Point both URLs in `.env` at it and see "Database users" below.

Frontend, in a second terminal (the API must be running on port 3000):

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173. Vite forwards /api to the local API, so no CORS setup is needed
```

## API

### GraphQL

`POST /graphql` accepts GraphQL queries with the same `Authorization: Bearer <token>` and the same rules as REST. In development, open http://localhost:3000/graphql in a browser for the interactive explorer.

```graphql
{ me { name role } tickets(status: open, first: 10) { nodes { id title priority } nextCursor } }
```

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
| manager, admin | every ticket in the organization |

Passwords can also be set from the terminal (the prompt is hidden; it logs the user out everywhere):

```bash
npm run user:set-password -- --org <organization-slug> --email <email>
```

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service and database status |
| `POST` | `/api/auth/signup` | `{ organizationName, organizationSlug, name, email, password }`: create an organization and become its admin |
| `POST` | `/api/auth/join` | `{ joinCode, name, email, password }`: join as a resident |
| `POST` | `/api/auth/login` | `{ organization, email, password }` → session token |
| `POST` | `/api/auth/logout` | End the current session → 204 |
| `GET` | `/api/auth/me` | The logged-in user |
| `POST` | `/api/auth/forgot-password` | `{ organization, email }`: email a one-time reset link (same answer whether or not the account exists) |
| `POST` | `/api/auth/reset-password` | `{ token, newPassword }`: use the link (works once, for 30 minutes; logs out every device) |
| `POST` | `/api/auth/password` | Change your password: `{ currentPassword, newPassword }` (logs out your other sessions) |
| `GET` | `/api/properties` | The organization's properties (needed to create tickets) |
| `GET` | `/api/notifications?limit=` | Your notifications, newest first, with `unreadCount` |
| `POST` | `/api/notifications/read` | Mark read: `{ ids: [...] }` or `{}` for all |
| `GET` | `/api/organization` | Your organization (join code for managers and admins) |
| `POST` | `/api/organization/join-code` | Replace the join code (managers and admins) |
| `GET` | `/api/users` | Everyone in the organization (managers and admins) |
| `POST` | `/api/users` | Add a person with a temporary password |
| `POST` | `/api/properties` | Add a property (managers and admins) |
| `GET` | `/api/stats` | Ticket statistics and technician workload (managers and admins) |
| `GET` | `/api/tickets?status=&priority=&propertyId=&q=&limit=&cursor=` | List visible tickets, newest first. `q` searches title and description; pass `nextCursor` as `cursor` for the next page (`limit` 1–50, default 20) |
| `PATCH` | `/api/tickets/:id` | Edit `{ title?, description?, priority? }`: reporter until work starts, managers until closed |
| `GET` | `/api/tickets/:id` | One ticket (404 if it doesn't exist or belongs to another organization) |
| `POST` | `/api/tickets` | Create a ticket: `{ propertyId, title, description?, priority? }` → 201 |
| `PATCH` | `/api/tickets/:id/assign` | Assign to a technician: `{ technicianId }` (managers and admins) |
| `PATCH` | `/api/tickets/:id/status` | Change status: `{ status }` (see workflow below) |
| `GET` | `/api/tickets/:id/history` | Everything that happened to the ticket, oldest first |
| `GET` | `/api/tickets/:id/comments` | The ticket's comments, with author name and role |
| `POST` | `/api/tickets/:id/comments` | Add a comment: `{ body }` |
| `GET` | `/api/tickets/:id/attachments` | The ticket's photos, each with a download link valid for 5 minutes |
| `DELETE` | `/api/tickets/:id/attachments/:attachmentId` | Remove a photo (uploader, manager, admin) |
| `POST` | `/api/tickets/:id/attachments` | Upload a photo (form field `photo`; JPEG/PNG/WebP, ≤ 5 MB, ≤ 10 per ticket) |

### Ticket workflow

```
open ──assign──▶ assigned ──start──▶ in_progress ──resolve──▶ resolved ──close──▶ closed
                 (reassign ok)                         ▲                │
                                                       └────reopen──────┘
```

| Change | Who |
|---|---|
| report a ticket | resident, manager, admin (not technicians) |
| edit title / description / priority | the reporter while `open` or `assigned`; managers and admins until `closed` |
| assign / reassign (`open` or `assigned`) | manager, admin |
| `assigned → in_progress`, `in_progress → resolved` | the assigned technician |
| `resolved → closed`, `resolved → in_progress` (reopen) | the ticket's creator, manager, admin |

Any other change returns `409 INVALID_TRANSITION`, and a permitted change by the wrong person returns `403 FORBIDDEN`. If two people change the same ticket at once, the second gets `409 CONFLICT`.

Errors always look like `{ "error": { "code", "message", "details"? } }`. Validation errors list each problem in `details` as `{ path, message }`.

### Database users

The app should connect as `fixflow_app`, a restricted role created by migration `0004`. It can only read and change the rows the app needs; it can't alter tables or rewrite ticket history. Migrations and test setup connect as the table owner through `DATABASE_ADMIN_URL`.

**With Docker, this is automatic:** `docker/postgres-init.sql` creates the role with login on the container's first start.

On your own PostgreSQL, the role starts with no password and login disabled. One-time setup:

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
