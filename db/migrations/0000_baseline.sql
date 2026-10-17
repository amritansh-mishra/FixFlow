-- Baseline: the schema as it existed when it was first created by hand.
--
-- The live `flixflow` database already contains these tables, so the migration
-- runner records this file as applied without executing it there. It runs for
-- real only on a fresh, empty database (a new laptop, CI, Docker).
--
-- Constraint names are spelled out so they match the live database exactly.

CREATE TABLE organizations (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    name        VARCHAR(150) NOT NULL,
    slug        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT organizations_pkey PRIMARY KEY (id),
    CONSTRAINT organizations_slug_key UNIQUE (slug)
);

CREATE TABLE users (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id  UUID         NOT NULL,
    name             VARCHAR(120) NOT NULL,
    email            VARCHAR(255) NOT NULL,
    role             VARCHAR(20)  NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations (id),
    CONSTRAINT users_role_check
        CHECK (role IN ('resident', 'technician', 'manager', 'admin')),
    CONSTRAINT users_organization_id_email_key UNIQUE (organization_id, email),
    -- Lets other tables reference (user, organization) pairs, so a ticket can
    -- never point at a user from a different organization.
    CONSTRAINT users_id_organization_id_key UNIQUE (id, organization_id)
);

CREATE TABLE properties (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id  UUID         NOT NULL,
    name             VARCHAR(150) NOT NULL,
    address          TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT properties_pkey PRIMARY KEY (id),
    CONSTRAINT properties_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations (id),
    CONSTRAINT properties_id_organization_id_key UNIQUE (id, organization_id)
);

CREATE TABLE tickets (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id  UUID         NOT NULL,
    property_id      UUID         NOT NULL,
    created_by       UUID         NOT NULL,
    assigned_to      UUID,
    title            VARCHAR(200) NOT NULL,
    description      TEXT,
    priority         VARCHAR(20)  NOT NULL DEFAULT 'medium',
    status           VARCHAR(20)  NOT NULL DEFAULT 'open',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT tickets_pkey PRIMARY KEY (id),
    CONSTRAINT tickets_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations (id),
    -- Composite foreign keys: the property and both users must belong to the
    -- same organization as the ticket.
    CONSTRAINT tickets_property_id_organization_id_fkey
        FOREIGN KEY (property_id, organization_id) REFERENCES properties (id, organization_id),
    CONSTRAINT tickets_created_by_organization_id_fkey
        FOREIGN KEY (created_by, organization_id) REFERENCES users (id, organization_id),
    CONSTRAINT tickets_assigned_to_organization_id_fkey
        FOREIGN KEY (assigned_to, organization_id) REFERENCES users (id, organization_id),
    CONSTRAINT tickets_priority_check
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    CONSTRAINT tickets_status_check
        CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
    CONSTRAINT tickets_id_organization_id_key UNIQUE (id, organization_id)
);
