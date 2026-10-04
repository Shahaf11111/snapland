import { auditUiAction } from "../api/auditUiAction.js";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Check, Layers, ZoomIn, ZoomOut, X } from "lucide-react";
import type { Area, AreaGeometry, LngLat } from "@snapland/shared";
import { createOsmLayer, createSatelliteLayer } from "./baseLayers.js";
import { BoundsAreaLoader } from "./BoundsAreaLoader.js";
import { DrawController } from "./DrawController.js";
import { LayerSwitcher } from "./LayerSwitcher.js";
import { useMapStore } from "../state/mapStore.js";
import { useAuthStore } from "../state/authStore.js";
import { useCollabSocket } from "../ws/useCollabSocket.js";
import { api, ApiError } from "../api/client.js";
import { PresenceBar } from "../components/PresenceBar.js";
import { AreaSidebar } from "../components/AreaSidebar.js";
import { AreaHistoryDialog } from "../components/AreaHistoryDialog.js";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const DEFAULT_CENTER: L.LatLngTuple = [32.0853, 34.7818]; // Tel Aviv
const DEFAULT_ZOOM = 14;
const AREAS_PANEL_OPEN_KEY = "snapland.areaSidebar.open";

function loadAreasPanelOpen(): boolean {
  try {
    return localStorage.getItem(AREAS_PANEL_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function MapView() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const streetLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const areaLayersRef = useRef<Map<string, L.Polygon>>(new Map());
  const remoteDrawLayersRef = useRef<Map<string, L.Polyline>>(new Map());
  const drawControllerRef = useRef<DrawController | null>(null);

  const [layer, setLayer] = useState<"street" | "satellite">("street");
  const [drawing, setDrawing] = useState(false);
  const [drawingPointCount, setDrawingPointCount] = useState(0);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [liveAreaKm2, setLiveAreaKm2] = useState<number | null>(null);
  const [pendingName, setPendingName] = useState<LngLat[] | null>(null);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [savingArea, setSavingArea] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictArea, setConflictArea] = useState<Area | null>(null);
  const [areasPanelOpen, setAreasPanelOpen] = useState(loadAreasPanelOpen);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Area | null>(null);
  const [historyArea, setHistoryArea] = useState<Area | null>(null);
  const [deletingArea, setDeletingArea] = useState(false);
  const editingAreaIdRef = useRef<string | null>(null);

  const areas = useMapStore((s) => s.areas);
  const presence = useMapStore((s) => s.presence);
  const remoteDraws = useMapStore((s) => s.remoteDraws);
  const editingAreas = useMapStore((s) => s.editingAreas);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { sendDrawProgress, sendDrawCancel, sendEditingStart, sendEditingStop } = useCollabSocket();

  useEffect(() => {
    editingAreaIdRef.current = editingArea?.id ?? null;
  }, [editingArea]);

  // --- Map + base layer setup (once) ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Zoom control is disabled here in favor of the custom +/- buttons in
    // the consolidated toolbar below, so there's a single control cluster
    // instead of Leaflet's default control overlapping it in the same corner.
    const map = L.map(mapContainerRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: false });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
    });
    resizeObserver.observe(mapContainerRef.current);

    const street = createOsmLayer().addTo(map);
    const satellite = createSatelliteLayer();
    streetLayerRef.current = street;
    satelliteLayerRef.current = satellite;

    drawControllerRef.current = new DrawController(map, {
      onProgress: (points, areaKm2, immediate) => {
        setDrawingError(null);
        setDrawingPointCount(points.length);
        setLiveAreaKm2(areaKm2);
        sendDrawProgress(points, immediate);
      },
      onComplete: (points, areaKm2) => {
        auditUiAction("ui.drawing.finish");
        setLiveAreaKm2(areaKm2);
        setPendingName(points);
        setDrawing(false);
        sendDrawCancel();
      },
      onValidationError: setDrawingError,
      onCancel: () => {
        auditUiAction("ui.drawing.cancel");
        if (editingAreaIdRef.current) sendEditingStop(editingAreaIdRef.current);
        setEditingArea(null);
        setLiveAreaKm2(null);
        setDrawing(false);
        sendDrawCancel();
      },
    });

    const boundsLoader = new BoundsAreaLoader(
      () => {
        const b = map.getBounds();
        return { minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() };
      },
      api.getAreasInBounds,
      (err) => console.error("Failed to load areas in bounds", err),
    );
    const refreshBounds = () => { void boundsLoader.refresh(); };
    const auditMapMove = () => auditUiAction("ui.map.move");
    map.on("moveend", auditMapMove);

    map.on("moveend", refreshBounds);
    refreshBounds();

    return () => {
      boundsLoader.dispose();
      map.off("moveend", refreshBounds);
      map.off("moveend", auditMapMove);
      resizeObserver.disconnect();
      drawControllerRef.current?.destroy();
      drawControllerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Base layer switching ---
  useEffect(() => {
    const map = mapRef.current;
    const street = streetLayerRef.current;
    const satellite = satelliteLayerRef.current;
    if (!map || !street || !satellite) return;

    const next = layer === "satellite" ? satellite : street;
    const previous = layer === "satellite" ? street : satellite;
    if (!map.hasLayer(next)) map.addLayer(next);
    if (map.hasLayer(previous)) map.removeLayer(previous);
  }, [layer]);

  // --- Render persisted areas as polygons ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = areaLayersRef.current;

    for (const [id, poly] of existing) {
      if (!areas.has(id)) {
        map.removeLayer(poly);
        existing.delete(id);
      }
    }

    for (const area of areas.values()) {
      const latlngs = area.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      const tooltip = document.createElement("span");
      tooltip.textContent = `${area.name} — ${Number(area.sizeKm2.toFixed(3))} km²`;
      let poly = existing.get(area.id);
      if (!poly) {
        poly = L.polygon(latlngs, { color: "#16a34a", weight: 2, fillOpacity: 0.15 }).addTo(map);
        poly.bindTooltip(tooltip);
        existing.set(area.id, poly);
      } else {
        poly.setLatLngs(latlngs);
        poly.setTooltipContent(tooltip);
      }
    }
  }, [areas]);

  // --- Render other users' in-progress drawings ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = remoteDrawLayersRef.current;

    for (const [userId, line] of existing) {
      if (!remoteDraws.has(userId)) {
        map.removeLayer(line);
        existing.delete(userId);
      }
    }

    for (const draw of remoteDraws.values()) {
      const latlngs = draw.points.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      let line = existing.get(draw.userId);
      if (!line) {
        line = L.polyline(latlngs, { color: "#f97316", weight: 2, dashArray: "6 4" }).addTo(map);
        existing.set(draw.userId, line);
      } else {
        line.setLatLngs(latlngs);
      }
    }
  }, [remoteDraws]);

  const startDrawing = () => {
    auditUiAction("ui.drawing.start");
    setDrawingError(null);
    setSaveError(null);
    setDrawingPointCount(0);
    setDrawing(true);
    setLiveAreaKm2(0);
    drawControllerRef.current?.start();
  };

  const cancelDrawing = () => {
    drawControllerRef.current?.cancel();
  };

  const toggleAreasPanel = () => {
    auditUiAction("ui.areas.panel", { value: areasPanelOpen ? "closed" : "open" });
    setAreasPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AREAS_PANEL_OPEN_KEY, next ? "1" : "0");
      } catch {
        // ignore — the choice just won't persist across reloads
      }
      return next;
    });
  };

  const confirmArea = async (name: string) => {
    if (!pendingName || savingArea) return;
    setSavingArea(true);
    setSaveError(null);
    setConflictArea(null);
    const ring = [...pendingName, pendingName[0]];
    try {
      const geometry: AreaGeometry = { type: "Polygon", coordinates: [ring] };
      const { area } = editingArea
        ? await api.updateArea(editingArea.id, { name, geometry, version: editingArea.version })
        : await api.createArea({ name, geometry });
      useMapStore.getState().upsertArea(area);
      if (editingArea) sendEditingStop(editingArea.id);
      setPendingName(null);
      setEditingArea(null);
      setLiveAreaKm2(null);
    } catch (err) {
      if (editingArea && err instanceof ApiError && err.status === 409) {
        // Someone else saved this area first. Don't silently overwrite or
        // merge — fetch the current version and let the user decide.
        try {
          const { area: latest } = await api.getArea(editingArea.id);
          setConflictArea(latest);
          setSaveError(
            `"${latest.name}" was changed by someone else while you were editing (now ${Number(latest.sizeKm2.toFixed(3))} km²). Reload the latest version to keep editing, or discard your changes.`
          );
        } catch {
          setSaveError("This area was changed by someone else, and the latest version couldn't be loaded. Please try again.");
        }
      } else if (editingArea && err instanceof ApiError && err.status === 404) {
        setSaveError("This area was deleted by someone else. Your edit can't be saved.");
        useMapStore.getState().removeArea(editingArea.id);
      } else {
        console.error("Failed to save area", err);
        setSaveError(err instanceof Error ? err.message : "Failed to save area");
      }
    } finally {
      setSavingArea(false);
    }
  };

  /** Loads the freshly fetched version from a conflict into the editor,
   *  discarding the local draft, so the user can redraw against current
   *  state and save with the right version. */
  const reloadConflict = () => {
    if (!conflictArea) return;
    auditUiAction("ui.conflict.reload", { areaId: conflictArea.id, version: conflictArea.version });
    useMapStore.getState().upsertArea(conflictArea);
    setEditingArea(conflictArea);
    setConflictArea(null);
    setSaveError(null);
    setPendingName(null);
    setDrawing(true);
    focusArea(conflictArea);
    drawControllerRef.current?.start(conflictArea.geometry.coordinates[0].slice(0, -1));
  };

  const focusArea = (area: Area) => {
    auditUiAction("ui.area.focus", { areaId: area.id });
    const bounds = L.latLngBounds(
      area.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple)
    );
    if (bounds.isValid()) {
      // Leave surrounding map visible instead of fitting tightly to the shape.
      mapRef.current?.fitBounds(bounds.pad(0.5), { padding: [40, 40], maxZoom: 16 });
    }
  };

  const editArea = (area: Area) => {
    auditUiAction("ui.area.edit", { areaId: area.id, version: area.version });
    if (drawing || pendingName || pendingDelete || drawControllerRef.current?.isActive()) return;
    setEditingArea(area);
    setSaveError(null);
    setDrawing(true);
    focusArea(area);
    drawControllerRef.current?.start(area.geometry.coordinates[0].slice(0, -1));
    sendEditingStart(area.id);
  };

  // Refresh handlers each render so they use the latest area version and editor state.
  useEffect(() => {
    const handlers: Array<() => void> = [];
    for (const area of areas.values()) {
      const polygon = areaLayersRef.current.get(area.id);
      if (!polygon) continue;
      const onDoubleClick = (event: L.LeafletMouseEvent) => {
        // Prevent Leaflet's double-click zoom from competing with editing.
        L.DomEvent.stopPropagation(event.originalEvent);
        editArea(area);
      };
      polygon.on("dblclick", onDoubleClick);
      handlers.push(() => polygon.off("dblclick", onDoubleClick));
    }
    return () => handlers.forEach((removeHandler) => removeHandler());
  });

  const deleteArea = async (area: Area) => {
    if (deletingArea) return;
    setDeletingArea(true);
    setDeleteError(null);
    try {
      await api.deleteArea(area.id, area.version);
      useMapStore.getState().removeArea(area.id);
      setPendingDelete(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteError(`"${area.name}" was changed by someone else — refresh before deleting it.`);
      } else if (err instanceof ApiError && err.status === 404) {
        setDeleteError(`"${area.name}" was already deleted.`);
        useMapStore.getState().removeArea(area.id);
      } else {
        console.error("Failed to delete area", err);
        setDeleteError(`Failed to delete "${area.name}". Please try again.`);
      }
    } finally {
      setDeletingArea(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 w-full flex-1">
        <div className="pointer-events-none absolute bottom-[76px] left-3 right-3 top-3 z-[1000] flex flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {/* Single grouped control cluster: layer switch, zoom, draw, areas —
             * keeps every top-level map control in one container with
             * consistent gaps/separators instead of scattered, overlapping
             * pieces (this also replaces Leaflet's own zoom control, which used
             * to sit in the same corner). */}
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-lg">
              <LayerSwitcher layer={layer} onChange={(value) => { setLayer(value); auditUiAction("ui.map.layer", { value }); }} />

              <Separator orientation="vertical" className="mx-1 h-6" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => { mapRef.current?.zoomOut(); auditUiAction("ui.map.zoom", { value: "out" }); }}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => { mapRef.current?.zoomIn(); auditUiAction("ui.map.zoom", { value: "in" }); }}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom in</TooltipContent>
              </Tooltip>

              <Separator orientation="vertical" className="mx-1 h-6" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={areasPanelOpen ? "secondary" : "ghost"}
                    size="sm"
                    onClick={toggleAreasPanel}
                    className="gap-1.5"
                  >
                    <Layers className="h-4 w-4" />
                    Areas
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {areas.size}
                    </Badge>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{areasPanelOpen ? "Hide areas panel" : "Show areas panel"}</TooltipContent>
              </Tooltip>
            </div>

            <div className="pointer-events-auto ml-auto">
              <PresenceBar presence={[...presence.values()]} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:items-start">
            {drawing && (
              <section
                aria-labelledby="drawing-tips-title"
                className="pointer-events-auto w-full shrink-0 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg md:w-64"
              >
                <h2 id="drawing-tips-title" className="mb-2 text-sm font-semibold">{editingArea ? `Editing ${editingArea.name}` : "Drawing tips"}</h2>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-1">
                  <li>Click to add a point</li>
                  <li>Drag dots to adjust</li>
                  <li>Drag inside the shape to move it</li>
                  <li>Click <strong className="text-foreground">+</strong> to insert a point</li>
                </ul>
                {drawingError && <p role="alert" className="mt-2 text-xs text-destructive">{drawingError}</p>}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm">
                  <span className="flex-1 font-semibold">
                    {liveAreaKm2 !== null ? Number(liveAreaKm2.toFixed(3)) : 0} km²
                  </span>
                  <Button
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Finish drawing"
                    title="Finish drawing (Enter)"
                    disabled={drawingPointCount < 3}
                    onClick={() => drawControllerRef.current?.finish()}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={cancelDrawing}
                    aria-label="Cancel drawing"
                    title="Cancel drawing (Escape)"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </section>
            )}
            {areasPanelOpen && (
              <AreaSidebar
                onDelete={(area) => {
                  auditUiAction("ui.delete.dialog", { areaId: area.id, value: "open" });
                  setDeleteError(null);
                  setPendingDelete(area);
                }}
                onFocus={focusArea}
                onEdit={editArea}
                onHistory={(area) => { setHistoryArea(area); auditUiAction("ui.area.history", { areaId: area.id }); }}
                onDraw={startDrawing}
                onClose={toggleAreasPanel}
                editDisabled={drawing || pendingName !== null}
                editingAreas={editingAreas}
                currentUserId={currentUserId}
                deleteError={pendingDelete ? null : deleteError}
                onDismissDeleteError={() => setDeleteError(null)}
              />
            )}
          </div>
        </div>

        {/* Keep className stable: Leaflet adds classes that React must not overwrite. */}
        <div ref={mapContainerRef} className="map-container h-full w-full" data-base-layer={layer} />

        <Dialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open && !deletingArea) {
              if (pendingDelete) auditUiAction("ui.delete.dialog", { areaId: pendingDelete.id, value: "closed" });
              setPendingDelete(null);
              setDeleteError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete area?</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete “{pendingDelete?.name}”? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
            <DialogFooter>
              <Button
                autoFocus
                variant="outline"
                disabled={deletingArea}
                onClick={() => {
                  if (pendingDelete) auditUiAction("ui.delete.dialog", { areaId: pendingDelete.id, value: "closed" });
                  setPendingDelete(null);
                  setDeleteError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deletingArea}
                onClick={() => pendingDelete && deleteArea(pendingDelete)}
              >
                {deletingArea ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {historyArea && <AreaHistoryDialog key={historyArea.id} area={historyArea} onClose={() => setHistoryArea(null)} />}

        <NameAreaDialog
          key={`${editingArea?.id ?? "new"}-${pendingName !== null}`}
          open={pendingName !== null}
          initialName={editingArea?.name ?? ""}
          editing={editingArea !== null}
          saving={savingArea}
          error={saveError}
          conflict={conflictArea !== null}
          areaKm2={liveAreaKm2 ?? 0}
          onConfirm={confirmArea}
          onReloadConflict={reloadConflict}
          onCancel={() => {
            if (savingArea) return;
            auditUiAction("ui.draft.discard", editingArea ? { areaId: editingArea.id } : {});
            if (editingArea) sendEditingStop(editingArea.id);
            setPendingName(null);
            setEditingArea(null);
            setLiveAreaKm2(null);
            setSaveError(null);
            setConflictArea(null);
          }}
        />
      </div>
    </div>
  );
}

function NameAreaDialog({
  initialName,
  editing,
  saving,
  error,
  conflict,
  open,
  areaKm2,
  onConfirm,
  onReloadConflict,
  onCancel,
}: {
  initialName: string;
  editing: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  open: boolean;
  areaKm2: number;
  onConfirm: (name: string) => void;
  onReloadConflict: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit area" : "Name this area"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{Number(areaKm2.toFixed(3))} km²</p>
        <Input autoFocus aria-label="Area name" maxLength={200} disabled={saving || conflict} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North field" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            Discard
          </Button>
          {conflict ? (
            <Button onClick={onReloadConflict}>Reload latest version</Button>
          ) : (
            <Button
              disabled={!name.trim() || saving}
              onClick={() => {
                onConfirm(name.trim());
              }}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
