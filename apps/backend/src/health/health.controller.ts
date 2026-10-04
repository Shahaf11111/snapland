import { Controller, Get, Header, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { PG_POOL } from "../database/database.constants";
import { REDIS_CLIENT } from "../database/redis.constants";
import { MetricsService } from "../metrics/metrics.service";

@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metricsService: MetricsService
  ) {}

  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  @Get("readyz")
  async readyz() {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const ready = dbOk && redisOk;
    if (!ready) {
      throw new ServiceUnavailableException({ status: "not_ready", db: dbOk, redis: redisOk });
    }
    return { status: "ready", db: dbOk, redis: redisOk };
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics() {
    return this.metricsService.render();
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
