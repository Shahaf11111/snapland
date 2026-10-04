import type { Area, BoundingBox } from "@snapland/shared";
import { useMapStore } from "../state/mapStore.js";

/** Coordinates initial, viewport and reconnect reads without touching draft state. */
export class BoundsAreaLoader {
  private generation = 0;
  private disposed = false;
  private pendingChanges: Map<string, Area | null> | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly bounds: () => BoundingBox,
    private readonly fetchAreas: (bounds: BoundingBox) => Promise<{ areas: Area[] }>,
    private readonly onError: (error: unknown) => void,
  ) {
    this.unsubscribe = useMapStore.subscribe((state, previous) => {
      if (state.lastAreaChange !== previous.lastAreaChange && state.lastAreaChange) {
        this.pendingChanges?.set(state.lastAreaChange.id, state.lastAreaChange.area);
      }
      // presence:list arrives periodically too; only a transition to open reloads.
      if (state.connectionStatus === "open" && previous.connectionStatus !== "open") {
        void this.refresh();
      }
    });
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const changes = new Map<string, Area | null>();
    this.pendingChanges = changes;
    try {
      const { areas } = await this.fetchAreas(this.bounds());
      if (this.disposed || generation !== this.generation) return;
      const merged = new Map(areas.map(area => [area.id, area]));
      // Preserve live creates/updates/deletes (including local saves) that arrived
      // after this request began. A response must not resurrect a deleted area.
      for (const [id, area] of changes) {
        if (area) merged.set(id, area);
        else merged.delete(id);
      }
      this.pendingChanges = null;
      useMapStore.getState().setAreas([...merged.values()]);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.onError(error);
    } finally {
      if (generation === this.generation) this.pendingChanges = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pendingChanges = null;
    this.unsubscribe();
  }
}
