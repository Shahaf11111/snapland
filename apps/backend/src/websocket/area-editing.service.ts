import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { PresenceUser } from "@snapland/shared";
import { REDIS_CLIENT } from "../database/redis.constants";

const AREA_EDITING_KEY = "area-editing:v1:current";
const LEASE_MS = 30_000;

interface EditingEntry {
  user: PresenceUser;
  connectionId: string;
  expiresAt: number;
}

/**
 * Advisory "who's editing this saved area" signal — not a lock. It never
 * blocks a write; the version check in AreasService remains the only thing
 * that actually prevents a lost update. This just lets other viewers see a
 * heads-up before they start editing the same area and collide.
 *
 * Modeled on PresenceService's lease pattern but deliberately simpler: one
 * Redis hash (areaId -> entry with an embedded expiry), checked lazily in
 * application code instead of a Lua script + companion expiry ZSET. Losing
 * a stale entry a few seconds late, or racing two near-simultaneous starts,
 * only affects a UI hint — not data integrity — so the extra atomicity
 * PresenceService needs for join/leave counting isn't worth it here.
 */
@Injectable()
export class AreaEditingService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async start(areaId: string, connectionId: string, user: PresenceUser): Promise<void> {
    const entry: EditingEntry = { user, connectionId, expiresAt: Date.now() + LEASE_MS };
    await this.redis.hset(AREA_EDITING_KEY, areaId, JSON.stringify(entry));
  }

  /** Only clears the lease if it's still owned by this connection, so a
   *  stale/duplicate stop can't clobber a newer editor's active lease. */
  async stop(areaId: string, connectionId: string): Promise<void> {
    const raw = await this.redis.hget(AREA_EDITING_KEY, areaId);
    if (!raw) return;
    const entry = this.parse(raw);
    if (entry?.connectionId === connectionId) {
      await this.redis.hdel(AREA_EDITING_KEY, areaId);
    }
  }

  async renew(areaId: string, connectionId: string): Promise<void> {
    const raw = await this.redis.hget(AREA_EDITING_KEY, areaId);
    if (!raw) return;
    const entry = this.parse(raw);
    if (entry?.connectionId !== connectionId) return;
    entry.expiresAt = Date.now() + LEASE_MS;
    await this.redis.hset(AREA_EDITING_KEY, areaId, JSON.stringify(entry));
  }

  /** Snapshot for broadcast; opportunistically sweeps anything past its
   *  lease (a crashed tab that never sent `area:editing:stop`). */
  async list(): Promise<Record<string, PresenceUser>> {
    const raw = await this.redis.hgetall(AREA_EDITING_KEY);
    const now = Date.now();
    const result: Record<string, PresenceUser> = {};
    const expired: string[] = [];
    for (const [areaId, value] of Object.entries(raw)) {
      const entry = this.parse(value);
      if (!entry) { expired.push(areaId); continue; }
      if (entry.expiresAt <= now) { expired.push(areaId); continue; }
      result[areaId] = entry.user;
    }
    if (expired.length > 0) await this.redis.hdel(AREA_EDITING_KEY, ...expired);
    return result;
  }

  private parse(raw: string): EditingEntry | null {
    try {
      return JSON.parse(raw) as EditingEntry;
    } catch {
      return null;
    }
  }
}
