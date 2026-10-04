import { describe, expect, it } from "vitest";
import { getVisibleRange } from "./virtualRange";

describe("area list virtualization", () => {
  it("renders only the viewport and buffer for a large list", () => {
    expect(getVisibleRange(10000, 30000, 600, 60)).toEqual({ start: 495, end: 515 });
  });

  it("covers partially visible rows", () => {
    expect(getVisibleRange(100, 31, 600, 60)).toEqual({ start: 0, end: 16 });
  });

  it("clamps stale scroll positions when results shrink", () => {
    expect(getVisibleRange(3, 30000, 600, 60)).toEqual({ start: 0, end: 3 });
    expect(getVisibleRange(0, 30000, 600, 60)).toEqual({ start: 0, end: 0 });
  });

  it("stays within the last row at the bottom", () => {
    expect(getVisibleRange(100, 5400, 600, 60)).toEqual({ start: 85, end: 100 });
  });
});
