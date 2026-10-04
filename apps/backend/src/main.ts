import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuditMiddleware } from "./audit/audit.middleware";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger, ValidationPipe } from "@nestjs/common";
import { WsAdapter } from "@nestjs/platform-ws";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import type { EnvConfig } from "./config/env.validation";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Audit before parsing so malformed/oversized JSON is recorded as well.
  const audit = app.get(AuditMiddleware);
  app.use(audit.use.bind(audit));
  app.useBodyParser("json", { limit: "100kb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "100kb" });
  const config = app.get(ConfigService<EnvConfig, true>);

  app.enableCors({
    origin: config.get("CORS_ORIGIN", { infer: true }).split(","),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  // Raw `ws` instead of the default socket.io adapter — keeps the
  // WebSocket layer dependency-light and matches the assignment's
  // "no third-party plugins for the collaborative features" constraint.
  app.useWebSocketAdapter(new WsAdapter(app));

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Snapland API")
      .setDescription(
        "REST endpoints for the collaborative GIS backend. The WebSocket gateway " +
          "(presence, draft previews, area broadcasts) is documented separately in docs/api-reference.md."
      )
      .setVersion("1.0")
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "access-token")
      .build()
  );
  SwaggerModule.setup("docs", app, swaggerDocument);

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  Logger.log(`Backend listening on port ${port} (${config.get("NODE_ENV", { infer: true })})`, "Bootstrap");
}

bootstrap().catch((err) => {
  Logger.error("fatal error during startup", err);
  process.exit(1);
});
