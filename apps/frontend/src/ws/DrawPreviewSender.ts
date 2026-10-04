import type { ClientMessage, LngLat } from "@snapland/shared";

type DrawMessage = Extract<ClientMessage, { type: "draw:progress" | "draw:cancel" }>;
export const PREVIEW_INTERVAL_MS = 100;

/** Coalesces previews while preserving immediate drag-end and cancellation updates.
 * A false transport result retains only the latest state for reconnect. */
export class DrawPreviewSender {
  private pending: DrawMessage | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = -Infinity;

  constructor(private readonly send: (message: DrawMessage) => boolean) {}

  update(points: LngLat[], immediate = false): void {
    this.pending = { type: "draw:progress", payload: { points: points.map(([lng, lat]) => [lng, lat]) } };
    const delay = PREVIEW_INTERVAL_MS - (Date.now() - this.lastSentAt);
    if (immediate || delay <= 0) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), delay);
    }
  }

  cancel(): void {
    this.clearTimer();
    this.pending = { type: "draw:cancel", payload: {} };
    this.lastSentAt = -Infinity;
    this.flush();
  }

  flush(): void {
    this.clearTimer();
    if (!this.pending || !this.send(this.pending)) return;
    if (this.pending.type === "draw:progress") this.lastSentAt = Date.now();
    this.pending = null;
  }

  reset(): void {
    this.clearTimer();
    this.pending = null;
    this.lastSentAt = -Infinity;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
