import type { UiAuditEvent, Area, AreaHistoryEntry, AuthTokens, BoundingBox, CreateAreaRequest, PublicUser, UpdateAreaRequest } from "@snapland/shared";
import { refreshSession } from "./refreshSession.js";
import type { AreaSearchPage } from "@snapland/shared";
import { API_URL } from "../env.js";
import { useAuthStore } from "../state/authStore.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const { accessToken } = useAuthStore.getState();

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && retry && accessToken) {
    try {
      await refreshSession(accessToken);
    } catch {
      throw new ApiError(401, "Session expired");
    }
    return request<T>(path, init, false);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  recordUiAction: (event: UiAuditEvent) => request<void>("/audit/events", { method: "POST", body: JSON.stringify(event) }),
  register: (email: string, password: string, name: string) =>
    request<{ user: PublicUser } & AuthTokens>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }, false),

  login: (email: string, password: string) =>
    request<{ user: PublicUser } & AuthTokens>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }, false),

  getAreasInBounds: (bbox: BoundingBox) =>
    request<{ areas: Area[] }>(
      `/areas?bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`
    ),

  getArea: (id: string) => request<{ area: Area }>(`/areas/${id}`),

  searchAreas: (search: string, cursor: string | null, signal: AbortSignal) => {
    const params = new URLSearchParams({ search, limit: "100" });
    if (cursor) params.set("cursor", cursor);
    return request<AreaSearchPage>(`/areas/search?${params}`, { signal });
  },

  createArea: (body: CreateAreaRequest) =>
    request<{ area: Area }>("/areas", { method: "POST", body: JSON.stringify(body) }),

  updateArea: (id: string, body: UpdateAreaRequest) =>
    request<{ area: Area }>(`/areas/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  deleteArea: (id: string, version: number) =>
    request<void>(`/areas/${id}?version=${version}`, { method: "DELETE" }),

  getAreaHistory: (id: string, signal?: AbortSignal) => request<{ history: AreaHistoryEntry[] }>(`/areas/${id}/history`, { signal }),

  logout: (refreshToken: string) =>
    request<void>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }),
};
