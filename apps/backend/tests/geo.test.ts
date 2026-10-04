import { describe, expect, it } from "vitest";
import { validatePolygonGeometry, geometryToWkt, InvalidGeometryError } from "../src/common/utils/geo.util";
import type { AreaGeometry } from "@snapland/shared";

const square: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [34.78, 32.08],
      [34.79, 32.08],
      [34.79, 32.09],
      [34.78, 32.09],
      [34.78, 32.08],
    ],
  ],
};

describe("validatePolygonGeometry", () => {
  it("accepts a valid closed square", () => {
    expect(() => validatePolygonGeometry(square)).not.toThrow();
  });

  it("rejects a non-Polygon type", () => {
    expect(() => validatePolygonGeometry({ ...square, type: "LineString" } as unknown as AreaGeometry)).toThrow(
      InvalidGeometryError
    );
  });

  it("rejects an unclosed ring", () => {
    const open: AreaGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
    };
    expect(() => validatePolygonGeometry(open)).toThrow(/closed/);
  });

  it("rejects fewer than 3 distinct vertices", () => {
    const line: AreaGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 1], [0, 0]]],
    };
    expect(() => validatePolygonGeometry(line)).toThrow();
  });

  it("rejects coordinates out of range", () => {
    const bad: AreaGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]],
    };
    expect(() => validatePolygonGeometry(bad)).toThrow(/longitude/);
  });

  it("rejects a self-intersecting bowtie polygon", () => {
    const bowtie: AreaGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
    };
    expect(() => validatePolygonGeometry(bowtie)).toThrow(/self-intersecting/);
  });

  it("rejects duplicate vertices", () => {
    const dup: AreaGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 0], [0, 1], [0, 0]]],
    };
    expect(() => validatePolygonGeometry(dup)).toThrow(/duplicate/);
  });

  it.each([
    [[0, 0], [1, 0], [2, 0], [0, 0]],
    [[0, 0], [3, 0], [1, 0], [1, 2], [0, 0]],
    [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4], [0, 0]],
    [[0, 0], [4, 0], [4, 3], [1, 3], [1, 0], [3, 0], [3, -1], [0, -1], [0, 0]],
  ])("rejects collinear, backtracking, touching and overlapping rings: %j", (...ring) => {
    expect(() => validatePolygonGeometry({ type: "Polygon", coordinates: [ring.map(([x, y]) => [x, y])] })).toThrow(InvalidGeometryError);
  });

  it("accepts concavity, straight boundary subdivisions and either winding", () => {
    const ring: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 2], [1, 1], [0, 2], [0, 0]];
    expect(() => validatePolygonGeometry({ type: "Polygon", coordinates: [ring] })).not.toThrow();
    expect(() => validatePolygonGeometry({ type: "Polygon", coordinates: [[...ring].reverse()] })).not.toThrow();
  });

  it("accepts small valid shapes far from the coordinate origin", () => {
    const ring: [number, number][] = [[34, 32], [34.00000001, 32], [34.00000001, 32.00000001], [34, 32]];
    expect(() => validatePolygonGeometry({ type: "Polygon", coordinates: [ring] })).not.toThrow();
  });

  it("enforces the 500-coordinate limit including the closing point", () => {
    const ring = Array.from({ length: 500 }, (_, i) => [Math.cos(i / 500 * 2 * Math.PI), Math.sin(i / 500 * 2 * Math.PI)] as [number, number]);
    ring.push(ring[0]);
    expect(() => validatePolygonGeometry({ type: "Polygon", coordinates: [ring] })).toThrow(/at most 500/);
  });
});

describe("geometryToWkt", () => {
  it("produces an SRID-tagged WKT polygon", () => {
    expect(geometryToWkt(square)).toBe(
      "SRID=4326;POLYGON((34.78 32.08, 34.79 32.08, 34.79 32.09, 34.78 32.09, 34.78 32.08))"
    );
  });
});
