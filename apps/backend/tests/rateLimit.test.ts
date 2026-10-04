import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSlidingWindowRateLimit } from "../src/common/rate-limit/rate-limit.util";

/**
 * Minimal in-memory fake of the ioredis surface used by the sliding-window
 * rate limiter (multi/zadd/zremrangebyscore/zcard/pexpire + zremrangebyrank),
 * so this test exercises the real limiter logic without a live Redis.
 * `checkSlidingWindowRateLimit` takes the client as a plain parameter, so
 * no module mocking / DI bootstrapping is needed to test it.
 */
class FakeRedis {
  private sortedSets = new Map<string, Map<string, number>>();

  private set(key: string): Map<string, number> {
    let s = this.sortedSets.get(key);
    if (!s) {
      s = new Map();
      this.sortedSets.set(key, s);
    }
    return s;
  }

  multi() {
    const ops: Array<() => unknown> = [];
    const chain = {
      zremrangebyscore: (key: string, min: number, max: number) => {
        ops.push(() => {
          const s = this.set(key);
          for (const [member, score] of s) {
            if (score >= min && score <= max) s.delete(member);
          }
          return "OK";
        });
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => {
          this.set(key).set(member, score);
          return 1;
        });
        return chain;
      },
      zcard: (key: string) => {
        ops.push(() => this.set(key).size);
        return chain;
      },
      pexpire: () => {
        ops.push(() => 1);
        return chain;
      },
      exec: async () => ops.map((op) => [null, op()]),
    };
    return chain;
  }

  async zremrangebyrank(key: string, start: number, stop: number) {
    const s = this.set(key);
    const entries = [...s.entries()].sort((a, b) => a[1] - b[1]);
    const n = entries.length;
    const normalize = (i: number) => (i < 0 ? Math.max(0, n + i) : i);
    const from = normalize(start);
    const to = Math.min(n - 1, normalize(stop));
    for (let i = from; i <= to; i++) s.delete(entries[i][0]);
    return to - from + 1;
  }

  reset() {
    this.sortedSets = new Map();
  }
}

const fakeRedis = new FakeRedis();
const LIMIT = 3;

describe("checkSlidingWindowRateLimit", () => {
  beforeEach(() => {
    fakeRedis.reset();
  });

  it("allows requests under the limit", async () => {
    const r1 = await checkSlidingWindowRateLimit(fakeRedis as never, "user-1", LIMIT);
    const r2 = await checkSlidingWindowRateLimit(fakeRedis as never, "user-1", LIMIT);
    const r3 = await checkSlidingWindowRateLimit(fakeRedis as never, "user-1", LIMIT);
    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true]);
  });

  it("rejects the request once the per-minute limit is exceeded", async () => {
    await checkSlidingWindowRateLimit(fakeRedis as never, "user-2", LIMIT);
    await checkSlidingWindowRateLimit(fakeRedis as never, "user-2", LIMIT);
    await checkSlidingWindowRateLimit(fakeRedis as never, "user-2", LIMIT);
    const fourth = await checkSlidingWindowRateLimit(fakeRedis as never, "user-2", LIMIT);
    expect(fourth.allowed).toBe(false);
  });

  it("tracks separate limits per key", async () => {
    await checkSlidingWindowRateLimit(fakeRedis as never, "user-a", LIMIT);
    await checkSlidingWindowRateLimit(fakeRedis as never, "user-a", LIMIT);
    await checkSlidingWindowRateLimit(fakeRedis as never, "user-a", LIMIT);
    const otherUser = await checkSlidingWindowRateLimit(fakeRedis as never, "user-b", LIMIT);
    expect(otherUser.allowed).toBe(true);
  });

  it.each([
    { result: null },
    { result: [[null, 0], [null, 1], [null, "invalid"], [null, 1]] },
    { result: [[null, 0], [null, 1], [new Error("Redis command failed"), null], [null, 1]] },
  ])("rejects an incomplete or failed Redis transaction: $result", async ({ result }) => {
    const redis = new FakeRedis();
    const transaction = redis.multi();
    vi.spyOn(redis, "multi").mockReturnValue(transaction);
    vi.spyOn(transaction, "exec").mockResolvedValue(result as never);
    await expect(checkSlidingWindowRateLimit(redis as never, "user", LIMIT)).rejects.toThrow();
  });
});
