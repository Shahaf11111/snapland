import { Module } from "@nestjs/common";
import { AreasController } from "./areas.controller";
import { AreasService } from "./areas.service";
import { AreasRepository } from "./areas.repository";
import { AreasCache } from "./areas.cache";
import { WebsocketModule } from "../websocket/websocket.module";
import { DrawRateLimitGuard } from "../common/rate-limit/draw-rate-limit.guard";

@Module({
  imports: [WebsocketModule],
  controllers: [AreasController],
  providers: [AreasService, AreasRepository, AreasCache, DrawRateLimitGuard],
})
export class AreasModule {}
