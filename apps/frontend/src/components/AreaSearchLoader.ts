import type { Area, AreaSearchPage } from "@snapland/shared";

export interface AreaSearchState {
  areas: Area[];
  total: number | null;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

export const emptySearchState: AreaSearchState = {
  areas: [], total: null, nextCursor: null, loading: false, error: null,
};

/** Owns request cancellation, page ordering and duplicate suppression. */
export class AreaSearchLoader {
  private state: AreaSearchState = { ...emptySearchState };
  private request: AbortController | null = null;
  private query = "";
  private generation = 0;
  private disposed = false;

  constructor(
    private fetchPage: (query: string, cursor: string | null, signal: AbortSignal) => Promise<AreaSearchPage>,
    private onChange: (state: AreaSearchState) => void,
  ) {}

  reset(query: string) {
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.query = query;
    this.state = { ...emptySearchState };
    return this.loadMore();
  }

  async loadMore() {
    if (this.disposed || this.request || (this.state.total !== null && !this.state.nextCursor)) return;
    const controller = new AbortController();
    const generation = this.generation;
    this.request = controller;
    this.state = { ...this.state, loading: true, error: null };
    this.onChange(this.state);
    try {
      const page = await this.fetchPage(this.query, this.state.nextCursor, controller.signal);
      if (this.disposed || generation !== this.generation) return;
      const areas = new Map(this.state.areas.map((area) => [area.id, area]));
      for (const area of page.areas) areas.set(area.id, area);
      this.state = {
        areas: [...areas.values()], total: page.total, nextCursor: page.nextCursor,
        loading: false, error: null,
      };
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.state = { ...this.state, loading: false, error: error instanceof Error ? error.message : "Failed to load areas" };
    } finally {
      if (!this.disposed && generation === this.generation) {
        this.request = null;
        this.onChange(this.state);
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.request?.abort();
  }
}
