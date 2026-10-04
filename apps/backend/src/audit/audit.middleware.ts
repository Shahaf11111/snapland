import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedUser } from "../auth/jwt-payload.interface";
import { AREA_ID_PATTERN } from "../common/pipes/area-id.pipe";
import { AuditService } from "./audit.service";

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private readonly audit: AuditService) {}

  use(req: Request & { user?: AuthenticatedUser }, res: Response, next: NextFunction): void {
    if (req.method === "GET" && ["/healthz", "/readyz", "/metrics"].includes(req.path)) return next();
    const requestId = randomUUID();
    const start = Date.now();
    let recorded = false;
    res.setHeader("X-Request-Id", requestId);
    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const id = req.params?.id;
      void this.audit.record({
        userId: req.user?.id ?? res.locals.auditUserId ?? null,
        action: "http.request",
        entityType: "request",
        entityId: typeof id === "string" && AREA_ID_PATTERN.test(id) ? id : null,
        metadata: {
          requestId,
          // Matched route templates only: no raw URL, query, headers or body.
          route: typeof req.route?.path === "string" ? req.route.path : "unmatched",
          method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(req.method) ? req.method : "OTHER",
          statusCode: aborted ? null : res.statusCode,
          outcome: aborted ? "aborted" : res.statusCode >= 400 ? "rejected" : "success",
          durationMs: Date.now() - start,
        },
      });
    };
    res.once("finish", () => record(false));
    res.once("close", () => record(!res.writableFinished));
    next();
  }
}
