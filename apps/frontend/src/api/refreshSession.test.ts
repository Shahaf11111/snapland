import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@snapland/shared";
import { api } from "./client.js";
import { refreshSession } from "./refreshSession.js";
import { SocketAuthRecovery } from "../ws/SocketAuthRecovery.js";
import { useAuthStore } from "../state/authStore.js";

const user = { id: "user", name: "Test", email: "test@example.com" } as PublicUser;
const response = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const refreshed = () => response(200, { user, accessToken: "new-access", refreshToken: "new-refresh" });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { useAuthStore.getState().setSession(user, "old-access", "old-refresh"); });
afterEach(() => { vi.unstubAllGlobals(); useAuthStore.getState().clearSession(); });

describe("shared session refresh", () => {
  it("shares one refresh between an API 401 and rejected socket authentication", async () => {
    const gate = deferred();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return gate.promise;
      if ((init?.headers as Record<string, string>).Authorization === "Bearer old-access") return response(401);
      return response(200, { area: { id: "area" } });
    });
    vi.stubGlobal("fetch", fetch);
    const request = api.getArea("area");
    const recovery = new SocketAuthRecovery().recover("old-access");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    gate.resolve(refreshed());
    await expect(recovery).resolves.toBe("new-access");
    await expect(request).resolves.toEqual({ area: { id: "area" } });
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(useAuthStore.getState().refreshToken).toBe("new-refresh");
  });

  it("reuses an already renewed credential for a late rejection", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    useAuthStore.getState().setSession(user, "new-access", "new-refresh");
    await expect(refreshSession("old-access")).resolves.toBe("new-access");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["logout", "replacement"])("does not restore an obsolete session after %s", async (action) => {
    const gate = deferred();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const refresh = refreshSession("old-access");
    const rejected = expect(refresh).rejects.toThrow("Session changed");
    if (action === "logout") useAuthStore.getState().clearSession();
    else useAuthStore.getState().setSession({ ...user, id: "other" }, "other-access", "other-refresh");
    gate.resolve(refreshed());
    await rejected;
    expect(useAuthStore.getState().accessToken).toBe(action === "logout" ? null : "other-access");
  });

  it.each([401, 503])("clears the matching session when refresh fails with %s", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => response(status)));
    await expect(refreshSession("old-access")).rejects.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("clears the matching session on network failure or missing refresh credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(refreshSession("old-access")).rejects.toThrow("offline");
    useAuthStore.setState({ user, accessToken: "old-access", refreshToken: null });
    await expect(refreshSession("old-access")).rejects.toThrow("Session expired");
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("stops when a refreshed socket credential is rejected again before readiness", async () => {
    const fetch = vi.fn(async () => refreshed());
    vi.stubGlobal("fetch", fetch);
    const recovery = new SocketAuthRecovery();
    await recovery.recover("old-access");
    await expect(recovery.recover("new-access")).rejects.toThrow("Refreshed socket authentication rejected");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("permits a later refresh after a successful socket handshake", async () => {
    const fetch = vi.fn(async () => refreshed());
    vi.stubGlobal("fetch", fetch);
    const recovery = new SocketAuthRecovery();
    await recovery.recover("old-access");
    recovery.ready();
    await expect(recovery.recover("new-access")).resolves.toBe("new-access");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not log out after a successful refresh followed by an ordinary API failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(response(409, { message: "Version conflict" })));
    await expect(api.getArea("area")).rejects.toMatchObject({ status: 409 });
    expect(useAuthStore.getState().accessToken).toBe("new-access");
  });
});
