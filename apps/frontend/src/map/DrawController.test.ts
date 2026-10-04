import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { DrawController } from "./DrawController.js";
import { estimateAreaKm2 } from "./geoArea.js";

vi.mock("leaflet", () => {
  const layer = (position: unknown) => {
    const handlers = new Map<string, (event: unknown) => void>();
    return {
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn(function (events: string, handler: (event: unknown) => void) {
        for (const event of events.split(" ")) handlers.set(event, handler);
      }),
      fire: (event: string, data = {}) => handlers.get(event)?.({ type: event, originalEvent: { detail: 1 }, ...data }),
      getLatLng: () => position,
      setLatLng: (next: unknown) => { position = next; },
      setLatLngs: vi.fn(),
    };
  };
  return { default: {
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    point: (x: number, y: number) => ({ x, y }),
    DomEvent: { stop: vi.fn() },
    marker: vi.fn(layer),
    divIcon: vi.fn((options) => options),
    polygon: vi.fn(layer),
    polyline: vi.fn(layer),
  } };
});

describe("drawing vertex adjustments", () => {
  let controller: DrawController;
  const handlers = new Map<string, (event: unknown) => void>();
  const windowHandlers = new Map<string, (event: unknown) => void>();
  const callbacks = { onProgress: vi.fn(), onComplete: vi.fn(), onCancel: vi.fn(), onValidationError: vi.fn() };
  const projected = (x: number, y: number) => ({
    x, y,
    add: (other: { x: number; y: number }) => projected(x + other.x, y + other.y),
    divideBy: (divisor: number) => projected(x / divisor, y / divisor),
  });
  const map = {
    getContainer: () => ({ style: { cursor: "" } }),
    on: (event: string, handler: (event: unknown) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    removeLayer: vi.fn(),
    doubleClickZoom: { enabled: vi.fn(() => true), enable: vi.fn(), disable: vi.fn() },
    dragging: { enabled: vi.fn(() => true), enable: vi.fn(), disable: vi.fn() },
    mouseEventToContainerPoint: (event: MouseEvent) => projected(event.clientX, event.clientY),
    project: ({ lat, lng }: L.LatLng) => projected(lng, lat),
    unproject: ({ x, y }: L.Point) => ({ lat: y, lng: x }),
  };
  const addPoint = (lat: number, lng: number) => {
    handlers.get("click")?.({ latlng: { lat, lng }, originalEvent: { detail: 1 } });
  };
  const createdMarkers = (vertices: boolean) => vi.mocked(L.marker).mock.results
    .filter((_, index) => Boolean(vi.mocked(L.marker).mock.calls[index][1]?.draggable) === vertices)
    .map((result) => result.value as L.Marker);
  const marker = (index: number) => createdMarkers(true)[index];
  const midpoint = (index: number) => createdMarkers(false)[index];

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    windowHandlers.clear();
    vi.stubGlobal("window", {
      addEventListener: vi.fn((event, handler) => windowHandlers.set(event, handler)),
      removeEventListener: vi.fn((event) => windowHandlers.delete(event)),
    });
    controller = new DrawController(map as unknown as L.Map, callbacks);
    controller.start();
    addPoint(32.08, 34.78);
    addPoint(32.08, 34.79);
    addPoint(32.09, 34.79);
  });

  afterEach(() => {
    if (controller.isActive()) controller.cancel();
    vi.unstubAllGlobals();
  });

  it("moves all vertices together, updates handles, and saves the translated shape", () => {
    const polygon = vi.mocked(L.polygon).mock.results[0].value as L.Polygon;
    polygon.fire("mousedown", { originalEvent: { button: 0, clientX: 0, clientY: 0 } });
    expect(map.dragging.disable).toHaveBeenCalled();
    windowHandlers.get("mousemove")?.({ clientX: 1, clientY: 2 });
    const moved = callbacks.onProgress.mock.lastCall![0];
    expect(moved).toEqual([[35.78, 34.08], [35.79, 34.08], [35.79, 34.09]]);
    expect(marker(0).getLatLng()).toEqual({ lng: 35.78, lat: 34.08 });
    expect(midpoint(0).getLatLng().lng).toBeCloseTo(35.785);
    windowHandlers.get("mouseup")?.({});
    expect(map.dragging.enable).toHaveBeenCalled();
    expect(windowHandlers.has("mousemove")).toBe(false);
    expect(callbacks.onProgress.mock.lastCall?.[2]).toBe(true);
    controller.finish();
    expect(callbacks.onComplete.mock.lastCall?.[0]).toEqual(moved);
  });

  it("cleans up a whole-shape drag on cancellation without saving", () => {
    const polygon = vi.mocked(L.polygon).mock.results[0].value as L.Polygon;
    polygon.fire("mousedown", { originalEvent: { button: 0, clientX: 0, clientY: 0 } });
    windowHandlers.get("mousemove")?.({ clientX: 1, clientY: 2 });
    controller.cancel();
    expect(windowHandlers.size).toBe(0);
    expect(map.dragging.enable).toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it("loads an existing area with editable vertices and saves the adjusted shape", () => {
    controller.cancel();
    vi.clearAllMocks();
    const points: [number, number][] = [[34.78, 32.08], [34.79, 32.08], [34.79, 32.09]];
    controller.start(points);
    expect(createdMarkers(true)).toHaveLength(3);
    expect(createdMarkers(false)).toHaveLength(3);
    marker(1).setLatLng({ lat: 32.08, lng: 34.80 });
    marker(1).fire("dragend");
    controller.finish();
    const expected: [number, number][] = [[34.78, 32.08], [34.80, 32.08], [34.79, 32.09]];
    expect(callbacks.onComplete).toHaveBeenCalledWith(expected, estimateAreaKm2(expected));
    expect(points[1]).toEqual([34.79, 32.08]);
  });

  it("updates the preview, area estimate, and shared coordinates while dragging", () => {
    marker(1).setLatLng({ lat: 32.08, lng: 34.80 });
    marker(1).fire("drag");

    const expected: [number, number][] = [[34.78, 32.08], [34.80, 32.08], [34.79, 32.09]];
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(expected, estimateAreaKm2(expected), false);
    const polygon = vi.mocked(L.polygon).mock.results[0].value as L.Polygon;
    expect(polygon.setLatLngs).toHaveBeenLastCalledWith(expected.map(([lng, lat]) => ({ lat, lng })));
    expect(createdMarkers(true)).toHaveLength(3);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it("requests an immediate final preview at drag end", () => {
    marker(1).setLatLng({ lat: 32.08, lng: 34.80 });
    marker(1).fire("dragend");
    const expected: [number, number][] = [[34.78, 32.08], [34.80, 32.08], [34.79, 32.09]];
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(expected, estimateAreaKm2(expected), true);
  });

  it("allows dragging the first vertex, then confirms with the adjusted coordinates", () => {
    marker(0).setLatLng({ lat: 32.07, lng: 34.77 });
    marker(0).fire("drag");
    marker(0).fire("dragend");
    expect(callbacks.onComplete).not.toHaveBeenCalled();

    marker(1).fire("click");
    expect(controller.isActive()).toBe(true);
    marker(0).fire("click");
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    controller.finish();

    const expected: [number, number][] = [[34.77, 32.07], [34.79, 32.08], [34.79, 32.09]];
    expect(callbacks.onComplete).toHaveBeenCalledWith(expected, estimateAreaKm2(expected));
    expect(controller.isActive()).toBe(false);
    expect(handlers.has("click")).toBe(false);
  });

  it("ignores pending drag events after cancellation and removes the handles", () => {
    controller.cancel();
    callbacks.onProgress.mockClear();
    marker(1).fire("dragend");
    expect(callbacks.onProgress).not.toHaveBeenCalled();
    for (let index = 0; index < 3; index++) expect(map.removeLayer).toHaveBeenCalledWith(marker(index));
    for (const handle of createdMarkers(false)) expect(map.removeLayer).toHaveBeenCalledWith(handle);
  });

  it("inserts a draggable point in edge order and keeps shifted vertices editable", () => {
    const position = midpoint(0).getLatLng();
    midpoint(0).fire("click");
    expect(createdMarkers(true)).toHaveLength(4);
    expect(createdMarkers(false)).toHaveLength(4);
    expect(callbacks.onProgress.mock.lastCall?.[0]).toEqual([
      [34.78, 32.08], [position.lng, position.lat], [34.79, 32.08], [34.79, 32.09],
    ]);
    // The old second vertex now has index 2; the inserted vertex has index 1.
    marker(1).setLatLng({ lat: 32.08, lng: 34.81 });
    marker(1).fire("drag");
    marker(3).setLatLng({ lat: 32.07, lng: 34.785 });
    marker(3).fire("drag");
    expect(callbacks.onProgress.mock.lastCall?.[0]).toEqual([
      [34.78, 32.08], [34.785, 32.07], [34.81, 32.08], [34.79, 32.09],
    ]);
    expect(midpoint(0).getLatLng().lat).toBeCloseTo((32.08 + 32.07) / 2);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it("supports insertion on the closing edge without finishing the drawing", () => {
    const position = midpoint(2).getLatLng();
    midpoint(2).fire("click");
    expect(callbacks.onProgress.mock.lastCall?.[0]).toEqual([
      [34.78, 32.08], [34.79, 32.08], [34.79, 32.09], [position.lng, position.lat],
    ]);
    expect(controller.isActive()).toBe(true);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    marker(0).fire("click");
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    controller.finish();
    expect(callbacks.onComplete.mock.lastCall?.[0]).toHaveLength(4);
  });

  it("offers one insertion handle when drawing only a line", () => {
    controller.cancel();
    vi.clearAllMocks();
    controller.start();
    addPoint(32.08, 34.78);
    expect(createdMarkers(false)).toHaveLength(0);
    addPoint(32.08, 34.79);
    expect(createdMarkers(false)).toHaveLength(1);
    midpoint(0).fire("click");
    expect(createdMarkers(true)).toHaveLength(3);
    expect(createdMarkers(false)).toHaveLength(3);
    expect(controller.isActive()).toBe(true);
  });

  it("adds points immediately and does not finish on double-click", () => {
    const points = callbacks.onProgress.mock.lastCall?.[0];
    handlers.get("click")?.({ latlng: { lat: 33, lng: 35 }, originalEvent: { detail: 1 } });
    expect(callbacks.onProgress.mock.lastCall?.[0]).toEqual([...points, [35, 33]]);
    expect(createdMarkers(true)).toHaveLength(4);
    handlers.get("click")?.({ latlng: { lat: 33, lng: 35 }, originalEvent: { detail: 2 } });
    handlers.get("dblclick")?.({});
    expect(createdMarkers(true)).toHaveLength(4);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(true);
    controller.finish();
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    expect(map.doubleClickZoom.disable).toHaveBeenCalled();
    expect(map.doubleClickZoom.enable).toHaveBeenCalled();
  });

  it("inserts a midpoint immediately and does not finish on handle double-click", () => {
    midpoint(0).fire("click");
    expect(callbacks.onProgress.mock.lastCall?.[0]).toHaveLength(4);
    midpoint(0).fire("dblclick");
    marker(3).fire("dblclick");
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(createdMarkers(true)).toHaveLength(4);
    expect(controller.isActive()).toBe(true);
  });

  it("keeps an invalid draft editable until its vertices are repaired", () => {
    controller.cancel();
    vi.clearAllMocks();
    controller.start([[0, 0], [1, 0], [2, 0]]);
    controller.finish();
    expect(callbacks.onValidationError).toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(true);
    marker(1).setLatLng({ lat: 1, lng: 1 });
    marker(1).fire("dragend");
    controller.finish();
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not insert more vertices than the server permits", () => {
    controller.cancel();
    vi.clearAllMocks();
    controller.start(Array.from({ length: 499 }, (_, i) => [Math.cos(i / 499 * 2 * Math.PI), Math.sin(i / 499 * 2 * Math.PI)]));
    addPoint(10, 10);
    expect(createdMarkers(true)).toHaveLength(499);
    expect(callbacks.onValidationError).toHaveBeenCalledWith(expect.stringContaining("499"));
  });

  it("requires at least three points to finish", () => {
    controller.cancel();
    controller.start();
    addPoint(32.08, 34.78);
    addPoint(32.08, 34.79);
    controller.finish();
    handlers.get("dblclick")?.({});
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(true);
  });

  it("removes listeners and ignores later handle edits when the map is destroyed", () => {
    handlers.get("click")?.({ latlng: { lat: 33, lng: 35 }, originalEvent: { detail: 1 } });
    callbacks.onProgress.mockClear();
    controller.destroy();
    midpoint(0).fire("click");
    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(controller.isActive()).toBe(false);
  });
});
