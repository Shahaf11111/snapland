import type { AreaGeometry } from "@snapland/shared";
export { validatePolygonGeometry, InvalidGeometryError } from "@snapland/shared";

export function geometryToWkt(geometry: AreaGeometry): string {
  const ring = geometry.coordinates[0];
  const coords = ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
  return `SRID=4326;POLYGON((${coords}))`;
}
