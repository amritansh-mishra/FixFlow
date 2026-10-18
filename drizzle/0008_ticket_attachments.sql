CREATE TABLE "ticket_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attachments_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "ticket_attachments_content_type_check" CHECK ("ticket_attachments"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "ticket_attachments_size_check" CHECK ("ticket_attachments"."size_bytes" > 0 AND "ticket_attachments"."size_bytes" <= 5242880)
);
--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_organization_id_fkey" FOREIGN KEY ("ticket_id","organization_id") REFERENCES "public"."tickets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploaded_by_organization_id_fkey" FOREIGN KEY ("uploaded_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_attachments_ticket" ON "ticket_attachments" USING btree ("organization_id","ticket_id","created_at");--> statement-breakpoint
-- The app records uploads and lists them; it can't change or delete a
-- record. Skipped where the restricted role doesn't exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT SELECT, INSERT ON ticket_attachments TO fixflow_app;
    END IF;
END
$$;
