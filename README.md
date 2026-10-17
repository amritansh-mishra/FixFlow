# FixFlow
FixFlow replaces scattered WhatsApp messages, calls and spreadsheets with a structured maintenance workflow for apartment complexes, hostels, offices and college campuses. 

Eg: Resident reports leaking tap, attaches a photo, tracks the repair. Manager assigns a plumber, plumber updates progress, and resident confirms that the problem is resolved.

## Local development

Requires Node 24 (`nvm use`) and PostgreSQL.

```bash
cp .env.example .env      # then set DATABASE_URL
npm install
npm run db:migrate        # apply database migrations (add -- --dry-run to preview)
npm run dev               # start the API with auto-reload
```

### Database migrations

SQL migrations live in `db/migrations/` and run in filename order, each in its own transaction. Applied migrations are tracked in the `schema_migrations` table. Never edit a migration that has already been applied; add a new numbered file instead.
