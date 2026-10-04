/* eslint-disable camelcase */

export const shorthands = undefined;

export async function up(pgm) {
  pgm.createExtension("postgis", { ifNotExists: true });
  pgm.createExtension("pgcrypto", { ifNotExists: true });
  pgm.createExtension("citext", { ifNotExists: true });

  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "citext", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("sessions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "cascade",
    },
    refresh_token_hash: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("sessions", "user_id");

  pgm.createTable("areas", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true },
    geom: { type: "geography(Polygon,4326)", notNull: true },
    size_km2: { type: "double precision", notNull: true },
    version: { type: "integer", notNull: true, default: 1 },
    created_by: { type: "uuid", notNull: true, references: "users" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deleted_at: { type: "timestamptz" },
  });
  pgm.createIndex("areas", "geom", { method: "gist" });
  pgm.createIndex("areas", "deleted_at");
  pgm.createIndex("areas", "created_at");

  pgm.createTable("area_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    area_id: {
      type: "uuid",
      notNull: true,
      references: "areas",
      onDelete: "cascade",
    },
    geom: { type: "geography(Polygon,4326)", notNull: true },
    name: { type: "text", notNull: true },
    size_km2: { type: "double precision", notNull: true },
    version: { type: "integer", notNull: true },
    edited_by: { type: "uuid", notNull: true, references: "users" },
    edited_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    change_type: {
      type: "text",
      notNull: true,
      check: "change_type in ('created','updated','deleted')",
    },
  });
  pgm.createIndex("area_history", "area_id");

  pgm.createTable("audit_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", references: "users", onDelete: "set null" },
    action: { type: "text", notNull: true },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "uuid" },
    metadata: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("audit_log", "user_id");
  pgm.createIndex("audit_log", "created_at");
}

export async function down(pgm) {
  pgm.dropTable("audit_log");
  pgm.dropTable("area_history");
  pgm.dropTable("areas");
  pgm.dropTable("sessions");
  pgm.dropTable("users");
}
