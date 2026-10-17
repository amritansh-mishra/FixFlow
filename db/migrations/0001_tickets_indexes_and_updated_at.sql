-- Indexes for the ticket queries the API will run most often. Each one starts
-- with organization_id because every query is scoped to one organization.

-- "Show open tickets in my organization"
CREATE INDEX idx_tickets_org_status
    ON tickets (organization_id, status);

-- "Show tickets assigned to this technician"
CREATE INDEX idx_tickets_assigned_to
    ON tickets (organization_id, assigned_to);

-- "Show tickets for this property"
CREATE INDEX idx_tickets_property
    ON tickets (organization_id, property_id);


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

CREATE TRIGGER tickets_set_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
