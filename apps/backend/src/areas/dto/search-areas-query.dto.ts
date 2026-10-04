import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class SearchAreasQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[^\u0000]*$/, { message: "search must not contain null characters" })
  search?: string;

  @IsOptional()
  // Postgres UUIDs also include deterministic seed IDs without RFC version bits.
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
}
