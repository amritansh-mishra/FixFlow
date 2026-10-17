-- Custom migration: Drizzle Kit can't generate triggers, so this is written by hand.
--
-- Keep updated_at accurate. The column's DEFAULT only applies on INSERT, so
-- without this trigger every UPDATE would leave the original timestamp.
-- The function is generic and can be attached to any table with updated_at.
CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tickets_set_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
