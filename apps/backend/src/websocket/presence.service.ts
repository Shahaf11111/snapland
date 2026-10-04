import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { PresenceUser } from "@snapland/shared";
import { REDIS_CLIENT } from "../database/redis.constants";
import { BROADCAST_CHANNEL } from "./pubsub.service";

export const PRESENCE_HEARTBEAT_MS = 15_000;
export const PRESENCE_LEASE_MS = 45_000;
const PRESENCE_KEYS = ["presence:v2:connections", "presence:v2:expires", "presence:v2:users", "presence:v2:counts"];
const PRESENCE_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c"];

// Redis time and atomic membership + publication prevent cross-instance races:
// a late disconnect cannot remove a new tab or publish a leave after its join.
const PRESENCE_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local function remove(id)
  local userId = redis.call('HGET', KEYS[1], id)
  redis.call('ZREM', KEYS[2], id)
  if not userId then return end
  redis.call('HDEL', KEYS[1], id)
  if redis.call('HINCRBY', KEYS[4], userId, -1) <= 0 then
    redis.call('HDEL', KEYS[4], userId)
    redis.call('HDEL', KEYS[3], userId)
    redis.call('PUBLISH', ARGV[5], cjson.encode({type='presence:leave', payload={userId=userId}}))
  end
end
for _, id in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)) do remove(id) end
if ARGV[1] == 'present' then
  local user = cjson.decode(ARGV[3])
  if not redis.call('HGET', KEYS[1], ARGV[2]) then
    redis.call('HSET', KEYS[1], ARGV[2], user.userId)
    if redis.call('HINCRBY', KEYS[4], user.userId, 1) == 1 then
      redis.call('PUBLISH', ARGV[5], cjson.encode({type='presence:join', payload={user=user}}))
    end
  end
  redis.call('HSET', KEYS[3], user.userId, ARGV[3])
  redis.call('ZADD', KEYS[2], now + tonumber(ARGV[4]), ARGV[2])
elseif ARGV[1] == 'absent' then
  remove(ARGV[2])
end
if ARGV[1] == 'list' then return redis.call('HVALS', KEYS[3]) end
return {}
`;

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  colorForUser(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
  }

  /** Also renews a lease after a transport pong; UUIDs belong to one user only. */
  async markPresent(connectionId: string, user: PresenceUser): Promise<void> {
    await this.run("present", connectionId, user);
  }

  async markAbsent(connectionId: string): Promise<void> {
    await this.run("absent", connectionId);
  }

  /** Prunes abandoned leases and emits final-user leaves atomically on every instance. */
  async list(): Promise<PresenceUser[]> {
    return this.run("list");
  }

  private async run(operation: string, connectionId = "", user?: PresenceUser): Promise<PresenceUser[]> {
    const rows = await this.redis.eval(
      PRESENCE_SCRIPT, PRESENCE_KEYS.length, ...PRESENCE_KEYS,
      operation, connectionId, user ? JSON.stringify(user) : "", PRESENCE_LEASE_MS, BROADCAST_CHANNEL
    ) as string[];
    return rows.map((row) => JSON.parse(row) as PresenceUser);
  }
}
