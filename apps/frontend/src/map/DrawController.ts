import L from "leaflet";
import type { LngLat } from "@snapland/shared";
import { MAX_RING_POINTS, validatePolygonGeometry } from "@snapland/shared";
import { estimateAreaKm2 } from "./geoArea.js";

export interface DrawControllerCallbacks {
  onProgress: (points: LngLat[], areaKm2: number, immediate: boolean) => void;
  onComplete: (points: LngLat[], areaKm2: number) => void;
  onCancel: () => void;
  onValidationError?: (message: string) => void;
}

/**
 * Hand-built polygon drawing interaction (no Leaflet.Draw or other
 * third-party drawing plugin, per the assignment constraint on
 * collaborative-feature plugins): click to add vertices, confirm / Enter to
 * finish, drag vertices to adjust them, Escape to cancel.
 */
export class DrawController {
  private map: L.Map;
  private callbacks: DrawControllerCallbacks;
  private points: L.LatLng[] = [];
  private markers: L.Marker[] = [];
  private midpointMarkers: L.Marker[] = [];
  private previewLine: L.Polyline | null = null;
  private previewPolygon: L.Polygon | null = null;
  private active = false;
  private restoreDoubleClickZoom = false;
  private movingShape: { origin: L.Point; points: L.Point[]; restoreDragging: boolean } | null = null;

  private startShapeDrag = (event: L.LeafletMouseEvent) => {
    if (!this.active || event.originalEvent.button !== 0) return;
    L.DomEvent.stop(event.originalEvent);
    this.movingShape = {
      origin: this.map.mouseEventToContainerPoint(event.originalEvent),
      points: this.points.map((point) => this.map.project(point)),
      restoreDragging: this.map.dragging.enabled(),
    };
    this.map.dragging.disable();
    this.map.getContainer().style.cursor = "grabbing";
    window.addEventListener("mousemove", this.moveShape);
    window.addEventListener("mouseup", this.endShapeDrag);
    window.addEventListener("blur", this.endShapeDrag);
  };

  private moveShape = (event: MouseEvent) => {
    const drag = this.movingShape;
    if (!drag || !this.active) return;
    const position = this.map.mouseEventToContainerPoint(event);
    const offset = L.point(position.x - drag.origin.x, position.y - drag.origin.y);
    this.points = drag.points.map((point) => this.map.unproject(point.add(offset)));
    this.markers.forEach((marker, index) => marker.setLatLng(this.points[index]));
    this.redrawPreview();
    this.emitProgress();
  };

  private endShapeDrag = () => {
    if (!this.movingShape) return;
    if (this.movingShape.restoreDragging) this.map.dragging.enable();
    this.movingShape = null;
    window.removeEventListener("mousemove", this.moveShape);
    window.removeEventListener("mouseup", this.endShapeDrag);
    window.removeEventListener("blur", this.endShapeDrag);
    this.map.getContainer().style.cursor = this.active ? "crosshair" : "";
    if (this.active) this.emitProgress(true);
  };

  private handleClick = (event: L.LeafletMouseEvent) => {
    if (!this.active || event.originalEvent?.detail > 1) return;
    this.insertVertex(this.points.length, event.latlng);
  };

