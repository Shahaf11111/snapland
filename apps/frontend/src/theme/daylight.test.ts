import { describe, expect, it } from "vitest";
import { isDaytime } from "./daylight.js";

function atHour(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe("isDaytime", () => {
  it("treats 06:00–18:59 as daytime", () => {
    expect(isDaytime(atHour(6))).toBe(true);
    expect(isDaytime(atHour(12))).toBe(true);
    expect(isDaytime(atHour(18))).toBe(true);
  });

  it("treats 19:00–05:59 as nighttime", () => {
    expect(isDaytime(atHour(19))).toBe(false);
    expect(isDaytime(atHour(23))).toBe(false);
    expect(isDaytime(atHour(0))).toBe(false);
    expect(isDaytime(atHour(5))).toBe(false);
  });
});
