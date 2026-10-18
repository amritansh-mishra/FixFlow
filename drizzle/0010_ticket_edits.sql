ALTER TABLE "ticket_events" DROP CONSTRAINT "ticket_events_type_check";--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_type_check" CHECK ("ticket_events"."type" IN ('created', 'assigned', 'status_changed', 'commented', 'edited'));--> statement-breakpoint
-- Editing a ticket changes only its title, description and priority; the
-- app still can't change who created it, its organization, and so on.
-- Skipped where the restricted role doesn't exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT UPDATE (title, description, priority) ON tickets TO fixflow_app;
    END IF;
END
$$;
