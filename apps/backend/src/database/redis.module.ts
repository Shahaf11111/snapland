import { Global, Inject, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { REDIS_CLIENT, REDIS_SUB_CLIENT } from "./redis.constants";
import type { EnvConfig } from "../config/env.validation";

function createClient(config: ConfigService<EnvConfig, true>, label: string): Redis {
  const logger = new Logger(label);
  const client = new Redis(config.get("REDIS_URL", { infer: true }), {
    maxRetriesPerRequest: 2,
  });
  client.on("error", (err) => logger.error("Redis client error", err));
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => createClient(config, "RedisClient"),
    },
    {
      provide: REDIS_SUB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => createClient(config, "RedisSubClient"),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_SUB_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly redisSub: Redis
  ) {}

  async onModuleDestroy() {
    await Promise.allSettled([this.redis.quit(), this.redisSub.quit()]);
  }
}
