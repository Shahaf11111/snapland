import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import type { Request, Response } from "express";
import { REDIS_CLIENT } from "../../database/redis.constants";
import { checkSlidingWindowRateLimit } from "./rate-limit.util";
import type { EnvConfig } from "../../config/env.validation";
import type { AuthenticatedUser } from "../../auth/jwt-payload.interface";

/**
 * Enforces the assignment's "max 50 drawing actions per minute per user"
 * limit on mutating area endpoints. Applied after JwtAuthGuard so
 * `req.user` is already populated.
 */
@Injectable()
export class DrawRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(DrawRateLimitGuard.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<EnvConfig, true>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const userId = req.user?.id;
    if (!userId) return true;

    const limit = this.config.get("RATE_LIMIT_MAX_PER_MINUTE", { infer: true });

    try {
      const { allowed, remaining } = await checkSlidingWindowRateLimit(this.redis, `ratelimit:draw:${userId}`, limit);
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      if (!allowed) {
        throw new HttpException(
          { error: "rate_limited", message: `Max ${limit} drawing actions per minute exceeded` },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Fail-open: if Redis is unavailable, do not block writes entirely.
      this.logger.warn(`rate limiter check failed, allowing request: ${(err as Error).message}`);
      return true;
    }
  }
}
