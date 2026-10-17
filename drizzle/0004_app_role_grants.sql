-- Custom migration: a least-privilege database role for the running app.
--
-- The app connects as fixflow_app, which may only read and change the rows it
-- actually needs. It can't create, alter or drop tables, read the migration
-- log, or touch other databases. Migrations keep running as the table owner.
--
-- The role is created WITHOUT a password and NOLOGIN, so nobody can connect as
-- it until an admin sets a password and enables login by hand (see README).
-- Passwords never go in migration files.
--
-- Grants are explicit per table. New tables get NO access by default: each
-- future migration must grant what the app needs, and tests fail loudly if
-- it forgets.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        CREATE ROLE fixflow_app NOLOGIN;
    END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fixflow_app;
--> statement-breakpoint
-- Read-only for now: no endpoint creates organizations or properties yet.
GRANT SELECT ON organizations, properties TO fixflow_app;
--> statement-breakpoint
-- The app reads users and may only change one column: the password hash.
GRANT SELECT ON users TO fixflow_app;
--> statement-breakpoint
GRANT UPDATE (password_hash) ON users TO fixflow_app;
--> statement-breakpoint
-- Tickets are created and moved through the workflow; only status and
-- assignee ever change (updated_at is set by the trigger).
GRANT SELECT, INSERT ON tickets TO fixflow_app;
--> statement-breakpoint
GRANT UPDATE (status, assigned_to) ON tickets TO fixflow_app;
--> statement-breakpoint
-- History is append-only: the database itself refuses UPDATE and DELETE.
GRANT SELECT, INSERT ON ticket_events TO fixflow_app;
--> statement-breakpoint
-- Sessions are created at login and deleted at logout or password change.
GRANT SELECT, INSERT, DELETE ON sessions TO fixflow_app;
