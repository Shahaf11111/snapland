import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area } from "@snapland/shared";
import { BoundsAreaLoader } from "./BoundsAreaLoader.js";
import { useMapStore } from "../state/mapStore.js";

const area = (id: string, version = 1): Area => ({
  id, version, name: id, sizeKm2: 1, createdBy: "user",
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
  createdAt: "", updatedAt: "", deletedAt: null,
});
function deferred() {
  let resolve!: (value: { areas: Area[] }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ areas: Area[] }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const loaders: BoundsAreaLoader[] = [];
function setup() {
  let bbox = { minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 };
  const requests: ReturnType<typeof deferred>[] = [];
  const fetch = vi.fn(() => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  });
  const error = vi.fn();
  const loader = new BoundsAreaLoader(() => bbox, fetch, error);
  loaders.push(loader);
  return { loader, fetch, requests, error, move: () => { bbox = { ...bbox, maxLng: 2 }; } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("bounds loading and reconnect recovery", () => {
  beforeEach(() => {
    useMapStore.setState({ areas: new Map(), lastAreaChange: null, connectionStatus: "connecting", remoteDraws: new Map() });
  });
  afterEach(() => loaders.splice(0).forEach(loader => loader.dispose()));

  it("loads current bounds on each ready transition, not on heartbeat lists or repeated open status", async () => {
    const s = setup();
    const store = useMapStore.getState();
    store.setConnectionStatus("open");
    store.setPresenceList([]);
    store.setConnectionStatus("open");
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.requests[0].resolve({ areas: [area("old")] });
    await settle();
    store.setConnectionStatus("offline");
    s.move();
    store.setConnectionStatus("reconnecting");
    expect(s.fetch).toHaveBeenCalledTimes(1);
    store.setConnectionStatus("open");
    expect(s.fetch).toHaveBeenLastCalledWith({ minLng: 0, minLat: 0, maxLng: 2, maxLat: 1 });
    s.requests[1].resolve({ areas: [area("new")] });
    await settle();
    expect([...useMapStore.getState().areas.keys()]).toEqual(["new"]);
  });

  it("ignores an older viewport response arriving after a newer one", async () => {
    const s = setup();
    const first = s.loader.refresh();
    s.move();
    const second = s.loader.refresh();
    s.requests[1].resolve({ areas: [area("current")] });
    await second;
    s.requests[0].resolve({ areas: [area("stale")] });
    await first;
    expect([...useMapStore.getState().areas.keys()]).toEqual(["current"]);
  });

  it("preserves live updates, creates and deletions received during a bounds request", async () => {
    const s = setup();
    const request = s.loader.refresh();
    const store = useMapStore.getState();
    store.upsertArea(area("updated", 2));
    store.upsertArea(area("created"));
    // Not previously loaded locally, but present in the stale response.
    store.removeArea("deleted");
    s.requests[0].resolve({ areas: [area("updated"), area("deleted")] });
    await request;
    expect([...useMapStore.getState().areas.values()]).toEqual([area("updated", 2), area("created")]);
  });

  it("preserves displayed areas and drafts on failure and allows a subsequent refresh", async () => {
    const s = setup();
    const store = useMapStore.getState();
    store.setAreas([area("existing")]);
    store.setRemoteDraw("user", [[0, 0], [1, 1]]);
    const drafts = useMapStore.getState().remoteDraws;
    const request = s.loader.refresh();
    s.requests[0].reject(new Error("offline"));
    await request;
    expect(s.error).toHaveBeenCalledTimes(1);
    expect(useMapStore.getState().areas.has("existing")).toBe(true);
    const retry = s.loader.refresh();
    s.requests[1].resolve({ areas: [area("recovered")] });
    await retry;
    expect(useMapStore.getState().areas.has("recovered")).toBe(true);
    expect(useMapStore.getState().remoteDraws).toBe(drafts);
  });

  it("ignores superseded errors and unsubscribes on disposal without applying pending results", async () => {
    const s = setup();
    const first = s.loader.refresh();
    const second = s.loader.refresh();
    s.requests[0].reject(new Error("obsolete"));
    await first;
    expect(s.error).not.toHaveBeenCalled();
    s.loader.dispose();
    s.requests[1].resolve({ areas: [area("unmounted")] });
    await second;
    useMapStore.getState().setConnectionStatus("open");
    await s.loader.refresh();
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(useMapStore.getState().areas.size).toBe(0);
  });
});
