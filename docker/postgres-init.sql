-- Runs once, the first time the Docker PostgreSQL starts with an empty volume
-- (files in /docker-entrypoint-initdb.d run automatically).
--
-- Creates the restricted role the app connects as, so local development
-- matches production and CI. Migration 0004 then grants it its permissions.
-- The password is for this local container only.
CREATE ROLE fixflow_app LOGIN PASSWORD 'fixflow_app';
