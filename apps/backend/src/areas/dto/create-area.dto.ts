import { Transform, Type } from "class-transformer";
import { IsDefined, IsString, MaxLength, MinLength, ValidateNested, Matches } from "class-validator";
import { PolygonGeometryDto } from "./polygon-geometry.dto";

export class CreateAreaDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\u0000]*$/, { message: "name must not contain null characters" })
  name!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PolygonGeometryDto)
  geometry!: PolygonGeometryDto;
}
