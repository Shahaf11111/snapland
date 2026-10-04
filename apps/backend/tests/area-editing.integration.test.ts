import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AreaEditingService } from "../src/websocket/area-editing.service";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")("area-editing leases (real Redis, isolated keys)", () => {
  const prefix = `test:area-editing:${randomUUID()}:`;
  const key = "area-editing:v1:current";
  let redis: Redis;
  let service: AreaEditingService;
  const user = { userId: randomUUID(), name: "Demo", color: "#fff" };

  beforeAll(async () => {
    const env = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
    redis = new Redis(process.env.REDIS_URL ?? env.REDIS_URL ?? "redis://localhost:6379", { keyPrefix: prefix, maxRetriesPerRequest: 1 });
    service = new AreaEditingService(redis);
  });

  afterEach(async () => { await redis.del(key); });
  afterAll(async () => { if (redis) await redis.quit(); });

  it("tracks a lease from start through list, and clears it on a matching stop", async () => {
    await service.start("area-1", "conn-a", user);
    expect(await service.list()).toEqual({ "area-1": user });
    await service.stop("area-1", "conn-a");
    expect(await service.list()).toEqual({});
  });

  it("ignores a stop from a connection that doesn't hold the current lease", async () => {
    await service.start("area-1", "conn-a", user);
    await service.stop("area-1", "conn-b");
    expect(await service.list()).toEqual({ "area-1": user });
  });

  it("lets a newer start from a different connection take over the lease", async () => {
    const other = { userId: randomUUID(), name: "Other", color: "#000" };
    await service.start("area-1", "conn-a", user);
    await service.start("area-1", "conn-b", other);
    expect(await service.list()).toEqual({ "area-1": other });
    // The original holder's stop is now a no-op against the newer lease.
    await service.stop("area-1", "conn-a");
    expect(await service.list()).toEqual({ "area-1": other });
  });

  it("renews only when the caller still holds the lease, and prunes an expired one from list()", async () => {
    vi.useFakeTimers();
    try {
      await service.start("area-1", "conn-a", user);
      await service.renew("area-1", "conn-b"); // not the holder — ignored
      vi.advanceTimersByTime(20_000);
      await service.renew("area-1", "conn-a"); // holder — pushes expiry out again
      vi.advanceTimersByTime(20_000); // 40s since start, but renewed at 20s: still alive
      expect(await service.list()).toEqual({ "area-1": user });
      vi.advanceTimersByTime(15_000); // 35s since the renewal: past the 30s lease
      expect(await service.list()).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
