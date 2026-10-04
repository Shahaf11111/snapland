#!/usr/bin/env node
/**
 * Benchmarks the exact bounds-read query AreasRepository.listInBounds runs,
 * directly against Postgres (no HTTP, no AreasCache) so the numbers reflect
 * the database/index alone. Run bench-seed.js first.
 *
 * Usage: DATABASE_URL=... node scripts/bench-query.js [iterations]
 */
const { Pool } = require("pg");

const ITERATIONS = Number(process.argv[2] ?? process.env.BENCH_ITERATIONS ?? 200);
// A sub-region of bench-seed.js's bbox — not the whole thing, so the planner
// has to actually filter rather than match everything. BENCH_BBOX overrides
// it as "minLng,minLat,maxLng,maxLat" to probe different selectivities.
const BBOX = process.env.BENCH_BBOX
  ? (([minLng, minLat, maxLng, maxLat]) => ({ minLng, minLat, maxLng, maxLat }))(process.env.BENCH_BBOX.split(",").map(Number))
  : { minLng: 34.75, minLat: 32.05, maxLng: 34.85, maxLat: 32.15 };
const LIMIT = 1000;

const QUERY = `
  SELECT id, name, ST_AsGeoJSON(geom::geometry)::json AS geometry,
         size_km2, version, created_by, created_at, updated_at, deleted_at
  FROM areas
  WHERE deleted_at IS NULL
    AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
  ORDER BY created_at DESC
  LIMIT $5
`;
const PARAMS = [BBOX.minLng, BBOX.minLat, BBOX.maxLng, BBOX.maxLat, LIMIT];

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: totalRows } = await pool.query("SELECT count(*) FROM areas WHERE deleted_at IS NULL");
    console.log(`Total non-deleted rows in areas: ${totalRows[0].count}`);

    console.log("\n--- EXPLAIN (ANALYZE, BUFFERS) ---");
    const { rows: plan } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${QUERY}`, PARAMS);
    const planText = plan.map((row) => row["QUERY PLAN"]).join("\n");
    console.log(planText);
    const usesGistIndex = /areas_geom_index/.test(planText);
    const usesCreatedAtIndex = /areas_created_at_index/.test(planText);
    const usesSeqScan = /Seq Scan/.test(planText);
    console.log(`\nPlan uses: ${[
      usesGistIndex && "geom GIST index",
      usesCreatedAtIndex && "created_at index",
      usesSeqScan && "sequential scan (no index)",
    ].filter(Boolean).join(", ") || "unrecognized plan — inspect above"}`);

    console.log(`\n--- Timing: ${ITERATIONS} sequential runs ---`);
    const durations = [];
    let lastRowCount = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      const { rows } = await pool.query(QUERY, PARAMS);
      durations.push(Number(process.hrtime.bigint() - start) / 1e6); // ms
      lastRowCount = rows.length;
    }
    durations.sort((a, b) => a - b);

    console.log(`Rows returned per query: ${lastRowCount} (LIMIT ${LIMIT})`);
    console.log(`min:  ${durations[0].toFixed(2)}ms`);
    console.log(`p50:  ${percentile(durations, 50).toFixed(2)}ms`);
    console.log(`p95:  ${percentile(durations, 95).toFixed(2)}ms`);
    console.log(`p99:  ${percentile(durations, 99).toFixed(2)}ms`);
    console.log(`max:  ${durations[durations.length - 1].toFixed(2)}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
