# FixFlow
FixFlow replaces scattered WhatsApp messages, calls and spreadsheets with a structured maintenance workflow for apartment complexes, hostels, offices and college campuses. 

Eg: Resident reports leaking tap, attaches a photo, tracks the repair. Manager assigns a plumber, plumber updates progress, and resident confirms that the problem is resolved.

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

All `/api` routes are scoped to one organization. Until authentication is built, development requests pass it in a temporary `X-Organization-Id` header (disabled in production).

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service and database status |
| `GET` | `/api/tickets?status=&limit=` | List the organization's tickets, newest first (`limit` 1–50, default 20) |

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
