import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AreaIdPipe } from "../common/pipes/area-id.pipe";
import { AreasService } from "./areas.service";
import { CreateAreaDto } from "./dto/create-area.dto";
import { UpdateAreaDto } from "./dto/update-area.dto";
import { BboxQueryDto } from "./dto/bbox-query.dto";
import { SearchAreasQueryDto } from "./dto/search-areas-query.dto";
import { DeleteAreaQueryDto } from "./dto/delete-area-query.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DrawRateLimitGuard } from "../common/rate-limit/draw-rate-limit.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt-payload.interface";

@ApiTags("areas")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("areas")
export class AreasController {
  constructor(private readonly areasService: AreasService) {}

  @Get()
  async list(@Query() query: BboxQueryDto) {
    const [minLng, minLat, maxLng, maxLat] = query.bbox;
    const areas = await this.areasService.getInBounds({ minLng, minLat, maxLng, maxLat });
    return { areas };
  }

  @Get("search")
  async search(@Query() query: SearchAreasQueryDto) {
    return this.areasService.search(query.search ?? "", query.cursor, query.limit);
  }

  @Get(":id")
  async findOne(@Param("id", AreaIdPipe) id: string) {
    const area = await this.areasService.getByIdOrThrow(id);
    return { area };
  }

  @Get(":id/history")
  async history(@Param("id", AreaIdPipe) id: string) {
    const history = await this.areasService.getHistory(id);
    return { history };
  }

  @UseGuards(DrawRateLimitGuard)
  @Post()
  async create(@Body() dto: CreateAreaDto, @CurrentUser() user: AuthenticatedUser) {
    const area = await this.areasService.create(dto.name, dto.geometry, user.id);
    return { area };
  }

  @UseGuards(DrawRateLimitGuard)
  @Put(":id")
  async update(@Param("id", AreaIdPipe) id: string, @Body() dto: UpdateAreaDto, @CurrentUser() user: AuthenticatedUser) {
    const area = await this.areasService.update(id, dto.version, { name: dto.name, geometry: dto.geometry }, user.id);
    return { area };
  }

  @UseGuards(DrawRateLimitGuard)
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", AreaIdPipe) id: string, @Query() query: DeleteAreaQueryDto, @CurrentUser() user: AuthenticatedUser) {
    await this.areasService.remove(id, query.version, user.id);
  }
}
