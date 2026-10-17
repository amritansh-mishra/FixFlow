# FixFlow: Learning Notes

My notes on the backend engineering concepts I learned while building FixFlow, in simple language. A new chapter is added after each step of the project.

## Contents

1. [Node.js versions and nvm](#1-nodejs-versions-and-nvm)
2. [Environment variables and config validation](#2-environment-variables-and-config-validation)
3. [Splitting the app from the server](#3-splitting-the-app-from-the-server)
4. [Graceful shutdown](#4-graceful-shutdown)
5. [Error handling and HTTP status codes](#5-error-handling-and-http-status-codes)
6. [Database connection pools](#6-database-connection-pools)
7. [TypeScript configuration](#7-typescript-configuration)
8. [Security lessons so far](#8-security-lessons-so-far)
9. [Database migrations](#9-database-migrations)
10. [Indexes](#10-indexes)
11. [Triggers: keeping `updated_at` correct](#11-triggers-keeping-updated_at-correct)
12. [Transactions](#12-transactions)
13. [How a migration runner works](#13-how-a-migration-runner-works)
14. [Changing a real database safely](#14-changing-a-real-database-safely)
15. [ORMs and Drizzle](#15-orms-and-drizzle)
16. [Drizzle Kit and migrations](#16-drizzle-kit-and-migrations)
17. [Git: commits, pushes and viewing diffs](#17-git-commits-pushes-and-viewing-diffs)
18. [Why we wrote our own baseline before switching to Drizzle](#18-why-we-wrote-our-own-baseline-before-switching-to-drizzle)
19. [Setting up Drizzle in FixFlow](#19-setting-up-drizzle-in-fixflow)
20. [The first endpoint: GET /api/tickets](#20-the-first-endpoint-get-apitickets)
21. [Automated tests](#21-automated-tests)
22. [Validation with Zod, GET one ticket, create a ticket](#22-validation-with-zod-get-one-ticket-create-a-ticket)
23. [Assignment, status workflow, history and race conditions](#23-assignment-status-workflow-history-and-race-conditions)
24. [Real authentication: passwords, login and sessions](#24-real-authentication-passwords-login-and-sessions)
25. [Login rate limiting and ticket visibility](#25-login-rate-limiting-and-ticket-visibility)
26. [A least-privilege database user](#26-a-least-privilege-database-user)
27. [Glossary](#glossary)

---

## 1. Node.js versions and nvm

**What:** Node.js has numbered versions. Even numbers (20, 22, 24) become **LTS** (Long-Term Support), meaning they get security fixes for years. Each version eventually reaches **end-of-life** and stops getting fixes.

**What happened in FixFlow:** the project ran on Node 20, which reached end-of-life in April 2026. I upgraded to **Node 24 LTS**.

**nvm** (Node Version Manager) lets one computer have several Node versions installed and switch between them.

```bash
nvm install 24        # download and install Node 24
nvm alias default 24  # use 24 in every new terminal
nvm use               # use the version written in this project's .nvmrc file
```

- **`.nvmrc`** is a file containing just `24`. It tells anyone working on the project which Node version to use.
- **`"engines": { "node": ">=24" }`** in `package.json` documents the same requirement for tools and hosting platforms.
- **`@types/node`** should match the Node version you run. Types for Node 26 would let you use features that don't exist in Node 24, so the code would type-check but crash when run.

**Gotcha:** VS Code terminals inherit settings from VS Code itself. After changing the default Node version, quit and reopen VS Code completely.

---

## 2. Environment variables and config validation

**What:** **environment variables** are settings given to a program from outside its code, such as the database password or the port number. They live in a `.env` file locally.

**Why not write them in the code?** Secrets in code end up on GitHub, where anyone can read them. Settings also differ between your laptop and the production server.

**Rules:**
- `.env` holds the real values. It's listed in **`.gitignore`**, so Git never uploads it.
- `.env.example` holds fake values. It is committed, so others know which settings are needed.

**Config validation (`src/config/env.ts`):** instead of reading `process.env.X` all over the code, one file reads and **checks** every setting when the app starts.

```ts
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
```

- **Fail fast:** if `DATABASE_URL` is missing, the app refuses to start with a clear message. Without the check it would start, then fail later with a confusing error, or connect to the wrong database.
- **Never print secrets in error messages.** The check says "DATABASE_URL is invalid" but never shows the URL, because it contains the password and error messages often end up in log files.
- **Typed config:** `env.port` is a `number`. `process.env.PORT` is `string | undefined`.
- `Object.freeze(...)` stops other code from changing the config while the app is running.

Later we'll use **Zod**, a library that does this kind of checking for us.

---

## 3. Splitting the app from the server

**Before:** one file built the Express app **and** started listening on a port.

**After:**
- `src/app.ts` contains `createApp()`, which builds the app (middleware and routes) and returns it.
- `src/server.ts` calls `createApp()`, then `app.listen(port)`.

**Why:** tests can call `createApp()` and send fake requests to it without starting a real server on a real port. This is a standard Express pattern.

**Middleware order matters.** Express runs middleware in the order you add it:

```ts
app.use(express.json());      // 1. read JSON bodies
app.get("/health", ...);      // 2. routes
app.use(notFoundHandler);     // 3. nothing matched → 404
app.use(errorHandler);        // 4. must be LAST, catches errors from everything above
```

---

## 4. Graceful shutdown

**Problem:** when the server is stopped (Ctrl+C, or Docker restarting it), it can be killed in the middle of handling a request, leaving half-finished work and open database connections.

**Signals** are messages the operating system sends a program:
- **SIGINT**: you pressed Ctrl+C
- **SIGTERM**: Docker or a hosting platform says "please stop"

```ts
function shutdown(signal: string) {
  server.close(async () => {   // stop accepting new requests, finish current ones
    await pool.end();          // close database connections
    process.exit(0);           // exit cleanly (0 = success)
  });
  setTimeout(() => process.exit(1), 10_000).unref();   // safety net: force exit after 10s
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

**Analogy:** a shop at closing time locks the front door (no new customers), serves the people already inside, then turns off the lights.

---

## 5. Error handling and HTTP status codes

### Status codes

| Code | Meaning | When FixFlow uses it |
|---|---|---|
| 200 | OK | The request worked |
| 201 | Created | A new ticket was created |
| 400 | Bad Request | Client sent broken input (e.g. malformed JSON) |
| 401 | Unauthorized | Not logged in |
| 403 | Forbidden | Logged in, but not allowed |
| 404 | Not Found | Route or ticket doesn't exist |
| 413 | Payload Too Large | Request body bigger than 100kb |
| 500 | Internal Server Error | A bug in our code |
| 503 | Service Unavailable | Temporarily down (e.g. database unreachable) |

**Rule of thumb:** 4xx means the client did something wrong, 5xx means the server did.

### Central error handler (`src/middleware/errors.ts`)

Without one, Express answers errors with an **HTML page that includes the full stack trace**, revealing file paths and libraries to anyone.

Errors come in three kinds and are handled differently:

1. **Expected errors** (ticket not found, not allowed): we throw them on purpose, and the message is safe to show.
   ```ts
   throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
   ```
2. **Client mistakes** caught by Express (bad JSON, body too large): reply with a 4xx in general terms.
3. **Bugs** (anything else): log full details on the server, tell the client only "An unexpected error occurred".

**Consistent response shape**: every error looks the same, so the frontend can rely on it:

```json
{ "error": { "code": "TICKET_NOT_FOUND", "message": "Ticket not found" } }
```

**Express facts:**
- An error handler is recognised by having **four parameters** `(err, req, res, next)`. Keep `_next` even if unused; the `_` tells TypeScript it's intentionally unused.
- In **Express 5**, an error thrown inside an `async` route goes to the error handler automatically. Express 4 needed try/catch in every route.

---

## 6. Database connection pools

**Problem:** opening a new connection to PostgreSQL is slow, because it involves a handshake and a login. Doing it for every request wastes time.

**A pool** keeps a few connections open and lends them out: a request borrows one, uses it, and gives it back. **Analogy:** a bike-sharing station instead of buying a new bike for every trip.

```ts
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,                          // at most 10 connections open at once
  idleTimeoutMillis: 30_000,        // close a connection unused for 30 seconds
  connectionTimeoutMillis: 5_000,   // give up connecting after 5 seconds
});
```

`connectionTimeoutMillis` matters most. The default is **no timeout**, so if the database is down, requests hang forever instead of failing quickly.

**Parameterized queries:** always pass user input separately from the SQL:

```ts
pool.query("SELECT * FROM tickets WHERE id = $1", [ticketId]);   // ✅ safe
pool.query(`SELECT * FROM tickets WHERE id = '${ticketId}'`);    // ❌ SQL injection!
```

---

## 7. TypeScript configuration

`tsconfig.json` tells the TypeScript compiler how to check and build the code.

| Setting | Meaning |
|---|---|
| `"rootDir": "./src"`, `"outDir": "./dist"` | Read `.ts` from `src/`, write compiled `.js` to `dist/` |
| `"module": "nodenext"` | Use Node's modern module system (`import`/`export`) |
| `"types": ["node"]` | Load Node's types, so `process`, `Buffer` etc. are known |
| `"strict": true` | Turn on all the important safety checks |
| `"noUncheckedIndexedAccess"` | `rows[0]` might be `undefined`, so you must check |
| `"noUnusedLocals"` / `"noUnusedParameters"` | Flag leftover unused code |
| `"include": ["src"]` | Only compile files in `src/` |

Settings removed from FixFlow: `"jsx"` (only for React, not a backend) and `"declaration"` (only for libraries other people install).

**Scripts in `package.json`:**

```bash
npm run dev        # run with auto-reload while coding (tsx)
npm run typecheck  # check types without building
npm run build      # compile to dist/ (deletes old dist first)
npm start          # run the compiled code (production)
```

---

## 8. Security lessons so far

1. **Don't leak error details to clients.** The old `/health` returned raw database errors, which can include hostnames and usernames. Log details on the server and send clients something generic.
2. **Don't advertise your stack.** Express adds an `X-Powered-By: Express` header by default. `app.disable("x-powered-by")` removes it.
3. **Limit request body size** (`express.json({ limit: "100kb" })`), so nobody can send a giant body to slow the server down.
4. **Never print secrets**, in logs, error messages, or commands.
5. **Least privilege:** the app shouldn't connect as `postgres` (a superuser that can do anything). A dedicated user that can only read and write FixFlow's tables limits the damage if something goes wrong. *(Still to do.)*
6. **Never trust a user-supplied `organization_id`.** The user's organization must come from their verified login, not from the request. *(Coming in Phase 3.)*

---

## 9. Database migrations

**Problem:** I created the tables by typing SQL directly into PostgreSQL, so the database structure existed **only inside the database**. If the laptop died or someone cloned the repo, nobody could rebuild it.

**A migration** is a SQL file in the project that describes **one change** to the database. Run them in order on an empty database and you get the exact current structure, on any machine.

**Analogy:** save points in a video game.

```
db/migrations/
  0000_baseline.sql                      → create the 4 tables
  0001_tickets_indexes_and_updated_at.sql → add indexes and auto-timestamp
  0002_...                               → future changes
```

**The baseline** is the starting point: the schema as it already existed. Every constraint has a **name** (e.g. `users_organization_id_email_key`). Postgres invents one if you don't choose, so the baseline spells out the exact same names to make it **identical** to the real database.

**The golden rule:** never edit a migration that has already run. Add a new one instead. The database already ran the old version, so editing the file doesn't change the database; it just makes the file wrong.

---

## 10. Indexes

**Analogy:** the index at the back of a textbook. Without it, finding "plumbing" means reading every page. With it, you jump straight to page 214.

```sql
CREATE INDEX idx_tickets_org_status ON tickets (organization_id, status);
```

This keeps a sorted list of tickets by organization, then status, so *"show open tickets in Sunrise Hostel"* finds them instantly instead of scanning every ticket.

- **Why each FixFlow index starts with `organization_id`:** FixFlow is **multi-tenant** (one app shared by many organizations), and every query is scoped to one organization.
- **Cost:** indexes take space and make inserts slightly slower, because the sorted list must be updated too. Add them for queries you actually run often.
- `PRIMARY KEY` and `UNIQUE` constraints create indexes automatically.

**Lesson from the audit:** the 3 `CREATE INDEX` commands were written but **never actually ran**. Always verify what's really in the database.

---

## 11. Triggers: keeping `updated_at` correct

**Problem:** `updated_at TIMESTAMPTZ DEFAULT NOW()` only sets the time **when a row is created**. Updating the ticket later leaves the old time.

**A trigger** is an automatic action the database runs when something happens. **Analogy:** a light that switches on when you open the door.

```sql
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();   -- NEW = the row as it's about to be saved
    RETURN NEW;                -- continue saving it
END;
$$;

CREATE TRIGGER tickets_set_updated_at
    BEFORE UPDATE ON tickets      -- just before a ticket is updated...
    FOR EACH ROW                  -- ...for every changed row...
    EXECUTE FUNCTION set_updated_at();   -- ...run the function
```

**Why in the database and not the API code?** The database enforces it for **every** update, from any code, script, or manual SQL. Nobody can forget it.

---

## 12. Transactions

**A transaction** groups several SQL statements so they **all succeed or all fail together**.

**Analogy:** a bank transfer. Money leaves account A *and* arrives in account B. You never want only half of that to happen.

```sql
BEGIN;      -- start a draft
  ...statements...
COMMIT;     -- make the draft permanent
-- or
ROLLBACK;   -- throw the draft away, as if nothing happened
```

PostgreSQL can even undo `CREATE TABLE` and `CREATE INDEX` inside a transaction. Many databases can't, so this is a nice Postgres feature.

**Read-only transactions** (`BEGIN READ ONLY`) guarantee a script can only look and never change anything. I used them to inspect the real database safely.

---

## 13. How a migration runner works

`src/db/migrate.ts` runs migration files. Command: `npm run db:migrate`.

1. **Logbook table.** It keeps a `schema_migrations` table listing which files already ran. Files already listed are skipped, so running it twice is safe.
2. **Transactions.** Each file runs inside `BEGIN … COMMIT`. If it fails, `ROLLBACK`, so the database is never half-changed.
3. **Baseline handling.** If the tables already exist (a hand-made database), it records `0000_baseline.sql` as done **without running it**, because running it would fail with "table already exists". On an empty database it runs normally.
4. **Checksums (fingerprints).** A **checksum** (SHA-256) is a fingerprint of a file's contents: change one character and the fingerprint is completely different. The runner stores each file's fingerprint and refuses to continue if an applied file was edited.
5. **Dry run.** `npm run db:migrate -- --dry-run` shows what *would* happen without changing anything.
6. **Advisory lock.** `pg_advisory_lock` works like a bathroom door lock. If two copies of the runner start at once, the second waits instead of both running the same migration.

Real tools (Drizzle Kit, Flyway, Prisma Migrate) work the same way underneath.

---

## 14. Changing a real database safely

The workflow used in FixFlow:

1. **Test on a copy.** Create a throwaway database (`fixflow_scratch_...`), run the changes there, and test every situation.
2. **Prove it's correct.** E.g. build a database from the baseline, export its structure with `pg_dump --schema-only`, and compare it line by line with the real one.
3. **Delete the throwaway databases.**
4. **Rehearse on the real database** with `--dry-run` and read the output.
5. **Apply for real.**
6. **Verify:** check that the changes exist and the data is untouched (row counts are the same).

Never experiment directly on a database with data you care about.

---

## 15. ORMs and Drizzle

### The problem with raw SQL in TypeScript

```ts
const result = await pool.query("SELECT * FROM tickets WHERE status = $1", ["open"]);
result.rows[0].titel;   // typo! TypeScript can't catch it, the SQL is just a string
```

TypeScript can't see inside SQL strings. Results are typed `any`, and typos or renamed columns only break when the app runs.

### What an ORM is

**ORM = Object-Relational Mapper:** a translator between TypeScript and the database. You describe tables in TypeScript once, write queries with TypeScript functions, and get **typed** results back. Bugs get a red underline in VS Code before running anything.

### Why Drizzle

ORMs come in two styles:
- **"Hide the SQL"** (Prisma, TypeORM): you learn the ORM's own language.
- **"SQL, but typed"** (Drizzle): code looks almost exactly like SQL.

Drizzle suits learning, because every query maps directly to SQL you recognise.

### Describing a table (schema)

```ts
export const tickets = pgTable("tickets", {
  id:             uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  assignedTo:     uuid("assigned_to"),                          // nullable
  title:          varchar("title", { length: 200 }).notNull(),
  status:         varchar("status", { length: 20 }).notNull().default("open"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`organizationId: uuid("organization_id")`: the quoted name is the **database column** (snake_case), and the name on the left is what you use **in TypeScript** (camelCase).

### Types for free

```ts
type Ticket = typeof tickets.$inferSelect;     // a ticket read from the database
type NewTicket = typeof tickets.$inferInsert;  // what you need to insert one
```

Drizzle works these out from the schema. You never write them by hand.

### Queries

```ts
// SELECT * FROM tickets WHERE organization_id = $1 AND status = $2
// ORDER BY created_at DESC LIMIT 50
const rows = await db.select().from(tickets)
  .where(and(eq(tickets.organizationId, orgId), eq(tickets.status, "open")))
  .orderBy(desc(tickets.createdAt))
  .limit(50);

// INSERT ... RETURNING *
const [ticket] = await db.insert(tickets).values({ ... }).returning();

// UPDATE tickets SET status = $1 WHERE id = $2 AND organization_id = $3
await db.update(tickets).set({ status: "in_progress" })
  .where(and(eq(tickets.id, id), eq(tickets.organizationId, orgId)));
```

Drizzle always sends values separately from the SQL, so it **protects against SQL injection** by default.

---

## 16. Drizzle Kit and migrations

**Drizzle Kit** is Drizzle's command-line tool. It does what our migration runner does, plus it **writes the migration SQL for you**.

### Workflow

1. Edit `schema.ts` (e.g. add a column).
2. `drizzle-kit generate`: Drizzle compares the schema with its last saved **snapshot** and writes a new SQL file.
3. **Read the SQL yourself.** Always.
4. `drizzle-kit migrate`: runs pending files and records them in its logbook table.

**Snapshots** are saved copies of what the schema looked like last time (in `drizzle/meta/`). Comparing the new schema with the last snapshot is how Drizzle knows what changed.

### The commands

| Command | What it does | Safe? |
|---|---|---|
| `generate` | Writes a new migration file. Doesn't touch the database | ✅ |
| `migrate` | Runs pending migration files | ✅ if you reviewed the SQL |
| `pull` | Reads an existing database and writes `schema.ts` for you (introspection) | ✅ read-only |
| `push` | Changes the live database to match `schema.ts` directly, with no file and no review | ⚠️ dangerous |
| `studio` | A web page for browsing tables and data | ✅ for viewing |

### Why `push` is dangerous

- **No record:** no file, no history, can't be repeated elsewhere.
- **No review:** the SQL runs immediately.
- **Can delete data:** renaming a column might be treated as "drop old column, add new one", and all its data is gone.

Fine for throwaway experiments, **never** on a database with real data.

### What Drizzle doesn't understand

Triggers, functions, and some advanced Postgres features. For those, write a **custom migration** (`drizzle-kit generate --custom`) by hand.

### Rule: one migration system only

Drizzle Kit has its own logbook. Running two migration systems side by side means two logbooks that each think they're in charge. Pick one.

---

## 17. Git: commits, pushes and viewing diffs

- **Commit:** saves a snapshot of your changes in local Git history, with a message explaining *what* changed and *why*.
- **Push:** uploads your commits to GitHub (backup, plus it's visible on your portfolio).
- **Small, focused commits** tell the story of the project: one commit per meaningful step.

```bash
git status          # what changed?
git add <files>     # choose what goes in the next commit
git commit -m "..." # save the snapshot
git push            # upload to GitHub
git log --oneline   # see history
```

### Viewing changes in VS Code
- **Uncommitted changes:** Source Control panel (Ctrl+Shift+G), then click a file. Red is removed, green is added.
- **A past commit:** open a file, then the **Timeline** section in the Explorer sidebar, then click a commit.
- **Command line:** `code --diff old-file new-file` opens a side-by-side diff.

---

## 18. Why we wrote our own baseline before switching to Drizzle

### The question

The plan is to use **Drizzle Kit** for migrations. So why did we first write `0000_baseline.sql` and our own runner (`migrate.ts`) by hand, only to hand over to Drizzle afterwards? Wasn't that doing the work twice?

It's a fair question. The honest answer is that part of it was valuable and part of it was extra work.

### Reason 1: Back up first, change tools second

Before task 2, the database structure existed in **only one place**: inside PostgreSQL on this laptop. No file in the repo described it. If the laptop died, or a command went wrong during the Drizzle setup, the schema could have been lost.

The baseline file put a **verified copy of the schema on GitHub before touching any new tool.**

**Analogy:** before reinstalling your operating system, you back up your files. You don't start the reinstall and hope nothing goes wrong.

General rule: **before changing anything risky, make sure you can get back to where you started.**

### Reason 2: Something to check Drizzle's output against

`drizzle-kit pull` reads the database and **writes `schema.ts` for you**. But how do you know the generated file is correct and complete? Tools can miss things, such as a constraint, a default value, or a constraint name.

We now have a reference that's **proven** correct. We built a throwaway database from `0000_baseline.sql`, exported its structure with `pg_dump --schema-only`, and compared it line by line with the real database's export. They were **identical**.

So when Drizzle generates `schema.ts`, we can compare the two:
- Does every table appear?
- Does every column have the same type, length, `NOT NULL` and default?
- Are all the `UNIQUE`, `CHECK` and composite foreign key rules there?

Without the baseline, there would be nothing trustworthy to compare against.

**Analogy:** an answer key. You can't mark a test without one.

### Reason 3: Real problems got fixed straight away

The audit found two real problems:
- The **3 ticket indexes** had never been created.
- **`updated_at`** never changed after a ticket was first created.

Migration `0001` fixed both immediately, tested and verified, instead of leaving them until the Drizzle setup was finished.

### Reason 4: Drizzle can't write triggers anyway

Drizzle Kit generates SQL for tables, columns, indexes and constraints. It **doesn't understand triggers or functions** (see chapter 16). The `set_updated_at()` function and the `tickets_set_updated_at` trigger would have been written **by hand in SQL** whichever tool we used. That work isn't wasted: the same SQL moves over to Drizzle as a **custom migration**.

### Reason 5: Learning how migration tools work inside

Writing `migrate.ts` showed exactly what `drizzle-kit migrate` does behind the scenes (chapter 13):

| What our runner does | Why it matters |
|---|---|
| Keeps a logbook table (`schema_migrations`) | Knows which files already ran, so it's safe to run twice |
| Stores a checksum (fingerprint) per file | Catches migrations edited after they ran |
| Runs each file in a transaction | A failed migration leaves no half-done changes |
| Records the baseline without running it | Lets an existing database join the migration system |
| Has a dry-run mode | You can rehearse before changing anything |
| Uses an advisory lock | Two runs at once can't collide |

When Drizzle Kit does these things, it's no longer a mysterious black box. You know what it's doing and why.

### Was it the ideal approach?

**✅ Ideal, and worth repeating on every project:**
- **Backing up the schema** before changing tools.
- **Verifying what's really in the database** instead of trusting notes. The audit found indexes that were supposedly created but weren't.
- The safe-change workflow: **scratch database → dry run → apply → verify** (chapter 14).

**❌ Not ideal as engineering practice:**
- **We built a runner only to retire it.** A real team would **choose the migration tool first** and create the baseline with that tool from the start, so there's never a second system to hand over from.
- **The risk was small.** With 1 row per table and one developer, running `drizzle-kit pull` directly would have been almost as safe, because `pull` **only reads** the database and never changes it.

### The most efficient order (for next time)

If starting again, or on a future project, the shortest safe path is:

1. **Audit:** check what's really in the database.
2. **Choose the migration tool** (Drizzle Kit), before writing any migration files.
3. **`drizzle-kit pull`:** generate `schema.ts` from the real database (read-only).
4. **Verify against `pg_dump`:** confirm the generated schema matches the real structure.
5. **Mark Drizzle's baseline as applied** on the existing database (record it without running it).
6. **Write the fixes as Drizzle migrations:** the indexes as normal migrations, the trigger as a custom SQL migration.
7. **Test on a scratch database.**
8. **Apply to the real database** (dry run first), then verify.

### Verdict

**A good learning path, but extra work as engineering practice.** Little is actually lost:
- The **verified baseline** remains the answer key for checking Drizzle's output.
- The **SQL in `0001`** (indexes and trigger) carries over to Drizzle unchanged.
- Only **`migrate.ts`** gets retired, and the understanding it gave stays.

### Where did `0001` come from?

It wasn't invented during task 2. Both parts came from the original project plan:

- **The 3 indexes** (`idx_tickets_org_status`, `idx_tickets_assigned_to`, `idx_tickets_property`) were in the original SQL I wrote for the `tickets` table. When the audit checked the real database, they **didn't exist**. The `CREATE TABLE` had run, but the `CREATE INDEX` commands after it never did. That could be from running only part of the script, or from an error stopping it partway.
- **The trigger** fixes a problem my original notes already flagged: *"`updated_at` currently has a default value but is not automatically updated on every modification."*

**Lesson:** "I wrote the SQL" isn't the same as "the SQL ran". Always check the real database.

### Why a separate file instead of adding to the baseline?

Each file has **one honest job**:

| File | Describes |
|---|---|
| `0000_baseline.sql` | What the database **actually looked like** before migrations existed |
| `0001_tickets_indexes_and_updated_at.sql` | The **changes** made on top of that |

**What would go wrong if the indexes had been added to the baseline:**

1. **The baseline would no longer be true.** It would describe indexes the real database didn't have, so it would stop being a reliable answer key.
2. **The indexes would never have been created on the real database.** The runner **records the baseline without running it** on databases whose tables already exist (chapter 13). Anything added to the baseline would be silently skipped on `flixflow`, and the real database would still have no indexes.
3. **History would be hidden.** Separate files show that the indexes were missing and were added later. That story is useful when debugging.

**Rule of thumb:** a baseline describes the past exactly as it was. Every change, even a fix for something that "should have been there all along", goes in a new migration.

---

## 19. Setting up Drizzle in FixFlow

### What we did, step by step

1. Installed `drizzle-orm` (used by the app) and `drizzle-kit` (the command-line tool).
2. Ran `drizzle-kit pull` to read the real database and generate a schema, **into a scratch folder first, not the project**.
3. Compared the result with our answer key, found bugs, and **wrote `src/db/schema.ts` by hand**.
4. Generated Drizzle's own migrations from `schema.ts`.
5. **Proved** they rebuild the real database exactly.
6. Did the **handover**: told Drizzle that the real database already has these migrations.
7. Replaced our old runner with Drizzle's migrator and deleted the old `db/migrations/` folder.

### Lesson 1: the tool got it wrong, and the answer key caught it

`drizzle-kit pull` is supposed to read your database and write a correct `schema.ts`. Its output had **serious mistakes**:

**The composite foreign keys were scrambled.** What `pull` generated:

```ts
foreignKey({
  columns:        [table.organizationId, table.propertyId],
  foreignColumns: [properties.id,        properties.organizationId],
})
```

Read it column by column: it links `organization_id` to `properties.id`, and `property_id` to `properties.organization_id`. That's backwards. A migration built from this would create a completely wrong rule.

The correct version, matching the real database:

```ts
foreignKey({
  columns:        [t.propertyId, t.organizationId],
  foreignColumns: [properties.id, properties.organizationId],
})
```

Other mistakes it made:
- **Composite unique keys in the wrong order:** `(organization_id, id)` instead of `(id, organization_id)`.
- **Index settings swapped:** it marked `organization_id` (a UUID) as text and `status` (text) as a UUID. That SQL would fail.
- **`relations.ts` had duplicate names** and wouldn't even compile.

**Lesson:** generated code is a **first draft**, not the truth. This is exactly what chapter 18's answer key was for: without `0000_baseline.sql` and the `pg_dump` comparison, these bugs could have gone straight into the project.

### Lesson 2: reading `schema.ts`

```ts
role: varchar("role", { length: 20, enum: USER_ROLES }).notNull(),
```

- `"role"` is the database column name.
- `length: 20` makes it `VARCHAR(20)`.
- `enum: USER_ROLES` **only affects TypeScript**: it makes the type `"resident" | "technician" | "manager" | "admin"` instead of plain `string`, so `role: "superadmin"` gets a red underline. The **database** rule is the separate `check(...)` below it.

```ts
check("users_role_check", sql`${t.role} IN ('resident', 'technician', 'manager', 'admin')`),
```

`sql\`...\`` lets you write raw SQL inside Drizzle for things it has no function for, like CHECK rules.

The lists of allowed values are defined **once** at the top of the file and reused:

```ts
export const TICKET_STATUSES = ["open", "assigned", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
// → "open" | "assigned" | "in_progress" | "resolved" | "closed"
```

`as const` tells TypeScript "these exact strings, never changing", which is what lets it build the type. Later, the API's input validation will reuse the same list.

**Dates:** `pull` generated `mode: 'string'`, which returns timestamps as text. We removed it, so Drizzle returns real JavaScript `Date` objects, which are easier to compare and format.

### Lesson 3: what Drizzle Kit generated

```
drizzle/
  0000_baseline.sql            ← CREATE TABLE ... (generated from schema.ts)
  0001_updated_at_trigger.sql  ← the trigger (written by hand, a "custom" migration)
  meta/
    _journal.json              ← the list of migrations, in order, with timestamps
    0000_snapshot.json         ← photo of the schema after 0000
    0001_snapshot.json         ← photo of the schema after 0001
```

- **`--> statement-breakpoint`** lines in the SQL mark where one statement ends. Drizzle runs the file piece by piece.
- **The journal** is Drizzle's table of contents. Each entry has a `tag` (the file name) and `when` (a timestamp in milliseconds).
- **The snapshots** are how `generate` knows what changed next time (chapter 16).
- **The trigger** had to be a custom migration: `drizzle-kit generate --custom --name updated_at_trigger` created an empty file, and we pasted in the same SQL as before.

### Lesson 4: proving it's correct

The same method as chapter 14:
1. Created an empty scratch database.
2. Ran **only** the Drizzle migrations on it.
3. Exported its structure with `pg_dump --schema-only` and diffed it against the real database: **identical**, including indexes, the trigger function and the trigger.

Then a **smoke test** (a quick check that the basics work) through Drizzle on the scratch database:

| Test | Result |
|---|---|
| Insert a ticket | ✅ defaults filled in (`open`, `medium`), `createdAt` is a `Date` |
| Update it | ✅ the trigger changed `updated_at` |
| Ticket in Hostel A pointing at a property in Hostel B | ✅ **rejected** by `tickets_property_id_organization_id_fkey` |
| Status `"done"` | ✅ **rejected** by `tickets_status_check` |

The cross-organization test shows **multi-tenant safety enforced by the database itself**. Even if the API had a bug, the database refuses to mix organizations' data.

Two more consistency checks:
- `drizzle-kit check`: "Everything's fine". The migration files and snapshots agree with each other.
- `drizzle-kit generate`: "No schema changes". `schema.ts` and the migrations describe the same thing.

### Lesson 5: the handover

**The problem:** Drizzle keeps its **own** logbook, the table `drizzle.__drizzle_migrations`. On the real database that logbook was empty, so Drizzle thought both migrations were **pending**. Running `db:migrate` would have tried `CREATE TABLE organizations`, which already exists, and failed.

**How Drizzle decides what's applied:** it doesn't check file names. It looks at the **newest timestamp** in its logbook. Any migration whose journal `when` is newer than that is pending. It also stores each file's SHA-256 fingerprint (`hash`).

**The handover script** (run once, then deleted) did this, inside one transaction:
1. **Safety checks:** refuse unless our *old* logbook (`schema_migrations`) shows both old migrations applied **and** Drizzle's logbook is empty. That way it can't run on the wrong database, or run twice.
2. Created Drizzle's logbook table **exactly** the way Drizzle itself creates it.
3. Inserted one row per migration: the file's fingerprint and its journal timestamp.

It followed the safe workflow again: tested on a scratch database set up to mimic the real one, then a dry run on the real database, then for real, then verified. Afterwards `--status` showed both as applied, `db:migrate` did nothing, the tables were unchanged, and the data was untouched (1/1/1/1 rows).

**Analogy:** moving to a new bank. You don't re-deposit all your money. You give the new bank a statement showing what's already in the account.

### Lesson 6: the new everyday workflow

```bash
# 1. Edit src/db/schema.ts (e.g. add a column)
npm run db:generate          # 2. Drizzle writes drizzle/0002_....sql
                             # 3. READ the SQL file. Always.
npm run db:migrate -- --status   # 4. see what's pending
npm run db:migrate           # 5. apply it
npm run db:studio            # browse data in the browser
```

There is deliberately **no** `db:push` script (chapter 16).

**`src/db/migrate.ts` now** uses Drizzle's migrator, keeps the advisory lock, and adds `--status`. One difference from our old runner: Drizzle runs **all** pending migrations in **one** transaction, so if the third fails, the first two are undone too.

**In the app**, `src/db/index.ts` now exports `db`, the typed query builder, alongside `pool`. Both share the same connections.

### Small things worth knowing

- **npm 11 blocks install scripts by default.** You'll see a warning about `esbuild` and `fsevents`. These scripts only do optional checks, and everything works without them.
- **Stable vs release candidate:** Drizzle 1.0 is still a **release candidate** (`rc`, not final), so we used the stable `0.45` / `0.31` versions. Don't build on pre-release versions unless you need a specific feature.
- **Leftover cleaned up:** after the handover, the old `schema_migrations` table was no longer used. Before dropping it, we checked its contents (just our 2 old rows) and that nothing depended on it. Then `DROP TABLE schema_migrations`. Drizzle's logbook (`drizzle.__drizzle_migrations`) is now the only one.

---

## 20. The first endpoint: GET /api/tickets

### What it does

```
GET /api/tickets                     → newest 20 tickets of my organization
GET /api/tickets?status=open         → only open ones
GET /api/tickets?limit=5             → only 5
```

Response:

```json
{ "data": [ { "id": "…", "title": "Leaking bathroom tap", "status": "open", "priority": "high", "createdAt": "2026-09-29T07:47:50.336Z", … } ] }
```

Successful responses wrap results in `"data"`, and errors use `"error"` (chapter 5). The frontend always knows where to look.

### Three layers: routes → controller → service

One request passes through three files, each with **one job**:

```
Request: GET /api/tickets?status=open
   │
   ▼
tickets.routes.ts      "Which function handles GET /api/tickets?"         (the map)
   │
   ▼
tickets.controller.ts  "Read the query, check it's valid, send the reply" (the waiter)
   │
   ▼
tickets.service.ts     "Fetch the tickets from the database"              (the kitchen)
```

**Restaurant analogy:**
- The **menu** (routes) lists what you can order and who handles it.
- The **waiter** (controller) takes your order, checks it makes sense ("we don't have 'done' status, sir"), and brings the food back.
- The **kitchen** (service) cooks. It never talks to customers.

**Why split it?**
- **The service knows nothing about HTTP.** Later, a background job (e.g. "email managers about urgent tickets") can call `listTickets()` directly, with no fake request needed.
- **The controller has no SQL.** If the database code changes, the HTTP code doesn't.
- **Each file is small** and easy to find.

### Feature folders (`src/modules/tickets/`)

The files are grouped **by feature** instead of by type:

```
src/modules/tickets/          ← everything about tickets in one place
  tickets.routes.ts
  tickets.controller.ts
  tickets.service.ts
src/modules/properties/       ← later
src/modules/users/            ← later
```

The alternative is `routes/`, `controllers/`, `services/` folders, which spreads one feature across three places. Feature folders are what a **modular monolith** uses: one app, organized into self-contained modules. If a module ever needed to become its own service, it's already separated.

### The service: the query

```ts
db.select().from(tickets)
  .where(and(
    eq(tickets.organizationId, organizationId),           // ALWAYS: the tenant boundary
    options.status ? eq(tickets.status, options.status) : undefined,  // optional filter
  ))
  .orderBy(desc(tickets.createdAt), desc(tickets.id))
  .limit(options.limit);
```

- **The organization filter is never optional.** It's what stops Hostel A seeing Hostel B's tickets.
- `and()` **skips `undefined`**, which is a neat way to make a filter optional.
- **`desc(tickets.id)` as a tie-breaker.** If two tickets have the exact same `createdAt`, the order could change between requests. Adding a second sort column makes it **stable**: always the same order.
- This query uses the `idx_tickets_org_status` index from chapter 10.

### The controller: validating input

**Never trust input from a request.** Anyone can type any URL.

```ts
function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT;            // not given → 20
  const limit = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, "VALIDATION_ERROR", `limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}
```

- `raw` is typed **`unknown`**, because query values can be a string, an array (`?limit=1&limit=2`), or missing. `unknown` forces us to check before using it.
- `/^\d+$/` means "only digits", which rejects `abc`, `1.5`, `-3`.
- **Why a maximum (50)?** Without one, `?limit=1000000` could make the server load a million rows: slow for everyone, and an easy attack.
- Bad input gives a **400** with a clear message, and the error handler from chapter 5 formats it.

`parseStatus` checks the value against `TICKET_STATUSES`, **the same list `schema.ts` uses** (chapter 19). One list, used everywhere.

Later, the **Zod** library will replace these hand-written checks. Writing them by hand first shows what Zod does.

> **Update (chapter 22):** these hand-written checks were replaced by Zod, and the `X-Organization-Id` header below was replaced by `X-User-Id`.

### The temporary organization header ⚠️

The API needs to know **which organization** is asking. That should come from a **verified login**, which doesn't exist yet (Phase 3).

For now, `src/middleware/auth.ts` reads an `X-Organization-Id` header:

```bash
curl -H "X-Organization-Id: db8896ac-…" localhost:3000/api/tickets
```

**This is not secure.** Anyone can send any header and see any organization's tickets. So:
- It's **clearly marked TEMPORARY** in the code.
- It **refuses to work in production** (`NODE_ENV=production` always returns 401).
- In Phase 3, the organization will come from the logged-in user, and the header will be deleted.

It puts the result on `req.auth`, and the controller reads it with `getAuth(req)`. When real login arrives, **only the middleware changes**. The controller and service stay the same.

**TypeScript trick (declaration merging):** Express's `Request` type doesn't have an `auth` property, so we **add one**:

```ts
declare global {
  namespace Express {
    interface Request { auth?: AuthContext; }
  }
}
```

### Small things worth knowing

- **Express 5's `Router`** is a mini-app for one feature: `ticketsRouter.get("/", …)`, mounted with `app.use("/api/tickets", ticketsRouter)`, answers `GET /api/tickets`.
- `ticketsRouter.use(requireOrganization)` runs the check for **every** ticket route, so it can't be forgotten on a new one.
- The `npm audit` warning (4 moderate) is an old `esbuild` inside `drizzle-kit`. It affects esbuild's development web server, which we never run, and is development-only. Worth reading what an audit warning actually affects before panicking.

---

## 21. Automated tests

### Why test?

Without tests, the only way to know the API works is to try it by hand after every change. That gets slow and easy to forget. **Automated tests** check it in about 2 seconds with `npm test`.

**The most important test** in this project:

```ts
it("only returns tickets from the caller's organization", async () => {
  const a = await createOrg("a");
  const b = await createOrg("b");
  await createTicket(a, { title: "A's ticket" });
  await createTicket(b, { title: "B's ticket" });

  const res = await request(app).get("/api/tickets").set("X-Organization-Id", a.org.id);

  expect(res.body.data.map((t) => t.title)).toEqual(["A's ticket"]);
});
```

If anyone ever breaks the organization filter, **this test fails immediately**, before the bug reaches real users.

### The tools

| Tool | Job |
|---|---|
| **Vitest** | Runs the tests and reports pass or fail |
| **Supertest** | Sends fake HTTP requests to the app, with no real server or port needed (this is why `createApp()` was split out in chapter 3) |

### The shape of a test: Arrange, Act, Assert

Every test follows the same three steps:

```ts
it("filters by status", async () => {
  // Arrange: set up the situation
  const a = await createOrg("a");
  await createTicket(a, { title: "open one" });
  await createTicket(a, { title: "resolved one", status: "resolved" });

  // Act: do the thing being tested
  const res = await request(app).get("/api/tickets?status=resolved").set("X-Organization-Id", a.org.id);

  // Assert: check the result
  expect(res.status).toBe(200);
  expect(res.body.data.map((t) => t.title)).toEqual(["resolved one"]);
});
```

- `describe(...)` groups related tests.
- `it(...)` is one test, named as a sentence: "it filters by status".
- `expect(x).toBe(y)` means "x must equal y, or the test fails".
- `it.each(["0", "51", "abc", "1.5"])` runs the **same test with different inputs**, giving 4 tests from one block.

### A separate test database

Tests create and delete data constantly. **They must never touch the real database.**

1. **`tests/global-setup.ts`** runs once before all tests. It **deletes and recreates** a database called `fixflow_test`, then runs the Drizzle migrations on it. Every run starts from exactly the schema in `drizzle/`, which also proves the migrations work.
2. **`vitest.config.ts`** sets `DATABASE_URL` to `fixflow_test` for the tests, so the app connects there.
3. **`beforeEach(resetDatabase)`** empties all tables before **each** test (`TRUNCATE`), so tests can't affect each other.
4. **Safety net:** `resetDatabase()` first checks `current_database()` and **refuses** to wipe anything that isn't `fixflow_test`.

**Integration tests vs unit tests:**
- A **unit test** checks one small function on its own, with no database.
- An **integration test** checks several parts working together: HTTP, then controller, service, Drizzle, and a real PostgreSQL.

Ours are integration tests. They're a bit slower but catch far more real bugs, like a wrong SQL query or a missing index name.

### Test helpers

`tests/helpers.ts` has small functions that create test data:

```ts
const a = await createOrg("a");                        // org + resident + property
await createTicket(a, { title: "x", status: "resolved" });  // ticket with overrides
```

Tests stay short and readable, and focus on **what's different** in each one.

### Does the test actually work? Break the code on purpose

A test that always passes is useless. To check the tests, I **deleted the organization filter** from the service, simulating a serious security bug, and ran them:

```
× only returns tickets from the caller's organization
Tests  1 failed | 12 passed (13)
```

The right test caught it. After restoring the code, all 13 passed again. **Make it a habit:** when you write a test, briefly break the code to see the test fail. (Doing this systematically is called **mutation testing**.)

### Build vs type-check: two tsconfig files

- **`tsconfig.json`** is used by VS Code and `npm run typecheck`. It checks **everything**: `src/`, `tests/`, config files.
- **`tsconfig.build.json`** is used by `npm run build`. It compiles **only `src/`** into `dist/`, so tests never ship to production.

### Commands

```bash
npm test             # run all tests once
npm run test:watch   # re-run tests automatically when you save a file
```

---

## 22. Validation with Zod, GET one ticket, create a ticket

### What was added

```
GET  /api/tickets/:id   → one ticket
POST /api/tickets       → create a ticket
```

Plus three supporting changes: **Zod** for validation, a better temporary login header, and 16 new tests (29 in total).

### Part 1: Zod, describing what valid input looks like

In chapter 20 we wrote checks by hand: "is it a string? only digits? between 1 and 50?". That works, but gets long and repetitive. **Zod** lets you **describe the shape of valid data**, and it does all the checking for you.

**Analogy:** instead of a guard asking each visitor ten separate questions, you give the guard a **photo of what a valid ID card looks like**. Anything that doesn't match is turned away.

`src/modules/tickets/tickets.schemas.ts`:

```ts
export const createTicketBody = z.strictObject({
  propertyId:  z.uuid(),                                  // must be a UUID
  title:       z.string().trim().min(1).max(200),         // trim spaces, 1–200 chars
  description: z.string().trim().max(5000).optional(),    // may be left out
  priority:    z.enum(TICKET_PRIORITIES).optional(),      // one of low/medium/high/urgent
});
```

Read it like a sentence: *"a propertyId that's a UUID, a title that's a string with spaces trimmed, between 1 and 200 characters…"*

**The query parameters from chapter 20, now in Zod:**

```ts
export const listTicketsQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
});
```

- **`z.coerce.number()`**: everything in a URL is text, so `?limit=20` arrives as the **string** `"20"`. `coerce` converts it to the **number** `20` first, then checks it.
- **`.default(20)`** is used if `limit` isn't given.
- I tested the tricky inputs before using it: `"0"`, `"51"`, `"abc"`, `"1.5"`, `""`, and `?limit=1&limit=2` (an array) are all rejected.

**Types for free:** `z.infer` turns a schema into a TypeScript type, so the rules and the type can never disagree:

```ts
export type CreateTicketBody = z.infer<typeof createTicketBody>;
// → { propertyId: string; title: string; description?: string; priority?: "low" | ... }
```

### Part 2: one `validate()` helper for everything

`src/lib/validate.ts`:

```ts
export function validate(schema, input, label) {
  const result = schema.safeParse(input);       // check without throwing
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),               // which field
      message: issue.message,                   // what's wrong
    }));
    throw new HttpError(400, "VALIDATION_ERROR", `Invalid ${label}`, details);
  }
  return result.data;                           // the cleaned, typed value
}
```

In a controller it's one line:

```ts
const body = validate(createTicketBody, req.body, "request body");
// from here on, `body` is fully checked AND typed
```

**All problems are reported at once**, each tied to its field:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body", "details": [
  { "path": "propertyId", "message": "Invalid input: expected string, received undefined" },
  { "path": "title",      "message": "Too small: expected string to have >=1 characters" },
  { "path": "priority",   "message": "Invalid option: expected one of \"low\"|\"medium\"|\"high\"|\"urgent\"" },
  { "path": "",           "message": "Unrecognized key: \"status\"" }
]}}
```

A frontend can put each message next to the right form field.

**`result.data` is the cleaned version**: `"   Broken door   "` becomes `"Broken door"` and `"20"` becomes `20`. Always use the parsed value, never the raw `req.body`.

### Part 3: `strictObject`, don't let clients set what the server controls

A ticket's `organizationId`, `createdBy`, `status` and `assignedTo` must be set **by the server**, never by the client. What if someone sends:

```json
{ "propertyId": "…", "title": "Sneaky", "organizationId": "<another org>", "status": "closed" }
```

- `z.object()` would **silently drop** the extra fields. That's safe, but the client never learns they were ignored.
- **`z.strictObject()` rejects the request** with "Unrecognized key". It's safe *and* clear.

Even without this, the service never copies those fields from the request: it uses the organization and user from `req.auth`. Two layers of protection.

This attack has a name: **mass assignment**, when a server blindly saves whatever fields the client sends.

### Part 4: the better temporary login header

`POST` needs `createdBy`, meaning **who** created the ticket. The old header only gave the organization. So `X-Organization-Id` was replaced with **`X-User-Id`**:

```
Before:  client says "I'm from organization X"   → server believes it
After:   client says "I'm user Y"                → server LOOKS UP user Y in the database
                                                   → organization and role come from the user's own row
```

```ts
const [user] = await db.select({ id: users.id, organizationId: users.organizationId, role: users.role })
  .from(users).where(eq(users.id, parsed.data));
if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Unknown user");
req.auth = { userId: user.id, organizationId: user.organizationId, role: user.role };
```

**Why this is better:** the organization is now **derived on the server** from trusted data, which is exactly how real login will work. In Phase 3, "user Y" will come from a verified login token instead of a header, and **only this one file changes**.

**Still not secure:** anyone can claim to be any user by sending their id. So it's still marked ⚠️ TEMPORARY and disabled in production.

`req.auth` now also has `role`, ready for Phase 3's permission rules (e.g. "only managers can assign tickets").

### Part 5: `GET /api/tickets/:id`, and why 404 instead of 403

```ts
const ticket = await getTicket(organizationId, id);   // WHERE id = ? AND organization_id = ?
if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
```

If a user from Hostel A asks for a ticket that belongs to Hostel B, there are two possible answers:
- **403 Forbidden**: "that exists, but you can't see it". This **leaks information**: it confirms the ticket exists.
- **404 Not Found**: "no such ticket". The same answer as for a ticket that really doesn't exist.

We use **404**, so outsiders can't even discover which tickets exist. The query does this naturally: by searching with **both** the id and the organization, another organization's ticket simply isn't found.

`:id` in the route is a **URL parameter**: `/api/tickets/abc-123` gives `req.params.id === "abc-123"`. It's validated as a UUID too, so `/api/tickets/123` gives a 400, not a database error.

### Part 6: `POST /api/tickets`, creating a ticket

The steps:
1. `requireUser` works out **who** is asking (user, organization, role).
2. Zod checks the body.
3. The service checks the **property belongs to the caller's organization**.
4. It inserts the ticket, with `organizationId` and `createdBy` from `req.auth`, never from the body.
5. It replies **201 Created**, with a `Location` header pointing at the new ticket.

```ts
res.status(201).location(`/api/tickets/${ticket.id}`).json({ data: ticket });
```

- **201** (not 200) means "a new thing was created".
- The **`Location`** header tells the client where to find it: `/api/tickets/<new id>`.
- Leaving out `priority` lets the **database default** (`'medium'`) apply, so the default lives in one place.

### Part 7: defense in depth

The service checks that the property belongs to the caller's organization. But the database **also** checks this, with the composite foreign key from the baseline. Why both?

During the "break it on purpose" test, I deleted the service's check. The result:
- **The database still blocked the cross-organization ticket** (`violates foreign key constraint "tickets_property_id_organization_id_fkey"`). No bad data was saved.
- **But the client got a 500** ("something broke") instead of a clear 400 ("Property not found").

| Layer | Job |
|---|---|
| App check (service) | Gives the client a **clear, helpful error** |
| Database rule (foreign key) | The **last line of defense**, even if the app has a bug |

**Defense in depth** means several independent layers of protection, so one mistake doesn't cause a disaster. Like a house with a lock on the door **and** an alarm.

### Part 8: testing the tests again, with three bugs

| Deliberate bug | Test that caught it |
|---|---|
| `GET /:id` forgets the organization filter | "returns 404 for another organization's ticket" |
| `POST` skips the property ownership check | "rejects a property from another organization and saves nothing" |
| `strictObject` changed to `object` | "rejects fields the server controls" |

Each bug was caught by **exactly one** test, the one written for it, and everything passed again after restoring the code.

Two test techniques worth noticing:
- **Checking nothing was saved:** `expect(await db.select().from(tickets)).toHaveLength(0)`. A rejected request must leave the database untouched.
- **Checking nothing leaked:** `expect(JSON.stringify(res.body)).not.toContain("B's secret ticket")`.

### HTTP status codes used so far

| Code | When |
|---|---|
| 200 | Got the data |
| 201 | Created a ticket |
| 400 | Invalid input (with `details`) |
| 401 | No user, or unknown user |
| 404 | No such route or ticket, including other organizations' tickets |
| 413 | Body too large |
| 500 | Unexpected bug |
| 503 | Database unreachable |

---

## 23. Assignment, status workflow, history and race conditions

### What was added

```
PATCH /api/tickets/:id/assign    { technicianId }   → manager assigns a technician
PATCH /api/tickets/:id/status    { status }         → move the ticket along the workflow
GET   /api/tickets/:id/history                      → everything that happened, oldest first
```

Plus a new database table (`ticket_events`), a permissions file (`tickets.policy.ts`), and 51 new tests (80 in total).

### Part 1: the workflow is a state machine

A ticket is always in **exactly one status**, and can only move along certain arrows:

```
open ──assign──▶ assigned ──start──▶ in_progress ──resolve──▶ resolved ──close──▶ closed
                 (reassign ok)                         ▲                │
                                                       └────reopen──────┘
```

This is called a **state machine**: a fixed set of states plus the allowed moves between them. **Analogy:** a traffic light can go green → yellow → red → green, but never green → red directly.

Without it, anyone could set any status: a ticket could jump from `open` straight to `closed` without anyone doing the work, or a `closed` ticket could be changed again.

### Part 2: the rules live in one file (`tickets.policy.ts`)

```ts
const TRANSITIONS = {
  assigned:    { in_progress: isAssignee },
  in_progress: { resolved: isAssignee },
  resolved:    { closed: isCreatorOrManager, in_progress: isCreatorOrManager },
};
```

Read it as: *"from `assigned` you may go to `in_progress`, if you're the assignee"*. **If a move isn't in the table, it's not allowed for anyone.**

The rules are tiny functions:

```ts
const isManager = (auth) => auth.role === "manager" || auth.role === "admin";
const isAssignee = (auth, ticket) => ticket.assignedTo === auth.userId;
const isCreatorOrManager = (auth, ticket) => ticket.createdBy === auth.userId || isManager(auth);
```

**Why a separate file?**
- **All the "who can do what" rules are in one place.** To change a rule (e.g. "technicians can close tickets too"), you edit one line.
- **They're pure functions:** given the same input, always the same answer, with no database and no HTTP. That makes them easy to understand and **easy to test**.
- Separating the *decision* (policy) from the *action* (service) is a common pattern called a **policy** or **authorization layer**.

### Part 3: 409, 403, 404, 400, choosing the right error

When a status change fails, the **reason** decides the code:

| Situation | Code | Example |
|---|---|---|
| Ticket doesn't exist or is in another organization | **404** | Hostel A asks about Hostel B's ticket |
| Body is malformed | **400** | `{ "status": "done" }`, which isn't a real status |
| That move doesn't exist in the state machine | **409** `INVALID_TRANSITION` | `open → resolved` |
| The move exists, but **you** may not make it | **403** `FORBIDDEN` | A resident tries `assigned → in_progress` |
| Someone else changed the ticket at the same moment | **409** `CONFLICT` | Two people click "resolve" together |

- **409 Conflict** means "your request is valid, but clashes with the current state of the thing".
- **403 Forbidden** means "I know who you are, and you're not allowed".
- The checks run in that order: 404 first, so outsiders learn nothing, then 409 or 403.

### Part 4: the history table (`ticket_events`)

Every change writes **one row** describing what happened:

| type | actor | from | to |
|---|---|---|---|
| created | resident | – | open |
| assigned | manager | open | assigned |
| status_changed | technician | assigned | in_progress |
| status_changed | technician | in_progress | resolved |
| status_changed | resident | resolved | closed |

- **Append-only:** rows are only ever **added**, never changed or deleted. History you can edit isn't history. Like a bank statement: mistakes are fixed with a new entry, not by rubbing out the old one.
- This kind of record is called an **audit log** (or audit trail). It answers "who did what, and when?", which matters for disputes ("I reported this 2 weeks ago!") and for security.
- It uses the same safety patterns as `tickets`: composite foreign keys, so an event can never point at another organization's ticket or user, and an index for "show this ticket's history".
- **Your real ticket has no history rows**, because it was created before this table existed. Only changes from now on are recorded.

**The migration** followed the Drizzle workflow from chapter 19: edit `schema.ts` → `npm run db:generate` → **read the SQL** (only a new table, nothing existing touched) → tested on the test database → `--status` on the real one → apply → verify.

### Part 5: transactions, the change and its history together

```ts
return db.transaction(async (tx) => {
  const [updated] = await tx.update(tickets).set({ status: to }).where(...).returning();
  if (!updated) throw CONFLICT();
  await tx.insert(ticketEvents).values({ ... });
  return updated;
});
```

The status change and its history row are saved **together or not at all** (chapter 12). Without a transaction, a crash between the two lines could leave a ticket marked `resolved` with no record of who resolved it. Throwing an error inside `db.transaction()` automatically **rolls back** everything in it.

### Part 6: race conditions and optimistic concurrency ⭐

**The problem:** two requests arrive at the same moment, for example the technician double-clicks "resolve":

```
Request A: read ticket → status is in_progress ✓ rules OK
Request B: read ticket → status is in_progress ✓ rules OK
Request A: UPDATE status = resolved   → saved, history row written
Request B: UPDATE status = resolved   → saved AGAIN, a second history row!
```

Both passed the check, because both read the ticket **before** either changed it. This is a **race condition**: the result depends on the exact timing. Worse versions: a manager reassigns the ticket while the old technician is resolving it.

**The fix, optimistic concurrency:** make the UPDATE itself check that nothing changed since we read it:

```ts
// UPDATE tickets SET status = 'resolved'
// WHERE id = ? AND organization_id = ? AND status = 'in_progress' AND assigned_to = ?
//                                         ▲ the status we saw     ▲ the assignee we saw
```

If someone else changed the ticket in between, the WHERE no longer matches, **zero rows are updated**, and we return **409 CONFLICT** ("reload and try again") instead of silently overwriting their change.

**Why "optimistic"?** We *assume* conflicts are rare, so we don't lock anything up front; we just detect a conflict at the last moment. The alternative, **pessimistic** locking, locks the row first (`SELECT … FOR UPDATE`), so others must wait. Optimistic is simpler and faster when conflicts are rare, as they are here.

**Analogy:** two people editing the same Google Doc paragraph. Instead of locking the doc, the second save says "this changed since you opened it".

**How PostgreSQL makes it work:** when request B's UPDATE waits for request A's to finish, PostgreSQL **re-checks B's WHERE against the new version of the row**. The status is now `resolved`, not `in_progress`, so it doesn't match, and B updates zero rows.

### Part 7: testing a race, and a test that lied

My first race test simply sent two requests at once with `Promise.all`. It passed. Then, in the "break it on purpose" round, I **removed** the concurrency check… and the test **still passed, 10 out of 10 times**. The test was useless: the two requests never actually overlapped, because the first always finished before the second even read the ticket.

**The fix was to force the race deterministically** with a database lock:

```ts
await lock.query("BEGIN");
await lock.query("SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE", [ticket.id]);  // 1. lock the row
const pending = Promise.all([setStatus(...), setStatus(...)]);                     // 2. both read + pass rules,
await waitForQueriesBlockedOnLocks(2);                                              //    then both wait at UPDATE
await lock.query("COMMIT");                                                          // 3. release: one wins
```

Reading isn't blocked by the lock, so both requests see `in_progress` and pass the rules. Then both get stuck at their UPDATE. Releasing the lock creates the race **every single time**. The helper watches PostgreSQL's `pg_stat_activity` view until both queries are waiting.

Results:

| Code | Race test (×10) |
|---|---|
| Correct | ✅ 10/10 pass: one 200, one 409 `CONFLICT`, one history row |
| Concurrency check removed | ❌ 10/10 fail: **200 and 200**, the second silently overwrote |

**Lesson:** a passing test proves nothing until you've seen it fail. Breaking the code on purpose found a test that looked fine but tested nothing.

### Part 8: unit tests, finally

`tests/tickets.policy.test.ts` tests the rules **directly**, with no database and no HTTP:

```ts
const rule = findTransition("assigned", "in_progress")!;
expect(rule(assignee, ticket)).toBe(true);
expect(rule(otherTech, ticket)).toBe(false);
expect(rule(manager, ticket)).toBe(false);
```

These run in milliseconds and pinpoint exactly which rule broke. Pure functions (Part 2) are what make this possible. Combined with the integration tests, which check that the rules are actually **used** by the API, you get both speed and confidence.

The "break it on purpose" results for the rules:

| Deliberate bug | Caught by |
|---|---|
| Any technician counts as "the assignee" | 3 tests (unit + integration) |
| Service forgets to check who can assign | "forbids a resident/technician from assigning" |
| Any resident can close any ticket | 3 tests (unit + integration) |
| No concurrency check | the race test (after fixing it, Part 7) |

### Small things worth knowing

- **Test data per role:** `createOrg()` now creates a resident, a second resident, two technicians, a manager and an admin, so every permission rule can be tested.
- `it.each([...])` turned 5 "forbids" cases into 5 tests from one block.
- **`satisfies`** (in `ASSIGNABLE_STATUSES … satisfies readonly TicketStatus[]`) checks a value matches a type **without changing** its type. A typo like `"opne"` is caught.
- **Not done yet (Phase 3):** residents can currently see *every* ticket in their organization. Real visibility rules, like "residents see only their own tickets" and "technicians see their assigned ones", come with real authentication.

---

## 24. Real authentication: passwords, login and sessions

### What changed

The temporary `X-User-Id` header is **gone**. Anyone could pretend to be anyone with it. Now:

```
POST /api/auth/login   { organization, email, password }  → { token, expiresAt, user }
GET  /api/tickets      Authorization: Bearer <token>       → only works with a valid token
POST /api/auth/logout                                      → token stops working
GET  /api/auth/me                                          → who am I?
```

Plus `npm run user:set-password` to give a user a password from the terminal.

**Authentication vs authorization**, two words that are easy to mix up:
- **Authentication** = *who are you?* (this chapter: passwords, login, sessions)
- **Authorization** = *what are you allowed to do?* (chapter 23's policy rules)

Everything from chapters 20–23 kept working **unchanged**, because the controllers only ever read `req.auth`. Only the middleware that *fills in* `req.auth` changed, exactly as planned in chapter 20.

### Decisions made (and why)

| Question | Choice | Why |
|---|---|---|
| How does a logged-in user prove who they are? | **Server-side sessions** | Logout works instantly (delete a row). JWTs can't be cancelled before they expire without extra machinery |
| How does login identify the user? | **Org slug + email + password** | Emails are only unique per organization, like Slack workspaces |
| How does the first user get a password? | **CLI script** with a hidden prompt | The password never touches shell history, code, or chat |
| Password hashing? | **scrypt**, built into Node | Recommended by OWASP, no extra package to install |
| Where does the token go? | `Authorization: Bearer` header | Cookies need CSRF protection, which matters once the browser frontend exists |

### Part 1: never store passwords, store hashes

**A hash** is a one-way scramble: easy to compute from the password, practically impossible to reverse.

```
"correct horse battery staple"  ──scrypt──▶  scrypt$32768$8$3$<salt>$<hash>
```

At login we hash what the user typed **the same way** and compare. The real password is never stored anywhere.

**Why a *slow* hash?** If an attacker steals the `users` table, they'll try billions of guesses offline. A normal hash like SHA-256 can be computed **billions of times per second**. **scrypt** is deliberately slow (~180 ms here) and needs 32 MB of memory per guess, which slows an attacker down by a factor of millions. 180 ms is nothing for one login, but enormous for a billion guesses.

**Salt:** a random value mixed into each password before hashing. Two users with the same password get **completely different hashes**, so an attacker can't crack everyone at once, or use pre-computed tables of common passwords ("rainbow tables").

```ts
const first = await hashPassword(PASSWORD);
const second = await hashPassword(PASSWORD);
expect(first).not.toBe(second);   // same password, different salt → different hash
```

**The stored format keeps the settings with the hash:** `scrypt$N$r$p$salt$hash`. If we raise the cost later, old hashes still verify with their old settings.

**Constant-time comparison:** `timingSafeEqual(actual, expected)` takes the same time whether 0 or 63 of the 64 bytes match. A normal `===` stops at the first difference, which leaks tiny timing clues.

**Password rules:** at least **12 characters**, at most 128. No "must contain a symbol" rules: **length matters far more**, and passphrases like `correct horse battery staple` are both stronger and easier to remember (this is current NIST guidance). The maximum stops someone sending a 10 MB "password" to waste server time.

### Part 2: sessions, the "wristband" after login

Checking a password takes ~180 ms on purpose, which is far too slow to do on **every** request. So after a successful login, the server gives the user a **session token**: a long random string they send with each request instead.

**Analogy:** at a festival you show your ID **once** at the gate, and get a **wristband**. After that, security just checks the wristband.

```ts
const token = randomBytes(32).toString("base64url");   // 43 random characters
```

- **32 random bytes** = 2²⁵⁶ possibilities. Guessing one is impossible.
- **Stored as a hash, never as-is.** The `sessions` table holds `sha256(token)`. If someone steals a database backup, they get hashes, which can't be used to log in.
- **Why is SHA-256 OK here but not for passwords?** Passwords are short and guessable, so they need a slow hash. Tokens are already completely random, so there's nothing to guess, and a fast hash is fine.
- **Expires after 7 days.** The lookup checks `expires_at > now()`.
- **Logout deletes the row**, so the token stops working **immediately**. This is the big advantage over JWTs.
- **Each login is a separate session.** Logging out on your phone doesn't log out your laptop. Changing your password **does** delete all of them ("log out everywhere"), in case someone else had your password.

**Every request now:**
```
Authorization: Bearer abc123…
     │
     ▼  requireUser middleware
sha256("abc123…") → look up in sessions (JOIN users) → not expired?
     │
     ▼
req.auth = { sessionId, userId, organizationId, role }   ← from the database, never from the client
```

### Part 3: login, revealing nothing to attackers

**One error message for every failure:**

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Incorrect organization, email or password" } }
```

Wrong password, unknown email, unknown organization, a user from another organization, a user with no password yet: **all get exactly the same answer**. If the message said "no such email", attackers could test a list of emails to find real accounts. This is called **user enumeration**.

**Equal timing too.** The message isn't the only clue: **response time** can leak information as well. A wrong password takes ~180 ms (hashing), but an unknown email could return in ~1 ms (no hash to check). So for unknown users we **hash against a dummy** anyway. I measured it:

| | Wrong password | Unknown email |
|---|---|---|
| With the dummy hash | ~181 ms | ~181 ms ✅ |
| Without it | ~181 ms | **~1 ms** ❌ (giveaway) |

Timing is hard to test automatically, because results vary between runs and the test would be flaky, so this was **measured by hand** and documented here instead.

**Emails are case-insensitive:** `Me@Example.com` and `me@example.com` log into the same account.

**Security logging:** each failed login writes a line on the server: `Failed login: org=… reason=unknown_user ip=…`. The *real* reason is recorded for us (to spot attacks), but never sent to the client, and **the password is never logged**.

### Part 4: the CLI script and hidden input

```bash
npm run user:set-password -- --org NMIT-Campus --email you@example.com
New password: ••••••••••••   (nothing shows as you type)
Repeat password:
```

**Why not pass the password as an argument** (`--password secret`)? Command lines are saved in **shell history** (`~/.zsh_history`) and visible to other programs on the machine while they run. A hidden prompt avoids both.

How the hidden prompt works: the terminal is switched to **raw mode**, so key presses go to our program **without being displayed**. We collect characters until Enter, handle Backspace and Ctrl+C, then switch raw mode off again. The script refuses to run without a real terminal, rather than reading a password insecurely.

The actual work (`setUserPassword`) lives in the auth service, so it's **tested like everything else**. The script is just a thin wrapper.

### Part 5: the migration

```sql
CREATE TABLE "sessions" (...);
ALTER TABLE "users" ADD COLUMN "password_hash" text;
```

**Is adding a column to a table with data safe?** Yes, when the column **allows NULL and has no default**. PostgreSQL just records "this column exists", existing rows read it as NULL, and nothing is rewritten. `NULL` here means "this user can't log in yet", which is exactly true for your existing user until they run the script.

### Part 6: testing it, and breaking it on purpose

Test users now get **real session tokens**. `createOrg()` logs each user in, so every ticket test goes through the real `requireUser` check:

```ts
request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" })
```

Test users **don't** get passwords by default. Hashing 6 passwords for every test would make the suite very slow. Only the login tests hash one.

| Deliberate bug | Caught by |
|---|---|
| Expired sessions still accepted | "reject an expired session" |
| Login error says *why* it failed | 5 "gives the same 401" tests |
| Token stored as-is instead of hashed | "stores only a hash of the token" |
| Logout doesn't delete the session | "ends the session so the token stops working" |
| Password change doesn't log out other devices | "logs the user out everywhere" |
| No dummy hash for unknown users | **No automated test.** Measured by hand (Part 3) |

**Lesson:** not everything can be tested automatically. When a test would be unreliable, measure it, write down how, and keep the protection simple enough to check by reading.

### Still to do (security)

- **Rate limiting on login:** nothing yet stops an attacker trying thousands of passwords against one account. The slow hash helps, but a limit like "5 attempts per minute" is still needed. *(next)*
- **Visibility rules:** residents still see all tickets in their organization. *(next)*
- **Least-privilege database user:** the app still connects as `postgres`.
- **Cleaning up expired sessions:** expired rows stay in the table (harmless, since they're rejected) until a background job deletes them.
- **Cookies** for the browser frontend, with CSRF protection.

---

## 25. Login rate limiting and ticket visibility

Two security gaps from chapter 24, now closed:
1. **Rate limiting:** nothing stopped an attacker from trying thousands of passwords.
2. **Visibility:** every resident could see every ticket in their organization.

### Part 1: rate limiting, "too many attempts, try later"

**The attack:** an attacker picks an account and tries passwords one after another. The slow hash (chapter 24) means each guess costs ~180 ms, but nothing stopped them trying forever. This is called a **brute-force attack**.

**The fix:** count failed attempts, and after too many, refuse to even check for a while.

**Analogy:** your phone after 5 wrong PINs: "Try again in 15 minutes."

### Two limits, two attacks

| Limit | Counts | Stops |
|---|---|---|
| **Per account** (org + email) | 5 **failed** attempts per 15 min | Guessing many passwords for **one** account |
| **Per IP address** | 20 attempts (any result) per 15 min | One machine trying **one common password** (like `password123`) against **many** accounts |

The second attack is called **password spraying**. It avoids per-account limits by trying each account only once or twice. The IP limit catches it.

When blocked, the response is:

```
HTTP 429 Too Many Requests
Retry-After: 900

{ "error": { "code": "TOO_MANY_ATTEMPTS", "message": "Too many login attempts. Try again in 15 minutes." } }
```

- **429** is the HTTP code for "slow down".
- **`Retry-After`** tells the client how many seconds to wait, so an app can show a countdown.

### The order of checks matters

```ts
// 1. Blocked?  → refuse immediately (even if the password is right!)
const waitMs = Math.max(loginLimits.account.retryAfterMs(account), loginLimits.ip.retryAfterMs(ip));
if (waitMs > 0) throw new HttpError(429, ...);

// 2. Count this attempt against the IP
loginLimits.ip.hit(ip);

// 3. Only now check the password
const result = await login(organization, email, password);
if (!result.ok) loginLimits.account.hit(account);   // count the failure
else loginLimits.account.reset(account);            // success clears the count
```

**Why refuse a correct password while blocked?** Otherwise the attacker could keep guessing: a 429 would mean "wrong", and a 200 would mean "found it!". The block has to apply **whatever the password is**. It also saves the server from doing the expensive hash for blocked attempts.

**Accounts that don't exist are limited the same way.** If only real accounts got blocked, "429 after 5 tries" would reveal that an account exists (chapter 24's *user enumeration* again).

**Email case:** `Me@x.com` and `me@x.com` count as the **same** account, otherwise an attacker could get 5 extra guesses per capitalization.

### How the limiter works: a fixed window

`src/lib/rate-limiter.ts` keeps, for each key, a **count** and **when the window ends**:

```
key "org\nme@x.com":  count 3, window ends at 10:15
```

- The first attempt starts a 15-minute window.
- Each attempt adds 1.
- At the limit, it's blocked until the window ends.
- When the window ends, the count starts from zero.

**Fake clock for testing:** the limiter takes a `now()` function. Real code uses the real clock; tests pass a fake one they can move forward instantly:

```ts
const clock = { now: 0 };
const limiter = new FixedWindowLimiter(1, 1000, () => clock.now);
limiter.hit("k");
clock.now = 1000;          // "wait" one second, in zero real time
expect(limiter.retryAfterMs("k")).toBe(0);
```

This is called **dependency injection**: giving code the things it depends on (here, the clock) from outside, so tests can swap them.

**Memory clean-up:** finished windows are deleted every minute (`prune()`), so the counts can't grow forever. `setInterval(...).unref()` means this timer won't keep the program running on its own.

### The tradeoff: memory vs Redis

The counts are kept **in the server's memory**:

| | In memory (now) | Redis (later) |
|---|---|---|
| Setup | Nothing extra | Needs a Redis server |
| Server restart | Counts reset | Counts kept |
| Several servers | Each has its own counts (an attacker gets 5 tries **per server**) | Shared |

With one server, memory is fine. The limiter's methods (`hit`, `retryAfterMs`, `reset`) stay the same when moving to Redis; only the storage changes. Redis is planned with background jobs.

### Known limitation: lockout as a weapon

An attacker who knows your email can **deliberately** fail 5 times to lock *you* out for 15 minutes. This is a real tradeoff of account limits. It's kept short (15 minutes, not permanent) to limit the damage. Bigger systems add CAPTCHAs or email unlock links.

### Part 2: visibility, "who sees which tickets"

Before, any user could see **every** ticket in their organization. A resident could read other residents' reports. Now:

| Role | Sees |
|---|---|
| Resident | Tickets **they created** |
| Technician | Tickets **assigned to them** |
| Manager, admin | **Every** ticket in the organization |

### One rule, written once, used everywhere

The rule is **data**, in `tickets.policy.ts`:

```ts
const VISIBLE_BY_ROLE: Record<UserRole, TicketScope> = {
  resident: "createdBy",     // tickets where createdBy = me
  technician: "assignedTo",  // tickets where assignedTo = me
  manager: "all",
  admin: "all",
};
```

`Record<UserRole, …>` means **TypeScript forces an entry for every role**. If someone adds a new role later and forgets to decide its visibility, the code won't compile.

Two things are built from that one table:
- **`canViewTicket(auth, ticket)`**: a yes/no check, unit-tested without a database.
- **`visibleTo(auth)`**: a SQL condition the service adds to **every** ticket query:

```ts
function visibleTo(auth) {
  const scope = ticketScope(auth);
  return and(
    eq(tickets.organizationId, auth.organizationId),                   // the tenant boundary
    scope === "all" ? undefined : eq(tickets[scope], auth.userId),     // the role boundary
  );
}
```

Because both come from the same table, they can't disagree.

### Hidden tickets return 404, everywhere

`visibleTo()` is used by the list, by `GET /:id`, by history, and by the assign and status endpoints (via `getTicketOr404`). So a ticket you can't see behaves **exactly like a ticket that doesn't exist**, the same rule as other organizations' tickets in chapter 22.

This changed two existing tests, for the better:

| Situation | Before | Now |
|---|---|---|
| Another technician tries to start work on someone else's ticket | 403 (exists, not allowed) | **404** (can't see it at all) |
| Another resident tries to close someone else's ticket | 403 | **404** |
| The manager tries to start work (can see it, not allowed) | 403 | 403 (unchanged) |

**The order of checks:** *can you see it?* (404), then *is the move valid?* (409), then *are you allowed?* (403). The first check means outsiders learn nothing.

**Access follows the data:** when a manager reassigns a ticket, the old technician **immediately** loses access and the new one gains it. Nothing is cached; every request asks the database.

### Part 3: testing, and the tests I got wrong

**Break it on purpose, round 6:**

| Deliberate bug | Caught by |
|---|---|
| Limit checked only after the password | "blocks an account… even with the right password" |
| Success doesn't clear failed attempts | "a successful login clears the failed attempts" |
| IP attempts not counted | "blocks an IP address after 20 attempts" |
| Email case not normalized | "treats the email case-insensitively" |
| Queries ignore the role (organization only) | 8 visibility tests |
| Technicians scoped by creator instead of assignee | 15 tests |

**Two mistakes of my own, caught along the way:**
1. **A check that silently checked nothing.** When I first ran bug 5, the output was **empty**: no failures, no passes. The shell command had passed both test files as one quoted name, so Vitest matched no tests at all. **Empty output is not a pass.** Always look for the "Tests N passed" line.
2. **An unreadable test name:** `a technician's scope is { sessionId: 's', … }`. In `it.each`, each `%s` takes the **next value in order**, and I had the values in the wrong order. Fixed by reordering, giving the readable `role technician → scope assignedTo`.

**Tests per layer now:**

| File | Kind | Tests |
|---|---|---|
| `rate-limiter.test.ts` | unit (fake clock) | 7 |
| `tickets.policy.test.ts` | unit (no database) | 31 |
| `auth.test.ts` | integration | 32 |
| `tickets.test.ts`, `tickets.workflow.test.ts`, `tickets.visibility.test.ts` | integration | 67 |
| **Total** | | **137** |

### Still to do (security)

- **Trust proxy:** behind a load balancer or reverse proxy, `req.ip` is the proxy's address, so every user would share one IP limit. When deploying, set Express's `trust proxy` setting to match the real setup.
- **Least-privilege database user** (the app still connects as `postgres`).
- **Cleaning up expired sessions** (background job).
- **Cookies with CSRF protection** for the browser frontend.

---

## 26. A least-privilege database user

> **Status:** done. The app connects as `fixflow_app`, and all 15 permission tests pass. (The manual set-up step was briefly postponed; while it was, the tests were reported as skipped. See the end of this chapter.)

### The problem

The app connects to PostgreSQL as **`postgres`**, a **superuser**. A superuser can do *anything*: drop every table, read every database on the server, create new users, even run programs on the server machine.

The app needs none of that. It only reads and writes a few kinds of rows. But if an attacker ever found a hole in the app (say, an SQL injection bug), they would inherit **everything** the app's database user can do.

### The principle: least privilege

> Give each part of a system **only the permissions it actually needs**, and nothing more.

**Analogy:** a hotel cleaner gets a key card that opens guest rooms on their floor, not the safe, the manager's office, or the other hotels in the chain. If the card is stolen, the damage is limited.

### Two database users, two jobs

| User | Used by | Can |
|---|---|---|
| `postgres` (owner) | migrations, schema tools, test setup | everything: create and alter tables |
| **`fixflow_app`** | the running app | only the exact reads and writes the app does |

They get two connection URLs: `DATABASE_ADMIN_URL` (owner) and `DATABASE_URL` (app).

### What `fixflow_app` may do

Migration `0004_app_role_grants.sql`:

```sql
GRANT SELECT ON organizations, properties TO fixflow_app;
GRANT SELECT ON users TO fixflow_app;
GRANT UPDATE (password_hash) ON users TO fixflow_app;       -- only this column!
GRANT SELECT, INSERT ON tickets TO fixflow_app;
GRANT UPDATE (status, assigned_to) ON tickets TO fixflow_app;
GRANT SELECT, INSERT ON ticket_events TO fixflow_app;       -- no UPDATE, no DELETE
GRANT SELECT, INSERT, DELETE ON sessions TO fixflow_app;
```

- **`GRANT`** gives a permission, and **`REVOKE`** takes it away.
- **Column-level grants:** `UPDATE (password_hash) ON users` means the app can change passwords but **can't** change anyone's `role`. Even with an SQL injection bug, an attacker couldn't promote themselves to admin.
- **History is truly append-only now.** Chapter 23 said `ticket_events` is "only ever added to", but that was just a promise in our code. Now **the database enforces it**: `UPDATE ticket_events` is refused. Another layer of defense in depth.
- **No default privileges.** New tables give the app **no access** until a migration grants it. If someone forgets, the app fails loudly with "permission denied" in the tests, rather than quietly having too much access. *Fail safe, not fail open.*

### Why the password isn't in the migration

The migration creates the role **without a password, with login disabled** (`NOLOGIN`). Migration files go to GitHub, and **passwords never belong in Git**. Since every connection requires a password (`scram-sha-256` in `pg_hba.conf`, checked first), a role without one simply can't log in.

The password is set by hand with **`\password fixflow_app`** in `psql`. psql **hashes it on your machine** before sending it, so the plain password never reaches the server, its logs, or your shell history. That's safer than `ALTER ROLE … PASSWORD '…'`, which sends the password as plain text inside the SQL.

### Generating a password for a URL

```bash
openssl rand -base64 24 | tr '+/' '-_' | tr -d '='
```

- `openssl rand -base64 24`: 24 random bytes, written as text.
- `tr '+/' '-_'`: swaps `+` and `/` for `-` and `_`, because `/` has a special meaning inside a URL.
- `tr -d '='`: removes padding `=` signs.

A password with `@`, `:` or `/` would confuse the URL `postgresql://user:password@host/db` unless it was carefully escaped (**URL-encoded**).

### How the tests change

- The **app under test** connects as `fixflow_app`, exactly like the real app, so a missing grant shows up as a failing test.
- **Test setup** (creating the test database, migrations, `TRUNCATE`, creating organizations and users) uses a separate **admin** connection, `adminDb` in `tests/helpers.ts`. Seeding test data is admin work, not something the app may do.
- **`tests/db-permissions.test.ts`** checks the role from the app's side: it must be **refused** for 13 dangerous operations (drop, truncate, create or alter a table, read the migration log, create users, change roles, delete tickets, rewrite or delete history, extend a session), and **allowed** to do its normal work. "Refused" means PostgreSQL error code `42501` (insufficient privilege).

**While set-up is pending,** these tests are **skipped** (`describe.skipIf(...)`), and Vitest reports them as skipped: `137 passed | 15 skipped`. Skipped is honest; silently passing would hide that they've never run.

### Small things worth knowing

- **Verifying permissions:** PostgreSQL lists them in `information_schema.role_table_grants` and `information_schema.column_privileges`.
- **In SQL, double quotes mean names and single quotes mean text.** `", "` in a query means "the column named `, `", which caused a confusing *column does not exist* error while checking the grants. Use `', '`, or better, pass it as a parameter.
- **Transition fallbacks:** if `DATABASE_ADMIN_URL` is missing, migrations and tests use `DATABASE_URL` and print a note. That's convenient while set-up is pending, but fallbacks can hide mistakes, so it's documented and visible rather than silent.

### Finishing the set-up, and testing the tests

After the password was set and `.env` switched, a quick check (printing only **usernames**, never passwords) confirmed `DATABASE_URL` connects as `fixflow_app` (not a superuser) and `DATABASE_ADMIN_URL` as `postgres`.

**First run:** all 15 permission tests passed. Then, to make sure they can fail, the migration was temporarily changed (affecting only the throwaway test database):

| Deliberate mistake | Result |
|---|---|
| History made editable (`GRANT UPDATE, DELETE ON ticket_events`) | "can't rewrite history", "can't delete history" failed |
| `UPDATE` on **every** column of `users` | "can't change a user's role" failed |
| App allowed to create organizations | "can't create an organization" failed |
| A grant **missing** (app can't add history rows) | **15 workflow tests** failed |

So the tests catch permissions that are too **loose** *and* too **tight**.

**Gotcha while connecting:** `psql -U postgres` asked for a password and rejected the one typed. Instead of retyping, psql read the URL straight from `.env`: `psql "$(grep … .env | cut -d= -f2-)"`. Shell history records the command, not the password.

---

## Glossary

| Term | Simple meaning |
|---|---|
| **API** | A way for programs to talk to each other. FixFlow's API lets the frontend ask the backend for tickets |
| **REST** | A style of API using URLs and HTTP methods (`GET` read, `POST` create, `PATCH` update, `DELETE` remove) |
| **Endpoint / route** | One URL plus method the API answers, e.g. `GET /api/tickets` |
| **Middleware** | A function every request passes through, like a security checkpoint |
| **Schema** | The structure of the database: tables, columns, rules |
| **Constraint** | A rule the database enforces, e.g. `NOT NULL`, `UNIQUE`, `CHECK`, foreign key |
| **Primary key** | The column that uniquely identifies each row (`id`) |
| **Foreign key** | A column pointing to a row in another table (a ticket's `property_id`) |
| **Composite foreign key** | A foreign key using two columns, e.g. `(property_id, organization_id)`, so a ticket can't point to another organization's property |
| **Multi-tenant** | One app serving many separate organizations (tenants), whose data must never mix |
| **Migration** | A SQL file describing one change to the database structure |
| **Baseline** | The first migration, describing the schema as it already existed |
| **Index** | A sorted lookup list that makes queries fast |
| **Trigger** | An automatic action the database runs when data changes |
| **Transaction** | A group of statements that all succeed or all fail |
| **Checksum** | A fingerprint of a file's contents |
| **Connection pool** | A set of reusable open database connections |
| **ORM** | A translator between code and the database |
| **Introspection** | Reading an existing database to find out its structure |
| **SQL injection** | An attack where user input is run as SQL. Prevented by parameterized queries |
| **Superuser** | A database user that can do anything. Apps shouldn't use one |
| **LTS** | Long-Term Support: a software version that gets fixes for years |
| **Environment variable** | A setting given to a program from outside its code |
| **Release candidate (rc)** | A version that's almost final but still being tested. Prefer stable versions |
| **Snapshot (Drizzle)** | A saved copy of what the schema looked like after a migration, used to work out what changed next time |
| **Journal (Drizzle)** | `drizzle/meta/_journal.json`: the ordered list of migrations with their timestamps |
| **Custom migration** | A migration you write by hand because the tool can't generate it (e.g. triggers) |
| **Smoke test** | A quick check that the basic features work, before deeper testing |
| **Handover** | Moving migration tracking from one tool to another without re-running anything |
| **Layer (routes / controller / service)** | Splitting a request's handling into the URL map, the HTTP handling, and the business logic and database work |
| **Modular monolith** | One app, organized into self-contained feature modules |
| **Input validation** | Checking request data is the right type and range before using it |
| **Integration test** | A test that checks several parts working together (HTTP, code, real database) |
| **Unit test** | A test that checks one small function on its own |
| **Arrange, Act, Assert** | The three steps of a test: set up, do the thing, check the result |
| **Mutation testing** | Breaking code on purpose to make sure the tests notice |
| **Declaration merging** | Adding properties to an existing TypeScript type, like `req.auth` on Express's Request |
| **Zod** | A library where you describe what valid data looks like, and it checks input against that description |
| **Schema (validation)** | A description of valid input, e.g. "title is a string of 1–200 characters". Not the same as a database schema |
| **Coercion** | Converting a value to another type before checking it, e.g. the text `"20"` to the number `20` |
| **Mass assignment** | An attack where the client sends extra fields (like `organizationId`) hoping the server saves them blindly |
| **URL parameter** | A variable part of a URL path, e.g. `:id` in `/api/tickets/:id` |
| **Location header** | A response header telling the client where a newly created resource lives |
| **Defense in depth** | Several independent layers of protection, so one mistake doesn't cause a disaster |
| **State machine** | A fixed set of states and the allowed moves between them (e.g. open → assigned → in_progress) |
| **Policy / authorization layer** | Code that decides *who may do what*, kept separate from the code that does it |
| **Pure function** | A function whose result depends only on its inputs, with no database or network. Easy to test |
| **409 Conflict** | "Your request is valid, but clashes with the current state", e.g. an invalid status change |
| **403 Forbidden** | "I know who you are, and you're not allowed to do this" |
| **Audit log** | An append-only record of who did what and when |
| **Append-only** | Data that is only ever added, never changed or deleted |
| **Race condition** | A bug where the result depends on the exact timing of two things happening at once |
| **Optimistic concurrency** | Detecting at save time that someone else changed the data, instead of locking it first |
| **Pessimistic locking** | Locking data before changing it so others must wait (`SELECT … FOR UPDATE`) |
| **Row lock** | PostgreSQL blocking other changes to one row until a transaction finishes |
| **Deterministic test** | A test that behaves the same way every run, never depending on luck or timing |
| **Authentication** | Proving *who you are* (login) |
| **Authorization** | Deciding *what you're allowed to do* (permissions) |
| **Password hash** | A one-way scramble of a password; the password itself is never stored |
| **Salt** | Random data mixed into each password before hashing, so equal passwords get different hashes |
| **scrypt** | A deliberately slow, memory-hungry password-hashing algorithm |
| **Session** | A server-side record that a user is logged in, identified by a random token |
| **Bearer token** | A token sent as `Authorization: Bearer <token>`; whoever holds it is treated as logged in |
| **User enumeration** | An attack that discovers which accounts exist from differences in error messages or timing |
| **Timing attack** | Learning secrets from how long a server takes to respond |
| **Constant-time comparison** | Comparing secrets in a way that takes the same time regardless of where they differ |
| **Raw mode (terminal)** | A terminal mode where key presses go straight to the program without being shown |
| **JWT** | JSON Web Token: a signed token the server can verify without a database lookup, but can't easily cancel |
| **Brute-force attack** | Trying password after password against one account until one works |
| **Password spraying** | Trying one common password against many accounts, to dodge per-account limits |
| **Rate limiting** | Capping how many times something can be done in a period of time |
| **429 Too Many Requests** | HTTP status meaning "slow down, you've hit a limit" |
| **Retry-After header** | Tells the client how many seconds to wait before trying again |
| **Fixed window** | A rate-limit method: count hits in a window that starts with the first hit and resets when it ends |
| **Dependency injection** | Passing in the things code depends on (like a clock) so tests can replace them |
| **Visibility scope** | Which records a user is allowed to see, e.g. "tickets I created" |
| **Trust proxy** | An Express setting that tells it to read the real client IP from headers added by a reverse proxy |
| **Least privilege** | Giving each part of a system only the permissions it needs, nothing more |
| **Superuser** (PostgreSQL) | A database role that bypasses all permission checks |
| **Role** (PostgreSQL) | A database user or group that permissions are granted to |
| **GRANT / REVOKE** | SQL commands that give or take away permissions |
| **Column-level privilege** | A permission on specific columns only, e.g. `UPDATE (password_hash) ON users` |
| **Fail safe** | When something is forgotten, the system denies access rather than allowing it |
| **URL encoding** | Escaping special characters (like `@` or `/`) so they can appear inside a URL |
| **Skipped test** | A test deliberately not run, and reported as such, e.g. because a precondition isn't met |
