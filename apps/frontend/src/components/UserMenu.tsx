import { auditUiAction } from "../api/auditUiAction.js";
import { useRef, useState } from "react";
import { useAuthStore } from "../state/authStore.js";
import { useMapStore, CONNECTION_STATUS_LABEL } from "../state/mapStore.js";
import { useThemeStore, type ThemeMode } from "../state/themeStore.js";
import { api } from "../api/client.js";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; title: string }> = [
  { mode: "auto", label: "Auto", title: "Follow daylight hours (06:00–19:00 = light)" },
  { mode: "light", label: "Light", title: "Always light" },
  { mode: "dark", label: "Dark", title: "Always dark" },
];

const STATUS_RING: Record<string, string> = {
  open: "ring-success",
  connecting: "ring-warning",
  reconnecting: "ring-warning",
  offline: "ring-destructive",
};

/**
 * A single bottom-left anchored control: user avatar (its ring color is
 * the live connection-status indicator) that opens a menu containing the
 * connection status, theme picker, and logout. Rendered even when logged
 * out (as a plain settings/theme affordance) so there's one consistent
 * place for these controls regardless of auth state.
 */
export function UserMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const connectionStatus = useMapStore((s) => s.connectionStatus);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const logout = async () => {
    const { refreshToken } = useAuthStore.getState();
    try {
      if (refreshToken) await api.logout(refreshToken);
    } catch (err) {
      console.error("Logout request failed", err);
    } finally {
      clearSession();
    }
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow ring-2 ring-offset-2 ring-offset-background transition-shadow",
        user ? STATUS_RING[connectionStatus] : "ring-transparent"
      )}
      aria-label={user ? user.name : "Settings"}
    >
      {user ? user.name.slice(0, 1).toUpperCase() : "⚙"}
    </button>
  );

  return (
    <Tooltip
      open={tooltipOpen && !menuOpen}
      onOpenChange={(open) => {
        setTooltipOpen(open && !menuOpen && !restoringFocus.current);
      }}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setTooltipOpen(false);
          setMenuOpen(open);
          auditUiAction("ui.menu.toggle", { value: open ? "open" : "closed" });
        }}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          side="top"
          sideOffset={12}
          align="start"
          className="w-56"
          onCloseAutoFocus={(event) => {
            // Restore keyboard focus without treating it as a new tooltip request.
            event.preventDefault();
            restoringFocus.current = true;
            triggerRef.current?.focus();
            restoringFocus.current = false;
          }}
        >
          {user && (
            <>
              <DropdownMenuLabel className="flex flex-col gap-1">
                <span>{user.name}</span>
                <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <span className={`status-dot status-${connectionStatus}`} />
                  {CONNECTION_STATUS_LABEL[connectionStatus]}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}

          <div className="px-2 py-1.5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Theme</p>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(value) => { if (value) { setMode(value as ThemeMode); auditUiAction("ui.theme.change", { value: value as ThemeMode }); } }}
              className="w-full"
            >
              {THEME_OPTIONS.map((opt) => (
                <ToggleGroupItem key={opt.mode} value={opt.mode} size="sm" title={opt.title} className="flex-1">
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {user && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={logout}>
                Log out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent side="right">
        {user
          ? (<><strong>{`${user.name}`}</strong>
            <p>{`Connection status: ${CONNECTION_STATUS_LABEL[connectionStatus]}`}</p>
          </>)
          : "Settings"}
      </TooltipContent>
    </Tooltip>
  );
}
