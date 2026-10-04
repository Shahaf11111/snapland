import type { AuthTokens, PublicUser } from "@snapland/shared";
import { API_URL } from "../env.js";
import { useAuthStore } from "../state/authStore.js";

let pending: { refreshToken: string; promise: Promise<string> } | null = null;

/** One refresh per session in this tab. Never restore a logged-out/replaced session. */
export function refreshSession(rejectedAccessToken: string | null): Promise<string> {
  const session = useAuthStore.getState();
  if (session.accessToken && session.accessToken !== rejectedAccessToken) {
    return Promise.resolve(session.accessToken);
  }
  const refreshToken = session.refreshToken;
  if (!refreshToken) {
    if (session.accessToken === rejectedAccessToken) session.clearSession();
    return Promise.reject(new Error("Session expired"));
  }
  if (pending?.refreshToken === refreshToken) return pending.promise;

  const promise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) throw new Error("Session expired");
      const refreshed = await response.json() as { user: PublicUser } & AuthTokens;
      if (!refreshed.user?.id || !refreshed.accessToken || !refreshed.refreshToken) {
        throw new Error("Invalid refresh response");
      }
      const current = useAuthStore.getState();
      if (current.refreshToken !== refreshToken || current.accessToken !== rejectedAccessToken) {
        throw new Error("Session changed");
      }
      current.setSession(refreshed.user, refreshed.accessToken, refreshed.refreshToken);
      return refreshed.accessToken;
    } catch (error) {
      const current = useAuthStore.getState();
      if (current.refreshToken === refreshToken && current.accessToken === rejectedAccessToken) current.clearSession();
      throw error;
    } finally {
      if (pending?.refreshToken === refreshToken) pending = null;
    }
  })();
  pending = { refreshToken, promise };
  return promise;
}
