import { create } from "zustand";
import type { PublicUser } from "@snapland/shared";

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: PublicUser, accessToken: string, refreshToken: string) => void;
  clearSession: () => void;
}

const STORAGE_KEY = "snapland.session";

function loadPersisted(): Pick<AuthState, "user" | "accessToken" | "refreshToken"> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, accessToken: null, refreshToken: null };
    return JSON.parse(raw);
  } catch {
    return { user: null, accessToken: null, refreshToken: null };
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadPersisted(),
  setSession: (user, accessToken, refreshToken) => {
    const session = { user, accessToken, refreshToken };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // localStorage unavailable (private mode etc.) — session just won't persist across reloads.
    }
    set(session);
  },
  clearSession: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
