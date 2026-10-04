import type Redis from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Sliding-window rate limiter backed by a Redis sorted set per key.
 * Redis-backed (not in-process) so the limit is shared correctly across
 * multiple horizontally-scaled backend instances. Pure function taking the
 * client and limit as parameters, so it's trivially testable against a
 * fake Redis client without any DI/Nest bootstrapping.
 */
export async function checkSlidingWindowRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs = 60_000
): Promise<RateLimitResult> {
  const now = Date.now();

  const pipeline = redis.multi();
  pipeline.zremrangebyscore(key, 0, now - windowMs);
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, windowMs);
  const results = await pipeline.exec();

  // Redis can resolve EXEC with per-command errors rather than rejecting it.
  if (!results || results.length !== 4) throw new Error("Rate-limit transaction did not complete");
  for (const [error] of results) {
    if (error) throw error;
  }
  const count = results[2][1];
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new Error("Invalid rate-limit count");
  }

  if (count > limit) {
    // Remove the entry we just optimistically added since it's rejected.
    await redis.zremrangebyrank(key, -1, -1);
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: Math.max(0, limit - count) };
}
