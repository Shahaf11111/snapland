import type { AreaGeometry, LngLat } from "./geo";

export class InvalidGeometryError extends Error {}

export const MAX_RING_POINTS = 500;

function orientation(a: LngLat, b: LngLat, c: LngLat): number {
  const left = (b[0] - a[0]) * (c[1] - a[1]);
  const right = (b[1] - a[1]) * (c[0] - a[0]);
  const value = left - right;
  const tolerance = 32 * Number.EPSILON * (Math.abs(left) + Math.abs(right));
  return Math.abs(value) <= tolerance ? 0 : Math.sign(value);
}

function onSegment(a: LngLat, b: LngLat, p: LngLat): boolean {
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  return (o1 * o2 < 0 && o3 * o4 < 0) ||
    (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b));
}

/**
 * Validates a GeoJSON Polygon geometry: coordinate ranges, ring closure,
 * point count bounds, and a cheap O(n^2) self-intersection check
 * (acceptable since drawn polygons are small, user-authored shapes).
 */
export function validatePolygonGeometry(geometry: AreaGeometry): void {
  if (geometry?.type !== "Polygon") {
    throw new InvalidGeometryError("geometry.type must be 'Polygon'");
  }
  const rings = geometry.coordinates;
  if (!Array.isArray(rings) || rings.length !== 1) {
    throw new InvalidGeometryError("only single-ring polygons (no holes) are supported");
  }
  const ring = rings[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new InvalidGeometryError("a polygon ring needs at least 4 points (3 vertices + closing point)");
  }
  if (ring.length > MAX_RING_POINTS) {
    throw new InvalidGeometryError(`a polygon ring may have at most ${MAX_RING_POINTS} points`);
  }

  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2 || point.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new InvalidGeometryError("each coordinate must be a [lng, lat] pair of finite numbers");
    }
    const [lng, lat] = point;
    if (lng < -180 || lng > 180) throw new InvalidGeometryError(`longitude out of range: ${lng}`);
    if (lat < -90 || lat > 90) throw new InvalidGeometryError(`latitude out of range: ${lat}`);
  }

  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    throw new InvalidGeometryError("polygon ring must be closed (first point === last point)");
  }

  const vertices = ring.slice(0, -1);
  const distinct = new Set(vertices.map(([lng, lat]) => `${lng},${lat}`));
  if (distinct.size !== vertices.length) {
    throw new InvalidGeometryError("polygon ring contains duplicate vertices");
  }
  if (vertices.length < 3) {
    throw new InvalidGeometryError("a polygon needs at least 3 distinct vertices");
  }

  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    const a3 = vertices[(i + 2) % n];
    // Adjacent edges may share their endpoint, but must not double back.
    if (orientation(a1, a2, a3) === 0 &&
        (a1[0] - a2[0]) * (a3[0] - a2[0]) + (a1[1] - a2[1]) * (a3[1] - a2[1]) > 0) {
      throw new InvalidGeometryError("polygon has overlapping adjacent edges");
    }
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (j + 1) % n === i) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        throw new InvalidGeometryError("polygon is self-intersecting or has touching/overlapping edges");
      }
    }
  }
  const [originX, originY] = vertices[0];
  let twiceArea = 0;
  let magnitude = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = vertices[i], b = vertices[i + 1];
    const left = (a[0] - originX) * (b[1] - originY);
    const right = (a[1] - originY) * (b[0] - originX);
    twiceArea += left - right;
    magnitude += Math.abs(left) + Math.abs(right);
  }
  if (Math.abs(twiceArea) <= 32 * Number.EPSILON * magnitude) {
    throw new InvalidGeometryError("polygon must have a non-zero area");
  }

}

