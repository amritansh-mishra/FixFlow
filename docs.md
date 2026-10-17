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
22. [Glossary](#glossary)

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