  private insertVertex(index: number, position: L.LatLng): void {
    if (this.points.length >= MAX_RING_POINTS - 1) {
      this.callbacks.onValidationError?.(`An area can have at most ${MAX_RING_POINTS - 1} vertices.`);
      return;
    }
    this.points.splice(index, 0, position);
    const marker = L.marker(position, {
      draggable: true,
      bubblingMouseEvents: false,
      icon: L.divIcon({
        className: "draw-vertex",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      title: "Drag to adjust point",
      alt: index === 0 ? "First drawing point" : "Drawing point",
      zIndexOffset: 100,
    }).addTo(this.map);
    marker.on("drag dragend", (event: L.LeafletEvent) => {
      if (!this.active) return;
      // Inserting vertices shifts indexes, so resolve this marker's current position.
      const currentIndex = this.markers.indexOf(marker);
      if (currentIndex === -1) return;
      this.points[currentIndex] = marker.getLatLng();
      this.redrawPreview();
      this.emitProgress(event.type === "dragend");
    });
    this.markers.splice(index, 0, marker);
    this.redrawPreview();
    this.emitProgress();
  }

  private updateMidpoints(): void {
    const edgeCount = this.points.length < 3 ? Math.max(0, this.points.length - 1) : this.points.length;
    while (this.midpointMarkers.length > edgeCount) {
      this.map.removeLayer(this.midpointMarkers.pop()!);
    }
    for (let index = 0; index < edgeCount; index++) {
      const start = this.map.project(this.points[index]);
      const end = this.map.project(this.points[(index + 1) % this.points.length]);
      // Average projected positions so the handle sits on the visible edge.
      const position = this.map.unproject(start.add(end).divideBy(2));
      const existing = this.midpointMarkers[index];
      if (existing) {
        existing.setLatLng(position);
        continue;
      }
      const marker = L.marker(position, {
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: "draw-midpoint",
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        title: "Click to add a point",
        alt: "Add a point between vertices",
      }).addTo(this.map);
      marker.on("click", (event: L.LeafletMouseEvent) => {
        if (!this.active || event.originalEvent?.detail > 1) return;
        this.insertVertex(index + 1, marker.getLatLng());
      });
      this.midpointMarkers.push(marker);
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.active) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, [contenteditable=true], [role=dialog]")) return;
    if (e.key === "Escape") this.cancel();
    if (e.key === "Enter" && this.points.length >= 3) this.finish();
  };

  constructor(map: L.Map, callbacks: DrawControllerCallbacks) {
    this.map = map;
    this.callbacks = callbacks;
  }

  start(initialPoints: LngLat[] = []): void {
    if (this.active) this.stop();
    this.reset();
    this.active = true;
    this.restoreDoubleClickZoom = this.map.doubleClickZoom.enabled();
    this.map.doubleClickZoom.disable();
    this.map.getContainer().style.cursor = "crosshair";
    this.map.on("click", this.handleClick);
    window.addEventListener("keydown", this.handleKeyDown);
    for (const [lng, lat] of initialPoints) {
      this.insertVertex(this.points.length, L.latLng(lat, lng));
    }
  }

  cancel(): void {
    this.callbacks.onCancel();
    this.stop();
  }

  finish(): void {
    if (!this.active) return;
    if (this.points.length < 3) return;
    const lngLats = this.toLngLat();
    try {
      validatePolygonGeometry({ type: "Polygon", coordinates: [[...lngLats, lngLats[0]]] });
    } catch (error) {
      this.callbacks.onValidationError?.(error instanceof Error ? error.message : "Invalid polygon");
      return;
    }
    const areaKm2 = estimateAreaKm2(lngLats);
    this.callbacks.onComplete(lngLats, areaKm2);
    this.stop();
  }

  private stop(): void {
    this.active = false;
    this.endShapeDrag();
    if (this.restoreDoubleClickZoom) this.map.doubleClickZoom.enable();
    this.map.getContainer().style.cursor = "";
    this.map.off("click", this.handleClick);
    window.removeEventListener("keydown", this.handleKeyDown);
    this.reset();
  }

  destroy(): void {
    this.stop();
  }

  private reset(): void {
    this.points = [];
    for (const m of this.markers) this.map.removeLayer(m);
    this.markers = [];
    for (const marker of this.midpointMarkers) this.map.removeLayer(marker);
    this.midpointMarkers = [];
    if (this.previewLine) this.map.removeLayer(this.previewLine);
    if (this.previewPolygon) this.map.removeLayer(this.previewPolygon);
    this.previewLine = null;
    this.previewPolygon = null;
  }

  private redrawPreview(): void {
    this.updateMidpoints();
    if (this.points.length >= 3) {
      if (this.previewLine) {
        this.map.removeLayer(this.previewLine);
        this.previewLine = null;
      }
      if (this.previewPolygon) {
        this.previewPolygon.setLatLngs(this.points);
      } else {
        this.previewPolygon = L.polygon(this.points, {
          color: "#2563eb", weight: 2, fillOpacity: 0.15,
          bubblingMouseEvents: false, className: "draw-shape",
        }).addTo(this.map);
        this.previewPolygon.on("mousedown", this.startShapeDrag);
      }
    } else if (this.points.length >= 2) {
      if (this.previewLine) {
        this.previewLine.setLatLngs(this.points);
      } else {
        this.previewLine = L.polyline(this.points, { color: "#2563eb", weight: 2, interactive: false }).addTo(this.map);
      }
    }
  }

  private toLngLat(): LngLat[] {
    return this.points.map((p) => [p.lng, p.lat] as LngLat);
  }

  private emitProgress(immediate = false): void {
    const lngLats = this.toLngLat();
    this.callbacks.onProgress(lngLats, estimateAreaKm2(lngLats), immediate);
  }

  isActive(): boolean {
    return this.active;
  }
}
