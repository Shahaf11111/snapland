import { useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage, LngLat } from "@snapland/shared";
import { WS_URL } from "../env.js";
import { useAuthStore } from "../state/authStore.js";
import { useMapStore } from "../state/mapStore.js";
import { SocketAuthRecovery } from "./SocketAuthRecovery.js";
import { DrawPreviewSender } from "./DrawPreviewSender.js";

const MAX_BACKOFF_MS = 15_000;

/**
 * Manages the collaborative WebSocket connection: auth handshake, message
 * dispatch into the map store, and graceful degradation — auto-reconnect
 * with exponential backoff, and a coalesced latest preview/cancel state.
 * Regular previews are throttled; drag end and cancellation send immediately.
 */
export function useCollabSocket() {
  const authRecovery = useRef(new SocketAuthRecovery());
  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const previewRef = useRef<DrawPreviewSender | null>(null);
  if (previewRef.current === null) {
    previewRef.current = new DrawPreviewSender((message) => {
      const ws = wsRef.current;
      if (!readyRef.current || !ws || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.warn("Failed to send drawing preview", err);
        return false;
      }
    });
  }
  const preview = previewRef.current;
  const attemptRef = useRef(0);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    preview.reset();
    readyRef.current = false;
    attemptRef.current = 0;
    if (!accessToken) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (cancelled) return;
      useMapStore.getState().setConnectionStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(accessToken)}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (cancelled || wsRef.current !== ws) return;
        const message = JSON.parse(event.data) as ServerMessage;
        const store = useMapStore.getState();
        switch (message.type) {
          case "presence:list":
            store.setPresenceList(message.payload.users);
            // The transport's open event precedes server authentication/setup.
            authRecovery.current.ready();
            readyRef.current = true;
            attemptRef.current = 0;
            store.setConnectionStatus("open");
            preview.flush();
            break;
          case "presence:join":
            store.addPresence(message.payload.user);
            break;
          case "presence:leave":
            store.removePresence(message.payload.userId);
            store.clearRemoteDraw(message.payload.userId);
            break;
          case "draw:progress":
            store.setRemoteDraw(message.payload.userId, message.payload.points);
            break;
          case "draw:cancel":
            store.clearRemoteDraw(message.payload.userId);
            break;
          case "area:created":
          case "area:updated":
            store.upsertArea(message.payload.area);
            break;
          case "area:deleted":
            store.removeArea(message.payload.areaId);
            break;
          case "area:editing:list":
            store.setEditingAreas(message.payload.editing);
            break;
          case "error":
            console.warn("WS server error:", message.payload.message);
            break;
        }
      };

      ws.onclose = (event) => {
        if (cancelled || wsRef.current !== ws) return;
        readyRef.current = false;
        useMapStore.getState().setConnectionStatus("offline");
        if (event.code === 4001) {
          useMapStore.getState().setConnectionStatus("reconnecting");
          void authRecovery.current.recover(accessToken).then((token) => {
            // Changed tokens restart this effect. Same-token refreshes still need
            // a new socket (JWTs issued within one second can be identical).
            if (!cancelled && token === accessToken) reconnectTimer = setTimeout(connect, 0);
          }).catch(() => {
            if (!cancelled) useMapStore.getState().setConnectionStatus("offline");
          });
          return;
        }
        const delay = Math.min(1000 * 2 ** attemptRef.current, MAX_BACKOFF_MS);
        attemptRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      readyRef.current = false;
      preview.reset();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [accessToken, preview]);

  const sendRaw = (message: ClientMessage) => {
    const ws = wsRef.current;
    if (!readyRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.warn("Failed to send WebSocket message", err);
    }
  };

  return {
    sendDrawProgress: (points: LngLat[], immediate = false) => preview.update(points, immediate),
    sendDrawCancel: () => preview.cancel(),
    /** Advisory "I'm editing this saved area" signal — not a lock; see
     *  AreaEditingService. Safe to call even if the socket isn't open yet. */
    sendEditingStart: (areaId: string) => sendRaw({ type: "area:editing:start", payload: { areaId } }),
    sendEditingStop: (areaId: string) => sendRaw({ type: "area:editing:stop", payload: { areaId } }),
  };
}
