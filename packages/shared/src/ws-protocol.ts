import type { Area } from "./models";
import type { LngLat } from "./geo";

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
}

/** Messages sent from a client to the server. */
export type ClientMessage =
  | { type: "draw:progress"; payload: { points: LngLat[] } }
  | { type: "draw:cancel"; payload: Record<string, never> }
  | { type: "viewport:update"; payload: { bbox: [number, number, number, number] } }
  | { type: "area:editing:start"; payload: { areaId: string } }
  | { type: "area:editing:stop"; payload: { areaId: string } };

/** Messages sent from the server to clients. */
export type WebSocketErrorCode = "invalid_json" | "invalid_message" | "rate_limited" | "unauthorized" | "internal_error";

export type ServerMessage =
  | { type: "presence:list"; payload: { users: PresenceUser[] } }
  | { type: "presence:join"; payload: { user: PresenceUser } }
  | { type: "presence:leave"; payload: { userId: string } }
  | { type: "draw:progress"; payload: { userId: string; points: LngLat[] } }
  | { type: "draw:cancel"; payload: { userId: string } }
  | { type: "area:created"; payload: { area: Area } }
  | { type: "area:updated"; payload: { area: Area } }
  | { type: "area:deleted"; payload: { areaId: string } }
  /** Full snapshot of who's currently editing which saved area — advisory
   *  only (not a lock); keyed by areaId. Resent on every change and on each
   *  heartbeat tick so late-joining/reconnecting clients catch up. */
  | { type: "area:editing:list"; payload: { editing: Record<string, PresenceUser> } }
  | { type: "error"; payload: { message: string; code?: WebSocketErrorCode } };

export const WS_CLIENT_MESSAGE_TYPES = [
  "draw:progress",
  "draw:cancel",
  "viewport:update",
  "area:editing:start",
  "area:editing:stop",
] as const;
