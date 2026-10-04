import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import type { EnvConfig } from "../config/env.validation";
import type { AccessTokenPayload, RefreshTokenPayload } from "./jwt-payload.interface";

/**
 * Access and refresh tokens use two different secrets and lifetimes, so
 * they're issued/verified through separate jsonwebtoken calls here rather
 * than a single @nestjs/jwt module instance (which only holds one secret).
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  signAccessToken(payload: AccessTokenPayload): string {
    const secret: Secret = this.config.get("JWT_ACCESS_SECRET", { infer: true });
    const options: SignOptions = { expiresIn: this.config.get("JWT_ACCESS_TTL_SECONDS", { infer: true }) };
    return jwt.sign(payload, secret, options);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const secret: Secret = this.config.get("JWT_ACCESS_SECRET", { infer: true });
    return jwt.verify(token, secret) as AccessTokenPayload;
  }

  signRefreshToken(payload: RefreshTokenPayload): string {
    const secret: Secret = this.config.get("JWT_REFRESH_SECRET", { infer: true });
    const options: SignOptions = { expiresIn: this.config.get("JWT_REFRESH_TTL_SECONDS", { infer: true }) };
    return jwt.sign(payload, secret, options);
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const secret: Secret = this.config.get("JWT_REFRESH_SECRET", { infer: true });
    return jwt.verify(token, secret) as RefreshTokenPayload;
  }
}
