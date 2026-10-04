import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import type { BoundingBox } from "@snapland/shared";
import { REDIS_CLIENT } from "../database/redis.constants";
import type { AreaRow } from "./areas.repository";

const TTL_SECONDS = 30;
const VERSION_KEY = "areas:cache:version";

@Injectable()
export class AreasCache {
  private readonly logger = new Logger(AreasCache.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Quantize the bbox to a coarse grid so nearby pans/zooms share a cache entry. */
  private key(bbox: BoundingBox, version: string): string {
    const q = (n: number) => Math.round(n * 100) / 100;
    return `areas:bounds:v${version}:${q(bbox.minLng)},${q(bbox.minLat)},${q(bbox.maxLng)},${q(bbox.maxLat)}`;
  }

  private async currentVersion(): Promise<string> {
    const v = await this.redis.get(VERSION_KEY);
    return v ?? "0";
  }

  async get(bbox: BoundingBox): Promise<AreaRow[] | null> {
    try {
      const version = await this.currentVersion();
      const raw = await this.redis.get(this.key(bbox, version));
      return raw ? (JSON.parse(raw) as AreaRow[]) : null;
    } catch (err) {
      this.logger.warn(`areas cache read failed, falling back to DB: ${(err as Error).message}`);
      return null;
    }
  }

  async set(bbox: BoundingBox, rows: AreaRow[]): Promise<void> {
    try {
      const version = await this.currentVersion();
      await this.redis.set(this.key(bbox, version), JSON.stringify(rows), "EX", TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`areas cache write failed: ${(err as Error).message}`);
    }
  }

  /** Invalidate all bounds-query cache entries by bumping a version tag
   *  (cheaper than scanning/deleting every quantized key individually). */
  async invalidate(): Promise<void> {
    try {
      await this.redis.incr(VERSION_KEY);
    } catch (err) {
      this.logger.warn(`areas cache invalidation failed: ${(err as Error).message}`);
    }
  }
}
