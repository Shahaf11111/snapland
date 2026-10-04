import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import WebSocket from "ws";
import type { ServerMessage } from "@snapland/shared";
import { MAX_WS_PAYLOAD_BYTES } from "../src/websocket/client-message.schema";

/**
 * These tests exercise the real, *compiled* Nest server (spawned as a
 * subprocess against `dist/main.js`) rather than bootstrapping a
 * `@nestjs/testing` TestingModule in-process. That's deliberate: Vitest
 * transforms TypeScript via esbuild, which does not emit the
 * `design:paramtypes` decorator metadata Nest's DI relies on for
 * constructor-injected providers that aren't explicitly `@Inject()`-ed
 * (e.g. `ConfigService`) — a known Nest+esbuild incompatibility, not a bug
 * in the app. `nest build` uses the real TypeScript compiler, so the
 * compiled artifact has correct metadata and behaves exactly as it would
 * in production; testing against it here is also arguably more faithful
 * than testing the uncompiled graph.
 *
 * Requires a live Postgres+PostGIS and Redis, migrations applied, and the
 * backend already built (`pnpm --filter @snapland/backend build`). Skipped
 * by default so `pnpm test` works without infra; run with:
 *
 *   pnpm --filter @snapland/backend build
 *   RUN_INTEGRATION_TESTS=1 pnpm --filter @snapland/backend test
 */
const shouldRun = process.env.RUN_INTEGRATION_TESTS === "1";

const PORT = 4123;
const BASE_URL = `http://localhost:${PORT}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

function connectSocket(token: string) {
  const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(token)}`);
  const messages: ServerMessage[] = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as ServerMessage));
  socket.on("error", () => {});
  const waitFor = (predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> => new Promise((resolve, reject) => {
    const existing = messages.find(predicate);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      socket.off("message", check);
      reject(new Error("Expected WebSocket message did not arrive"));
    }, 3000);
    const check = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (predicate(message)) {
        clearTimeout(timer);
        socket.off("message", check);
        resolve(message);
      }
    };
    socket.on("message", check);
  });
  return { socket, waitFor, messages };
}

