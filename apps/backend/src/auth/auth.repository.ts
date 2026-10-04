import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.constants";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async createUser(email: string, passwordHash: string, name: string): Promise<UserRow> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *`,
      [email, passwordHash, name]
    );
    return rows[0];
  }

  /** Takes an application-generated `id` (rather than relying on the
   *  column's `gen_random_uuid()` default) so the caller can embed the
   *  same session id in the refresh JWT it signs before this row exists. */
  async createSession(id: string, userId: string, refreshTokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [id, userId, refreshTokenHash, expiresAt]
    );
  }

  async findSessionById(id: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [id]);
  }
}
