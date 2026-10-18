CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_key" UNIQUE("dedupe_key"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('ticket_assigned', 'status_changed', 'comment_added'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_organization_id_fkey" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_organization_id_fkey" FOREIGN KEY ("actor_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_organization_id_fkey" FOREIGN KEY ("ticket_id","organization_id") REFERENCES "public"."tickets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
-- The worker creates notifications and the API reads them and marks them
-- read. Nobody can edit a message, change the recipient, or delete one.
-- Skipped where the restricted role doesn't exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT SELECT, INSERT ON notifications TO fixflow_app;
        GRANT UPDATE (read_at) ON notifications TO fixflow_app;
    END IF;
END
$$;
