CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20),
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_type_check" CHECK ("ticket_events"."type" IN ('created', 'assigned', 'status_changed')),
	CONSTRAINT "ticket_events_from_status_check" CHECK ("ticket_events"."from_status" IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "ticket_events_to_status_check" CHECK ("ticket_events"."to_status" IN ('open', 'assigned', 'in_progress', 'resolved', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_organization_id_fkey" FOREIGN KEY ("ticket_id","organization_id") REFERENCES "public"."tickets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_organization_id_fkey" FOREIGN KEY ("actor_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_assigned_to_organization_id_fkey" FOREIGN KEY ("assigned_to","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_events_ticket" ON "ticket_events" USING btree ("organization_id","ticket_id","created_at");