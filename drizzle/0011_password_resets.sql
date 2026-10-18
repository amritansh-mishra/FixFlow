CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_organization_id_fkey" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_password_resets_user" ON "password_resets" USING btree ("organization_id","user_id");
--> statement-breakpoint
-- The worker creates reset links; the API looks them up and marks them used.
-- Nobody can change a link's token, owner or expiry. Skipped where the
-- restricted role doesn't exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT SELECT, INSERT ON password_resets TO fixflow_app;
        GRANT UPDATE (used_at) ON password_resets TO fixflow_app;
    END IF;
END
$$;
