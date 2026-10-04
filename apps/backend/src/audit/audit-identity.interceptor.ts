import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { tap } from "rxjs";
import { AREA_ID_PATTERN } from "../common/pipes/area-id.pipe";

/** Attribute successful login/register/refresh to the server-verified actor. */
@Injectable()
export class AuditIdentityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(tap((result: unknown) => {
      if (!["/auth/register", "/auth/login", "/auth/refresh"].includes(req.route?.path)) return;
      const userId = (result as { user?: { id?: unknown } } | null)?.user?.id;
      if (typeof userId === "string" && AREA_ID_PATTERN.test(userId)) res.locals.auditUserId = userId;
    }));
  }
}
