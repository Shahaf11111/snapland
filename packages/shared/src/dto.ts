import type { AreaGeometry } from "./geo";
import type { Area } from "./models";

export interface AreaSearchPage {
  areas: Area[];
  nextCursor: string | null;
  total: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CreateAreaRequest {
  name: string;
  geometry: AreaGeometry;
}

export interface UpdateAreaRequest {
  name?: string;
  geometry?: AreaGeometry;
  /** Optimistic-concurrency guard: must match the area's current version. */
  version: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
