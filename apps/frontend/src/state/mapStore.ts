import { create } from "zustand";
import type { Area, LngLat, PresenceUser } from "@snapland/shared";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "offline";

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline (changes will sync once reconnected)",
};

interface RemoteDraw {
  userId: string;
  points: LngLat[];
}

interface MapState {
  areas: Map<string, Area>;
  lastAreaChange: { id: string; area: Area | null } | null;
  presence: Map<string, PresenceUser>;
  remoteDraws: Map<string, RemoteDraw>;
  /** Advisory only — see CollabGateway/AreaEditingService. Keyed by areaId. */
  editingAreas: Map<string, PresenceUser>;
  connectionStatus: ConnectionStatus;

  setAreas: (areas: Area[]) => void;
  upsertArea: (area: Area) => void;
  removeArea: (areaId: string) => void;

  setPresenceList: (users: PresenceUser[]) => void;
  addPresence: (user: PresenceUser) => void;
  removePresence: (userId: string) => void;

  setRemoteDraw: (userId: string, points: LngLat[]) => void;
  clearRemoteDraw: (userId: string) => void;

  setEditingAreas: (editing: Record<string, PresenceUser>) => void;

  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useMapStore = create<MapState>((set) => ({
  areas: new Map(),
  lastAreaChange: null,
  presence: new Map(),
  remoteDraws: new Map(),
  editingAreas: new Map(),
  connectionStatus: "connecting",

  setAreas: (areas) => set({ areas: new Map(areas.map((a) => [a.id, a])) }),
  upsertArea: (area) =>
    set((state) => {
      const next = new Map(state.areas);
      next.set(area.id, area);
      return { areas: next, lastAreaChange: { id: area.id, area } };
    }),
  removeArea: (areaId) =>
    set((state) => {
      const next = new Map(state.areas);
      next.delete(areaId);
      return { areas: next, lastAreaChange: { id: areaId, area: null } };
    }),

  setPresenceList: (users) => set({ presence: new Map(users.map((u) => [u.userId, u])) }),
  addPresence: (user) =>
    set((state) => {
      const next = new Map(state.presence);
      next.set(user.userId, user);
      return { presence: next };
    }),
  removePresence: (userId) =>
    set((state) => {
      const next = new Map(state.presence);
      next.delete(userId);
      return { presence: next };
    }),

  setRemoteDraw: (userId, points) =>
    set((state) => {
      const next = new Map(state.remoteDraws);
      next.set(userId, { userId, points });
      return { remoteDraws: next };
    }),
  clearRemoteDraw: (userId) =>
    set((state) => {
      const next = new Map(state.remoteDraws);
      next.delete(userId);
      return { remoteDraws: next };
    }),

  setEditingAreas: (editing) => set({ editingAreas: new Map(Object.entries(editing)) }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
