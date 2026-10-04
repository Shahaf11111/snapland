import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditIdentityInterceptor } from "./audit-identity.interceptor";
import { UiAuditController } from "./ui-audit.controller";
import { AuditMiddleware } from "./audit.middleware";
import { AuditService } from "./audit.service";

@Global()
@Module({
  controllers: [UiAuditController],
  providers: [AuditService, AuditMiddleware, { provide: APP_INTERCEPTOR, useClass: AuditIdentityInterceptor }],
  exports: [AuditService, AuditMiddleware],
})
export class AuditModule {}
