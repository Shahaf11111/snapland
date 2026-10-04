import { ArrayMinSize, IsArray, IsIn } from "class-validator";
import type { AreaGeometry } from "@snapland/shared";

/**
 * DTO-level check is deliberately shallow (just shape/type), so
 * class-validator gives a fast 400 for garbage payloads. Deep domain rules
 * — ring closure, self-intersection, coordinate ranges, minimum vertices —
 * live in `validatePolygonGeometry()` (common/utils/geo.util.ts) and run in
 * the service layer, which can then surface the *specific* reason a
 * polygon was rejected instead of a generic "invalid" message.
 */
export class PolygonGeometryDto implements AreaGeometry {
  @IsIn(["Polygon"])
  type!: "Polygon";

  @IsArray()
  @ArrayMinSize(1)
  coordinates!: [[number, number][]];
}
