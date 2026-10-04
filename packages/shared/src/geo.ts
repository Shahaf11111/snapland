/** A single [longitude, latitude] pair, WGS84 (EPSG:4326). */
export type LngLat = [number, number];

/**
 * A closed polygon ring: first and last point must be equal.
 * Only single-ring (no-hole) polygons are supported by this app.
 */
export type PolygonRing = LngLat[];

export interface AreaGeometry {
  type: "Polygon";
  coordinates: [PolygonRing];
}
