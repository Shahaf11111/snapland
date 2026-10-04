#!/usr/bin/env node
/**
 * Concurrent load test against a *running* backend's GET /areas?bbox=...
 * (the brief's "load testing considerations" bonus item). Run bench-seed.js
 * against the same database first, and have the server up (`make dev` or
 * `make up`).
 *
 * Runs two passes so the cache's effect is visible:
 *   1. "warm"  — same bbox every request (AreasCache hits after request 1)
 *   2. "cold"  — bbox jittered per request (new cache key almost every time)
 *
 * Usage: BASE_URL=http://localhost:4000 node scripts/bench-http.js [concurrency] [durationSeconds]
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";
const CONCURRENCY = Number(process.argv[2] ?? process.env.BENCH_CONCURRENCY ?? 20);
const DURATION_MS = Number(process.argv[3] ?? process.env.BENCH_DURATION_SECONDS ?? 10) * 1000;
// BENCH_BBOX overrides as "minLng,minLat,maxLng,maxLat" to probe a smaller/
// larger result set (e.g. a tight viewport vs. a wide one).
const BASE_BBOX = process.env.BENCH_BBOX
  ? (([minLng, minLat, maxLng, maxLat]) => ({ minLng, minLat, maxLng, maxLat }))(process.env.BENCH_BBOX.split(",").map(Number))
  : { minLng: 34.75, minLat: 32.05, maxLng: 34.85, maxLat: 32.15 };

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function bboxParam(jitter) {
  const d = jitter ? Math.random() * 0.01 : 0; // shifts the bbox enough to miss AreasCache's rounded key
  return `${BASE_BBOX.minLng + d},${BASE_BBOX.minLat},${BASE_BBOX.maxLng + d},${BASE_BBOX.maxLat}`;
}

async function getAccessToken() {
  const email = `bench-http-${Date.now()}@example.com`;
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123", name: "Bench HTTP" }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}

async function runPass(label, { jitter, accessToken }) {
  console.log(`\n--- ${label}: ${CONCURRENCY} concurrent workers for ${DURATION_MS / 1000}s ---`);
  const durations = [];
  let completed = 0;
  let errors = 0;
  const deadline = Date.now() + DURATION_MS;

  const worker = async () => {
    while (Date.now() < deadline) {
      const start = process.hrtime.bigint();
      try {
        const res = await fetch(`${BASE_URL}/areas?bbox=${bboxParam(jitter)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        await res.json();
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
      durations.push(Number(process.hrtime.bigint() - start) / 1e6);
      completed++;
    }
  };

  const wallStart = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wallSeconds = (Date.now() - wallStart) / 1000;

  durations.sort((a, b) => a - b);
  console.log(`requests: ${completed} (${errors} errors)`);
  console.log(`throughput: ${(completed / wallSeconds).toFixed(1)} req/s`);
  console.log(`min:  ${durations[0].toFixed(2)}ms`);
  console.log(`p50:  ${percentile(durations, 50).toFixed(2)}ms`);
  console.log(`p95:  ${percentile(durations, 95).toFixed(2)}ms`);
  console.log(`p99:  ${percentile(durations, 99).toFixed(2)}ms`);
  console.log(`max:  ${durations[durations.length - 1].toFixed(2)}ms`);
}

async function main() {
  console.log(`Target: ${BASE_URL}`);
  const accessToken = await getAccessToken();
  await runPass("warm cache (fixed bbox)", { jitter: false, accessToken });
  await runPass("cold cache (jittered bbox)", { jitter: true, accessToken });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
