import { describe, expect, it } from "vitest";
import { estimateAreaKm2 } from "./geoArea.js";
import type { LngLat } from "@snapland/shared";

describe("estimateAreaKm2", () => {
  it("returns 0 for fewer than 3 points", () => {
    expect(estimateAreaKm2([])).toBe(0);
    expect(estimateAreaKm2([[0, 0]])).toBe(0);
    expect(estimateAreaKm2([[0, 0], [1, 1]])).toBe(0);
  });

  it("estimates a plausible geodesic area for a roughly 1km square near Tel Aviv", () => {
    const square: LngLat[] = [
      [34.78, 32.08],
      [34.79, 32.08],
      [34.79, 32.09],
      [34.78, 32.09],
    ];
    const area = estimateAreaKm2(square);
    expect(area).toBeGreaterThan(0.9);
    expect(area).toBeLessThan(1.2);
  });
});
