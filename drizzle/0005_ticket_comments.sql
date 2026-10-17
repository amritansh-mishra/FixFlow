CREATE TABLE "ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_comments_body_check" CHECK (length("ticket_comments"."body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "ticket_events" DROP CONSTRAINT "ticket_events_type_check";--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_organization_id_fkey" FOREIGN KEY ("ticket_id","organization_id") REFERENCES "public"."tickets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_organization_id_fkey" FOREIGN KEY ("author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_comments_ticket" ON "ticket_comments" USING btree ("organization_id","ticket_id","created_at");--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_type_check" CHECK ("ticket_events"."type" IN ('created', 'assigned', 'status_changed', 'commented'));--> statement-breakpoint
-- Comments are append-only for the app, like ticket history. Skipped where the
-- restricted role doesn't exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT SELECT, INSERT ON ticket_comments TO fixflow_app;
    END IF;
END
$$;
