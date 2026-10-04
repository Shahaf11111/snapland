import { create } from "zustand";
import { isDaytime } from "../theme/daylight.js";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "snapland.theme";

function loadPersistedMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  } catch {
    // localStorage unavailable (private mode etc.) — fall back to auto.
  }
  return "auto";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "auto" ? (isDaytime() ? "light" : "dark") : mode;
}

const initialMode = loadPersistedMode();

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  resolvedTheme: resolveTheme(initialMode),
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore — the choice just won't persist across reloads
    }
    set({ mode, resolvedTheme: resolveTheme(mode) });
  },
}));

/**
 * Re-evaluates "auto" mode's resolved theme against the current time. A
 * no-op when the user has an explicit light/dark preference. Called on an
 * interval (see `useApplyTheme`) so the UI flips at the day/night boundary
 * on its own, without a page reload.
 */
export function refreshAutoTheme(): void {
  const { mode } = useThemeStore.getState();
  if (mode !== "auto") return;
  useThemeStore.setState({ resolvedTheme: resolveTheme("auto") });
}
