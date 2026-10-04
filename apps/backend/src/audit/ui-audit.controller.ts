import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Matches, Max, Min, ValidateIf } from "class-validator";
import { UI_AUDIT_ACTIONS, UI_AUDIT_VALUES, type UiAuditEvent } from "@snapland/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt-payload.interface";
import { AREA_ID_PATTERN } from "../common/pipes/area-id.pipe";
import { AuditService } from "./audit.service";

export class UiAuditDto implements UiAuditEvent {
  @IsIn(UI_AUDIT_ACTIONS)
  action!: UiAuditEvent["action"];

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(UI_AUDIT_VALUES)
  value?: UiAuditEvent["value"];

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(AREA_ID_PATTERN)
  areaId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version?: number;
}

@ApiTags("audit")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("audit/events")
export class UiAuditController {
  constructor(private readonly audit: AuditService) {}

  @Post()
  @HttpCode(204)
  async record(@Body() event: UiAuditDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.audit.record({
      userId: user.id, action: event.action, entityType: "ui", entityId: event.areaId,
      metadata: { source: "client", value: event.value, version: event.version },
    });
  }
}
