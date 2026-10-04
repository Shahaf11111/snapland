import { Transform, Type } from "class-transformer";
import { IsDefined, ValidateIf, Max, IsInt, IsPositive, IsString, MaxLength, MinLength, ValidateNested, Matches } from "class-validator";
import { PolygonGeometryDto } from "./polygon-geometry.dto";

export class UpdateAreaDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\u0000]*$/, { message: "name must not contain null characters" })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => PolygonGeometryDto)
  geometry?: PolygonGeometryDto;

  @IsInt()
  @IsPositive()
  @Max(2147483647)
  version!: number;
}
