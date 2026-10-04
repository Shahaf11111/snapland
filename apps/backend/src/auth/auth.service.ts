import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";
import { AuthRepository, type UserRow } from "./auth.repository";
import { TokenService } from "./token.service";
import { AuditService } from "../audit/audit.service";
import type { EnvConfig } from "../config/env.validation";
import type { PublicUser } from "@snapland/shared";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function toPublicUser(user: UserRow): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.created_at };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>
  ) {}

  async register(email: string, password: string, name: string) {
    const existing = await this.repo.findUserByEmail(email);
    if (existing) {
      throw new ConflictException({ error: "email_taken", message: "Email already registered" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.repo.createUser(email, passwordHash, name);
    const tokens = await this.issueTokens(user);
    await this.audit.record({ userId: user.id, action: "user.register", entityType: "user", entityId: user.id });
    return { user: toPublicUser(user), ...tokens };
  }

  async login(email: string, password: string) {
    const user = await this.repo.findUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException({ error: "invalid_credentials", message: "Invalid email or password" });
    }
    const tokens = await this.issueTokens(user);
    await this.audit.record({ userId: user.id, action: "user.login", entityType: "user", entityId: user.id });
    return { user: toPublicUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    const payload = this.verifyRefreshTokenOrThrow(refreshToken);
    const session = await this.repo.findSessionById(payload.sessionId);

    if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedException({ error: "invalid_session", message: "Session expired or revoked" });
    }
    const matches = await bcrypt.compare(refreshToken, session.refresh_token_hash);
    if (!matches) {
      throw new UnauthorizedException({ error: "invalid_session", message: "Refresh token mismatch" });
    }

    const user = await this.repo.findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException({ error: "invalid_session", message: "User no longer exists" });
    }

    // Rotate: revoke the old session, issue a brand-new one.
    await this.repo.revokeSession(session.id);
    const tokens = await this.issueTokens(user);
    await this.audit.record({ userId: user.id, action: "user.refresh", entityType: "user", entityId: user.id });
    return { user: toPublicUser(user), ...tokens };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const payload = this.verifyRefreshTokenOrThrow(refreshToken);
    await this.repo.revokeSession(payload.sessionId);
    await this.audit.record({ userId, action: "user.logout", entityType: "user", entityId: userId });
  }

  private verifyRefreshTokenOrThrow(refreshToken: string) {
    try {
      return this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException({ error: "invalid_session", message: "Invalid refresh token" });
    }
  }

  private async issueTokens(user: UserRow): Promise<AuthTokens> {
    const accessToken = this.tokens.signAccessToken({ sub: user.id, email: user.email, name: user.name });

    // Generate the session id up front so it can be embedded in the
    // refresh JWT before the row exists, then store only a hash of the
    // refresh token so a leaked DB never yields usable tokens directly.
    const sessionId = crypto.randomUUID();
    const refreshToken = this.tokens.signRefreshToken({ sub: user.id, sessionId });
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const ttlSeconds = this.config.get("JWT_REFRESH_TTL_SECONDS", { infer: true });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.repo.createSession(sessionId, user.id, refreshTokenHash, expiresAt);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.get("JWT_ACCESS_TTL_SECONDS", { infer: true }),
    };
  }
}
