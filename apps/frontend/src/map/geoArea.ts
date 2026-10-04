import turfArea from "@turf/area";
import type { LngLat } from "@snapland/shared";

/** Client-side live-preview area estimate (geodesic, via Turf). The
 *  authoritative value always comes from the backend's PostGIS
 *  `ST_Area(geography)` calculation on save. */
export function estimateAreaKm2(points: LngLat[]): number {
  if (points.length < 3) return 0;
  const ring = [...points, points[0]];
  const feature = { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
  return turfArea(feature) / 1_000_000;
}
