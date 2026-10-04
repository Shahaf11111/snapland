import { Type } from "class-transformer";
import { IsInt, IsPositive, Max } from "class-validator";

export class DeleteAreaQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(2147483647)
  version!: number;
}
