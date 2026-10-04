export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}
