-- Extensions are also created idempotently by the app's first migration;
-- this init script just guarantees they exist as soon as the container is
-- provisioned, before migrations run.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