describe.skipIf(!shouldRun)("areas API (integration)", () => {
  let server: ChildProcess;
  let accessToken: string;
  let refreshToken: string;

  const square = {
    type: "Polygon" as const,
    coordinates: [
      [
        [34.78, 32.08],
        [34.79, 32.08],
        [34.79, 32.09],
        [34.78, 32.09],
        [34.78, 32.08],
      ],
    ],
  };

  beforeAll(async () => {
    server = spawn("node", ["dist/main.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "test",
        RATE_LIMIT_MAX_PER_MINUTE: "50",
        WS_PREVIEW_MAX_PER_SECOND: "2",
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test-access-secret-at-least-16-chars",
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-at-least-16-chars",
      },
      stdio: "pipe",
    });

    let stderr = "";
    server.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE_URL}/healthz`);
        if (res.ok) break;
      } catch {
        // server not up yet
      }
      if (!server.pid || server.exitCode !== null) {
        throw new Error(`Server exited early. Stderr:\n${stderr}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const email = `test-${Date.now()}@example.com`;
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123", name: "Test User" }),
    });
    const body = await json(res);
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  }, 20_000);

  afterAll(() => {
    server?.kill();
  });

  it("limits previews independently while cancellation and area saves remain available", async () => {
    const registration = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `preview-limit-${Date.now()}@example.com`, password: "password123", name: "Preview Limit Test" }),
    });
    expect(registration.status).toBe(201);
    const session = await json(registration);
    const { socket, waitFor } = connectSocket(session.accessToken);
    const observer = connectSocket(session.accessToken);
    try {
      await waitFor((m) => m.type === "presence:list");
      await observer.waitFor((m) => m.type === "presence:list");
      for (let index = 0; index < 3; index++) {
        socket.send(JSON.stringify({ type: "draw:progress", payload: { points: [[34.78 + index / 100, 32.08]] } }));
      }
      const error = await waitFor((m) => m.type === "error" && m.payload.code === "rate_limited");
      expect(error.payload).toEqual(expect.objectContaining({ message: "Rate limit exceeded: max 2 preview updates/sec" }));
      socket.send(JSON.stringify({ type: "draw:cancel", payload: {} }));
      await observer.waitFor((m) => m.type === "draw:cancel");
      const saved = await fetch(`${BASE_URL}/areas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ name: "Preview budget independence", geometry: square }),
      });
      expect(saved.status).toBe(201);
      expect(saved.headers.get("X-RateLimit-Limit")).toBe("50");
      expect(saved.headers.get("X-RateLimit-Remaining")).toBe("49");
      const body = await json(saved);
      const isCreated = (m: ServerMessage) => m.type === "area:created" && m.payload.area.id === body.area.id;
      await Promise.all([waitFor(isCreated), observer.waitFor(isCreated)]);
    } finally {
      socket.close();
      observer.socket.close();
    }
  });

  it("rejects invalid socket messages and still broadcasts subsequent valid previews", async () => {
    const { socket, waitFor, messages } = connectSocket(accessToken);
    const observer = connectSocket(accessToken);
    try {
      await observer.waitFor((m) => m.type === "presence:list");
      await waitFor((m) => m.type === "presence:list");
      socket.send("{");
      await waitFor((m) => m.type === "error" && m.payload.code === "invalid_json");
      socket.send(JSON.stringify({ type: "draw:progress", payload: { points: [[181, 0]] } }));
      await waitFor((m) => m.type === "error" && m.payload.code === "invalid_message");
      const points = [[34.78, 32.08], [34.79, 32.09]];
      socket.send(JSON.stringify({ type: "draw:progress", payload: { points } }));
      const progress = await observer.waitFor((m) => m.type === "draw:progress");
      expect(progress.payload).toEqual(expect.objectContaining({ points }));
      socket.send(JSON.stringify({ type: "draw:cancel", payload: {} }));
      await observer.waitFor((m) => m.type === "draw:cancel");
      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect(messages.filter((m) => m.type === "draw:progress" || m.type === "draw:cancel")).toEqual([]);
      expect(Object.keys(progress).sort()).toEqual(["payload", "type"]);
    } finally {
      socket.close();
      observer.socket.close();
    }
  });


  it("keeps presence after one tab closes and announces leave only after the final tab closes", async () => {
    const registration = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `presence-${Date.now()}@example.com`, password: "password123", name: "Presence Tabs" }),
    });
    const session = await json(registration);
    const observer = connectSocket(accessToken);
    const first = connectSocket(session.accessToken);
    const second = connectSocket(session.accessToken);
    try {
      await Promise.all([observer, first, second].map(c => c.waitFor(m => m.type === "presence:list")));
      const initial = await second.waitFor(m => m.type === "presence:list");
      if (initial.type !== "presence:list") throw new Error("Expected presence list");
      const userId = initial.payload.users.find(u => u.name === "Presence Tabs")!.userId;
      const closed = new Promise<void>(resolve => first.socket.once("close", () => resolve()));
      first.socket.close();
      await closed;
      // A subsequent authenticated connection gets the authoritative Redis state.
      const probe = connectSocket(accessToken);
      try {
        const snapshot = await probe.waitFor(m => m.type === "presence:list");
        expect(snapshot.type === "presence:list" && snapshot.payload.users.some(u => u.userId === userId)).toBe(true);
        expect(observer.messages.some(m => m.type === "presence:leave" && m.payload.userId === userId)).toBe(false);
        second.socket.close();
        await observer.waitFor(m => m.type === "presence:leave" && m.payload.userId === userId);
      } finally {
        probe.socket.close();
      }
    } finally {
      first.socket.close();
      second.socket.close();
      observer.socket.close();
    }
  });

  it("audits accepted and rejected requests plus UI and socket actions with verified identities", async () => {
    const env = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
    const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL });
    const socketClient = connectSocket(accessToken);
    try {
      const me = await fetch(`${BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const { user } = await json(me);
      const registration = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Audit identity", email: `audit-${Date.now()}@example.invalid`, password: "DO_NOT_AUDIT_THIS" }),
      });
      expect(registration.status).toBe(201);
      const registered = await json(registration);
      const rawInvalid = await fetch(`${BASE_URL}/areas`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{DO_NOT_AUDIT_THIS",
      });
      expect(rawInvalid.status).toBe(400);
      await vi.waitFor(async () => {
        const { rows } = await pool.query("SELECT * FROM audit_log WHERE metadata->>'requestId' = ANY($1::text[])", [[registration.headers.get("X-Request-Id"), rawInvalid.headers.get("X-Request-Id")]]);
        expect(rows).toHaveLength(2);
        expect(rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ user_id: registered.user.id, metadata: expect.objectContaining({ statusCode: 201, route: "/auth/register" }) }),
          expect.objectContaining({ user_id: null, metadata: expect.objectContaining({ statusCode: 400, route: "unmatched" }) }),
        ]));
        expect(JSON.stringify(rows)).not.toContain("DO_NOT_AUDIT_THIS");
      });
      const malformed = await fetch(`${BASE_URL}/areas?bbox=0,,1,1&token=DO_NOT_AUDIT_THIS`, { headers: { Authorization: `Bearer ${accessToken}` } });
      expect(malformed.status).toBe(400);
      const requestId = malformed.headers.get("X-Request-Id");
      expect(requestId).toBeTruthy();
      await vi.waitFor(async () => {
        const { rows } = await pool.query("SELECT * FROM audit_log WHERE metadata->>'requestId'=$1", [requestId]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ user_id: user.id, action: "http.request", metadata: { statusCode: 400, route: "/areas" } });
        expect(JSON.stringify(rows)).not.toContain("DO_NOT_AUDIT_THIS");
      });
      const ui = await fetch(`${BASE_URL}/audit/events`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "ui.theme.change", value: "dark" }),
      });
      expect(ui.status).toBe(204);
      const spoofed = await fetch(`${BASE_URL}/audit/events`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "area.delete", userId: user.id }),
      });
      expect(spoofed.status).toBe(400);
      const anon = await fetch(`${BASE_URL}/audit/events`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ui.theme.change", value: "dark" }),
      });
      expect(anon.status).toBe(401);
      await socketClient.waitFor(m => m.type === "presence:list");
      socketClient.socket.send("{DO_NOT_AUDIT_THIS");
      await socketClient.waitFor(m => m.type === "error" && m.payload.code === "invalid_json");
      await vi.waitFor(async () => {
        const { rows } = await pool.query("SELECT action, metadata FROM audit_log WHERE user_id=$1", [user.id]);
        expect(rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ action: "ui.theme.change", metadata: expect.objectContaining({ source: "client", value: "dark" }) }),
          expect.objectContaining({ action: "ws.message", metadata: expect.objectContaining({ outcome: "invalid_json" }) }),
        ]));
        expect(JSON.stringify(rows)).not.toContain("DO_NOT_AUDIT_THIS");
      });
    } finally {
      socketClient.socket.close();
      await pool.end();
    }
  });

  it("closes oversized socket messages at the transport boundary with code 1009", async () => {
    const { socket, waitFor } = connectSocket(accessToken);
    try {
      await waitFor((m) => m.type === "presence:list");
      const closed = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Oversized socket was not closed")), 3000);
        socket.once("close", (code) => { clearTimeout(timer); resolve(code); });
      });
      socket.send("x".repeat(MAX_WS_PAYLOAD_BYTES + 1));
      expect(await closed).toBe(1009);
      expect((await fetch(`${BASE_URL}/healthz`)).status).toBe(200);
    } finally {
      socket.close();
    }
  });

  it("creates an area with a geodesically-accurate size and rejects stale-version updates", async () => {
    const createRes = await fetch(`${BASE_URL}/areas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: "Test Area", geometry: square }),
    });
    const created = await json(createRes);

    expect(createRes.status).toBe(201);
    expect(created.area.sizeKm2).toBeGreaterThan(0);
    expect(created.area.version).toBe(1);

    const areaId = created.area.id;

    const updateRes = await fetch(`${BASE_URL}/areas/${areaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: "Renamed", version: 1 }),
    });
    const updated = await json(updateRes);
    expect(updateRes.status).toBe(200);
    expect(updated.area.version).toBe(2);

    const staleUpdateRes = await fetch(`${BASE_URL}/areas/${areaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: "Conflicting rename", version: 1 }),
    });
    expect(staleUpdateRes.status).toBe(409);
  });

  it("rejects an invalid self-intersecting polygon", async () => {
    const bowtie = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
    };
    const res = await fetch(`${BASE_URL}/areas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: "Bad shape", geometry: bowtie }),
    });
    expect(res.status).toBe(400);
  });

  it("returns areas within the requested bounds", async () => {
    const res = await fetch(`${BASE_URL}/areas?bbox=34.7,32.0,34.9,32.2`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(Array.isArray(body.areas)).toBe(true);
  });

  it("exchanges a valid refresh token for a new session (session id round-trips correctly)", async () => {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const body = await json(res);
    expect(res.status).toBe(201);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    // The rotated-out refresh token must now be rejected.
    const reuseRes = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    expect(reuseRes.status).toBe(401);
  });
});
