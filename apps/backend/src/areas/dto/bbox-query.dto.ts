import { Transform } from "class-transformer";
import { ValidateBy } from "class-validator";

function parseBbox(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parts = value.split(",").map(part => part.trim());
  if (parts.length !== 4 || parts.some(part => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(part))) return [];
  return parts.map(Number);
}

export class BboxQueryDto {
  @Transform(({ value }) => parseBbox(value))
  @ValidateBy({
    name: "validBoundingBox",
    validator: {
      validate(value: unknown) {
        if (!Array.isArray(value) || value.length !== 4 || !value.every(n => typeof n === "number" && Number.isFinite(n))) return false;
        const [west, south, east, north] = value;
        return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west <= east && south <= north;
      },
      defaultMessage: () => "bbox must contain exactly four finite coordinates: -180 <= west <= east <= 180 and -90 <= south <= north <= 90",
    },
  })
  bbox!: [number, number, number, number];
}
