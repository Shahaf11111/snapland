import { describe, expect, it } from "vitest";
import { clientMessageSchema, MAX_DRAW_POINTS } from "../src/websocket/client-message.schema";

const progress = (points: unknown) => ({ type: "draw:progress", payload: { points } });

describe("WebSocket client message validation", () => {
  it.each([
    { points: [] },
    { points: [[34.78, 32.08]] },
    { points: [[-180, -90], [180, 90]] },
  ])("accepts unfinished drafts: $points", ({ points }) => {
    expect(clientMessageSchema.safeParse(progress(points)).success).toBe(true);
  });

  it("accepts 499 vertices but rejects a draft too large to save with closure", () => {
    expect(clientMessageSchema.safeParse(progress(Array.from({ length: MAX_DRAW_POINTS }, () => [0, 0]))).success).toBe(true);
    expect(clientMessageSchema.safeParse(progress(Array.from({ length: MAX_DRAW_POINTS + 1 }, () => [0, 0]))).success).toBe(false);
  });

  it.each([
    { label: "null", message: null },
    { label: "array envelope", message: [] },
    { label: "missing type", message: { payload: {} } },
    { label: "unknown type", message: { type: "unexpected", payload: {} } },
    { label: "missing payload", message: { type: "draw:progress" } },
    { label: "missing points", message: { type: "draw:progress", payload: {} } },
    { label: "non-array points", message: progress("points") },
    { label: "invalid point", message: progress([null]) },
    { label: "short point", message: progress([[0]]) },
    { label: "long point", message: progress([[0, 0, 0]]) },
    { label: "numeric string", message: progress([["0", 0]]) },
    { label: "longitude out of range", message: progress([[181, 0]]) },
    { label: "latitude out of range", message: progress([[0, -91]]) },
    { label: "infinity", message: progress([[Infinity, 0]]) },
    { label: "NaN", message: progress([[0, NaN]]) },
    { label: "extra envelope field", message: { ...progress([]), userId: "spoof" } },
    { label: "extra payload field", message: { type: "draw:progress", payload: { points: [], userId: "spoof" } } },
    { label: "nonempty cancellation", message: { type: "draw:cancel", payload: { userId: "spoof" } } },
    { label: "inverted longitude bounds", message: { type: "viewport:update", payload: { bbox: [20, 0, 10, 5] } } },
    { label: "inverted latitude bounds", message: { type: "viewport:update", payload: { bbox: [0, 20, 5, 10] } } },
    { label: "short bounds", message: { type: "viewport:update", payload: { bbox: [0, 0, 1] } } },
    { label: "out of range bounds", message: { type: "viewport:update", payload: { bbox: [-181, 0, 1, 1] } } },
  ])("rejects $label", ({ message }) => {
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it("accepts cancellation and ordered bounds", () => {
    expect(clientMessageSchema.safeParse({ type: "draw:cancel", payload: {} }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "viewport:update", payload: { bbox: [-180, -90, 180, 90] } }).success).toBe(true);
  });
});
