#!/usr/bin/env node
/**
 * Removes everything bench-seed.js added. Hard-deletes (not the app's soft
 * delete) since this is synthetic load data, not a real user action that
 * needs an audit/history trail.
 *
 * Usage: DATABASE_URL=... node scripts/bench-cleanup.js [--purge-user]
 */
const { Pool } = require("pg");

const NAME_PREFIX = "bench-seed-";
const BENCH_EMAIL = "bench-seed@example.com";
const purgeUser = process.argv.includes("--purge-user");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const areas = await pool.query("DELETE FROM areas WHERE name LIKE $1", [`${NAME_PREFIX}%`]);
    console.log(`Deleted ${areas.rowCount} seeded areas.`);

    if (purgeUser) {
      const users = await pool.query("DELETE FROM users WHERE email = $1", [BENCH_EMAIL]);
      console.log(`Deleted ${users.rowCount} bench user(s).`);
    } else {
      console.log("Left the bench-seed user in place (pass --purge-user to remove it too).");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
