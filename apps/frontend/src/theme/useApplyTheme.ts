import { useEffect } from "react";
import { refreshAutoTheme, useThemeStore } from "../state/themeStore.js";

const CHECK_INTERVAL_MS = 60_000;

/**
 * Reflects the resolved theme onto <html> two ways: the `dark` class,
 * which Tailwind's `darkMode: ["class"]` config and shadcn's CSS variables
 * key off, and the `data-theme` attribute, which the Leaflet dark-mode
 * rules in index.css use instead (kept independent of Tailwind's strategy
 * in case that ever changes). Also periodically re-checks "auto" mode
 * against the clock so the day/night switch happens live rather than only
 * on next page load.
 */
export function useApplyTheme(): void {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const id = setInterval(refreshAutoTheme, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
