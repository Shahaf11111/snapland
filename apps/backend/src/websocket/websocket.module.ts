import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CollabGateway } from "./collab.gateway";
import { PresenceService } from "./presence.service";
import { PubSubService } from "./pubsub.service";
import { AreaEditingService } from "./area-editing.service";

@Module({
  imports: [AuthModule],
  providers: [CollabGateway, PresenceService, PubSubService, AreaEditingService],
  exports: [PubSubService],
})
export class WebsocketModule {}
