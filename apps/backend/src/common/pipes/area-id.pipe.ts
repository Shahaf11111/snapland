import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

// Accept PostgreSQL UUIDs, including seed IDs without RFC version bits.
export const AREA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AreaIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!AREA_ID_PATTERN.test(value)) throw new BadRequestException("Area id must be a UUID");
    return value;
  }
}
