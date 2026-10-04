import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validate } from "./config/env.validation";
import { DatabaseModule } from "./database/database.module";
import { RedisModule } from "./database/redis.module";
import { MetricsModule } from "./metrics/metrics.module";
import { AuditModule } from "./audit/audit.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AreasModule } from "./areas/areas.module";
import { WebsocketModule } from "./websocket/websocket.module";
import { MetricsMiddleware } from "./common/middleware/metrics.middleware";
import { RequestTimeoutMiddleware } from "./common/middleware/request-timeout.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    DatabaseModule,
    RedisModule,
    MetricsModule,
    AuditModule,
    HealthModule,
    AuthModule,
    AreasModule,
    WebsocketModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestTimeoutMiddleware, MetricsMiddleware).forRoutes("*");
  }
}
