#!/usr/bin/env node
/**
 * Seeds synthetic polygons directly via SQL (bypassing AreasService/history/
 * audit — this is purely load data for benchmarking the bounds-read query
 * and its GIST index, not a real create flow) so docs/database.md's
 * "handle 10,000+ polygons per map region" claim has actual numbers behind
 * it. Every row is name-prefixed so `bench-cleanup.js` can remove exactly
 * what this script added and nothing else.
 *
 * Usage: DATABASE_URL=... node scripts/bench-seed.js [count]
 * Defaults to 10000 rows, scattered across the same Tel Aviv bbox the
 * integration tests already use.
 */
const { Pool } = require("pg");

const COUNT = Number(process.argv[2] ?? process.env.BENCH_COUNT ?? 10000);
const NAME_PREFIX = "bench-seed-";
const BENCH_EMAIL = "bench-seed@example.com";
const BBOX = { minLng: 34.70, minLat: 32.00, maxLng: 34.90, maxLat: 32.20 };
const BATCH_SIZE = 500;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'bench-seed-not-a-real-login', 'Bench Seed')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [BENCH_EMAIL]
    );
    const userId = rows[0].id;

    console.log(`Seeding ${COUNT} polygons (owner ${userId})...`);
    const start = Date.now();
    for (let i = 0; i < COUNT; i += BATCH_SIZE) {
      const n = Math.min(BATCH_SIZE, COUNT - i);
      const placeholders = [];
      const params = [];

      for (let j = 0; j < n; j++) {
        const lng = BBOX.minLng + Math.random() * (BBOX.maxLng - BBOX.minLng);
        const lat = BBOX.minLat + Math.random() * (BBOX.maxLat - BBOX.minLat);
        const d = 0.002; // ~200m square — small enough that 10k+ don't overlap much
        const wkt = `SRID=4326;POLYGON((${lng} ${lat}, ${lng + d} ${lat}, ${lng + d} ${lat + d}, ${lng} ${lat + d}, ${lng} ${lat}))`;

        const nameIdx = params.push(`${NAME_PREFIX}${i + j}`);
        const wktIdx = params.push(wkt);
        const userIdx = params.push(userId);
        placeholders.push(`($${nameIdx}, ST_GeogFromText($${wktIdx}), ST_Area(ST_GeogFromText($${wktIdx})) / 1000000.0, $${userIdx})`);
      }

      await client.query(
        `INSERT INTO areas (name, geom, size_km2, created_by) VALUES ${placeholders.join(",")}`,
        params
      );
      process.stdout.write(`\r  ${Math.min(i + n, COUNT)}/${COUNT}`);
    }
    console.log(`\nSeeded ${COUNT} rows in ${Date.now() - start}ms.`);

    const { rows: countRows } = await client.query(
      "SELECT count(*) FROM areas WHERE name LIKE $1", [`${NAME_PREFIX}%`]
    );
    console.log(`Total bench rows now in table: ${countRows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
