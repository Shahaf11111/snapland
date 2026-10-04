import { Global, Inject, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { PG_POOL } from "./database.constants";
import type { EnvConfig } from "../config/env.validation";

/**
 * A single shared pg.Pool per process, exposed as a DI token. Pool size is
 * deliberately capped — with N backend instances behind a load balancer,
 * total Postgres connections stay bounded at N * max instead of growing
 * unboundedly.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const logger = new Logger("DatabaseModule");
        const pool = new Pool({
          connectionString: config.get("DATABASE_URL", { infer: true }),
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        });
        pool.on("error", (err) => logger.error("Unexpected error on idle Postgres client", err));
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
