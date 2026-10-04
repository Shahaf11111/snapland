import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PresenceService, PRESENCE_LEASE_MS } from "../src/websocket/presence.service";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")("presence leases (real Redis, isolated keys)", () => {
  const prefix = `test:presence:${randomUUID()}:`;
  const keys = ["presence:v2:connections", "presence:v2:expires", "presence:v2:users", "presence:v2:counts"];
  let redis: Redis;
  let presence: PresenceService;
  let subscriber: Redis;
  const events: { type: string }[] = [];
  const channel = prefix + "broadcast";
  const flush = async () => {
    const fence = randomUUID();
    const received = new Promise<void>(resolve => {
      const handler = (_channel: string, raw: string) => {
        if (raw !== fence) return;
        subscriber.off("message", handler);
        resolve();
      };
      subscriber.on("message", handler);
    });
    await redis.publish(channel, fence);
    await received;
  };
  const user = { userId: randomUUID(), name: "Multiple tabs", color: "#fff" };

  beforeAll(async () => {
    const env = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
    redis = new Redis(process.env.REDIS_URL ?? env.REDIS_URL ?? "redis://localhost:6379", { keyPrefix: prefix, maxRetriesPerRequest: 1 });
    subscriber = redis.duplicate();
    subscriber.on("message", (_channel, raw) => {
      if (raw.startsWith("{")) events.push(JSON.parse(raw));
    });
    await subscriber.subscribe(channel);
    // Isolate both Redis keys and the publication channel from running apps.
    presence = new PresenceService({
      eval: (script: string, count: number, ...args: (string | number)[]) =>
        redis.eval(script, count, ...args.slice(0, -1), prefix + "broadcast"),
    } as Redis);
  });

  afterAll(async () => {
    if (!redis) return;
    try { await redis.del(...keys); } finally { await Promise.all([redis.quit(), subscriber?.quit()]); }
  });

  it("keeps a user online until their last connection leaves, with idempotent removal", async () => {
    await Promise.all([presence.markPresent("tab-a", user), presence.markPresent("tab-b", user)]);
    expect(await presence.list()).toEqual([user]);
    await presence.markAbsent("tab-a");
    await presence.markAbsent("tab-a");
    expect(await presence.list()).toEqual([user]);
    expect(await redis.hget(keys[3], user.userId)).toBe("1");
    await presence.markAbsent("tab-b");
    expect(await presence.list()).toEqual([]);
    await flush();
    expect(events.map(event => event.type)).toEqual(["presence:join", "presence:leave"]);
    events.length = 0;
  });

  it("renews a lease and prunes crashed connections without removing another active tab", async () => {
    await presence.markPresent("crashed", user);
    await presence.markPresent("healthy", user);
    await redis.zadd(keys[1], 0, "crashed", 0, "healthy");
    // Renewing a now-expired connection re-registers it atomically.
    await presence.markPresent("healthy", user);
    expect(await presence.list()).toEqual([user]);
    expect(await redis.hget(keys[0], "crashed")).toBeNull();
    const clock = await redis.time();
    const now = Number(clock[0]) * 1000 + Math.floor(Number(clock[1]) / 1000);
    const expiry = Number(await redis.zscore(keys[1], "healthy"));
    expect(expiry - now).toBeGreaterThan(PRESENCE_LEASE_MS - 2000);
    expect(expiry - now).toBeLessThanOrEqual(PRESENCE_LEASE_MS);
    await redis.zadd(keys[1], 0, "healthy");
    expect(await presence.list()).toEqual([]);
    expect(await redis.exists(...keys)).toBe(0);
  });

  it("handles concurrent old-connection removal and new-connection registration", async () => {
    await presence.markPresent("old", user);
    await Promise.all([presence.markAbsent("old"), presence.markPresent("new", user), presence.markAbsent("old")]);
    expect(await presence.list()).toEqual([user]);
    expect(await redis.hget(keys[3], user.userId)).toBe("1");
    await presence.markAbsent("new");
    expect(await presence.list()).toEqual([]);
  });
});
