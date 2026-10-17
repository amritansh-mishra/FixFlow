ALTER TABLE "organizations" ADD COLUMN "join_code" varchar(20);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_join_code_key" UNIQUE("join_code");--> statement-breakpoint
-- Signup, joining with a code and the Team page let the app create
-- organizations, users and properties, and change an organization's join
-- code. It still can't delete any of them, change slugs, or change roles.
-- Skipped where the restricted role doesn't exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT INSERT ON organizations, users, properties TO fixflow_app;
        GRANT UPDATE (join_code) ON organizations TO fixflow_app;
    END IF;
END
$$;
