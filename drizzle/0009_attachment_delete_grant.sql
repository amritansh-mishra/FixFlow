-- Custom migration: uploaders (and managers/admins) can now delete photos,
-- so the app may delete attachment records. It still can't change one (e.g.
-- point it at a different file). Skipped where the restricted role doesn't
-- exist (see 0004).
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixflow_app') THEN
        GRANT DELETE ON ticket_attachments TO fixflow_app;
    END IF;
END
$$;
