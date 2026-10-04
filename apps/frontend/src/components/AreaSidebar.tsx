import { auditUiAction } from "../api/auditUiAction.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRight, Focus, History, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { Area, PresenceUser } from "@snapland/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getVisibleRange } from "./virtualRange";
import { useAreaSearch } from "./useAreaSearch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface AreaSidebarProps {
  onDelete: (area: Area) => void;
  onFocus: (area: Area) => void;
  onEdit: (area: Area) => void;
  onHistory: (area: Area) => void;
  onDraw: () => void;
  onClose: () => void;
  editDisabled?: boolean;
  /** Advisory only — see AreaEditingService. Keyed by areaId. */
  editingAreas: Map<string, PresenceUser>;
  currentUserId: string | undefined;
  deleteError: string | null;
  onDismissDeleteError: () => void;
}

type Side = "left" | "right";

const ROW_HEIGHT = 60;

const SIDE_KEY = "snapland.areaSidebar.side";

function loadSide(): Side {
  try {
    return localStorage.getItem(SIDE_KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

/** Visibility is owned by the main toolbar's "Areas" toggle (see
 *  MapView.tsx); this panel only manages which side it docks to. */
export function AreaSidebar({
  onDelete,
  onFocus,
  onEdit,
  onHistory,
  onDraw,
  onClose,
  editDisabled,
  editingAreas,
  currentUserId,
  deleteError,
  onDismissDeleteError,
}: AreaSidebarProps) {
  const [side, setSide] = useState<Side>(loadSide);
  const [query, setQuery] = useState("");
  const { areas: filteredAreas, total, nextCursor, loading, error, loadMore } = useAreaSearch(query);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    element.scrollTop = 0;
    setViewport({ top: 0, height: element.clientHeight });
  }, [query]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const maxTop = Math.max(0, filteredAreas.length * ROW_HEIGHT - element.clientHeight);
    if (element.scrollTop > maxTop) element.scrollTop = maxTop;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [filteredAreas.length]);

  const { start, end } = getVisibleRange(filteredAreas.length, viewport.top, viewport.height, ROW_HEIGHT);
  const visibleIndexes = Array.from({ length: end - start }, (_, index) => start + index);
  // Keep a focused row mounted while scrolling, including its open actions menu.
  const focusedIndex = focusedAreaId ? filteredAreas.findIndex((area) => area.id === focusedAreaId) : -1;
  if (focusedIndex >= 0 && !visibleIndexes.includes(focusedIndex)) {
    visibleIndexes.push(focusedIndex);
    visibleIndexes.sort((a, b) => a - b);
  }

  useEffect(() => {
    if (nextCursor && !loading && !error && end >= filteredAreas.length - 10) loadMore();
  }, [nextCursor, loading, error, end, filteredAreas.length, loadMore]);

  const toggleSide = () => {
    const next = side === "left" ? "right" : "left";
    setSide(next);
    auditUiAction("ui.areas.dock", { value: next });
    try {
      localStorage.setItem(SIDE_KEY, next);
    } catch {
      // ignore — the choice just won't persist across reloads
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-h-0 w-[260px] max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg md:h-full md:flex-none",
        side === "left" ? "self-start md:order-first" : "self-end md:order-last md:ml-auto"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Badge variant="secondary">{total ?? "…"}</Badge>
        <h3 className="px-1 flex-1 whitespace-nowrap text-sm font-semibold">Areas</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onDraw}
              disabled={editDisabled}
              aria-label="Add area"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Draw a new area</TooltipContent>
        </Tooltip>
        <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-border pl-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground/60 hover:text-foreground"
              onClick={toggleSide}
              aria-label={`Move panel to the ${side === "left" ? "right" : "left"}`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Move panel to the {side === "left" ? "right" : "left"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground/60 hover:text-foreground"
              onClick={() => { auditUiAction("ui.areas.panel", { value: "closed" }); onClose(); }}
              aria-label="Close panel"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close panel</TooltipContent>
        </Tooltip>
        </div>
      </div>

      <AreaSearch onSearch={setQuery} />

      {deleteError && (
        <div role="alert" className="flex items-start gap-2 border-b border-border bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <p className="min-w-0 flex-1">{deleteError}</p>
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onDismissDeleteError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div
        ref={viewportRef}
        role="region"
        aria-label="Areas list"
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2"
        onScroll={(event) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
      >
        <ul className="relative" style={{ height: filteredAreas.length ? filteredAreas.length * ROW_HEIGHT : undefined }}>
          {visibleIndexes.map((index) => {
            const area = filteredAreas[index];
            const editor = editingAreas.get(area.id);
            const editedByOther = editor && editor.userId !== currentUserId;
            return (
            <li
              key={area.id}
              aria-posinset={index + 1}
              aria-setsize={total ?? filteredAreas.length}
              onFocusCapture={() => setFocusedAreaId(area.id)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedAreaId(null);
              }}
              className="absolute inset-x-0 flex items-center justify-between gap-2 border-b border-border py-1.5"
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{area.name}</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => onFocus(area)}
                        aria-label={`Focus map on ${area.name}`}
                      >
                        <Focus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Focus on area</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label={`Actions for ${area.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={editDisabled} onSelect={() => onEdit(area)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onHistory(area)}>
                        <History className="mr-2 h-4 w-4" />
                        History
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => onDelete(area)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="shrink-0 text-xs text-muted-foreground">{Number(area.sizeKm2.toFixed(3))} km²</p>
                  {editedByOther && (
                    <Badge variant="outline" className="h-4 min-w-0 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground">
                      <Pencil className="h-2.5 w-2.5" />
                      <span className="truncate">Editing: {editor.name}</span>
                    </Badge>
                  )}
                </div>
              </div>
            </li>
            );
          })}
          {!loading && !error && filteredAreas.length === 0 && (
            <li role="status" className="px-1 py-2 text-sm text-muted-foreground">
              {query ? "No areas match your search." : "No saved areas yet."}
            </li>
          )}
        </ul>
        {loading && <p role="status" className="px-1 py-2 text-xs text-muted-foreground">Loading areas…</p>}
        {error && (
          <div role="alert" className="py-2 text-xs text-destructive">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={loadMore}>Retry</Button>
          </div>
        )}
        {nextCursor && !loading && !error && (
          <Button variant="ghost" size="sm" className="w-full" onClick={loadMore}>Load more</Button>
        )}
      </div>
    </div>
  );
}


// Keep keystrokes local so the area list only updates after typing pauses.
function AreaSearch({ onSearch }: { onSearch: (query: string) => void }) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onSearch(search.trim().toLocaleLowerCase());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, onSearch]);

  return (
      <div className="shrink-0 border-b border-border p-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Search areas…"
            aria-label="Search areas by name"
            className="h-8 pl-8"
          />
        </div>
      </div>
  );
}
