import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type Redis from "ioredis";
import type { ServerMessage } from "@snapland/shared";
import { REDIS_CLIENT, REDIS_SUB_CLIENT } from "../database/redis.constants";

export const BROADCAST_CHANNEL = "snapland:broadcast";

type LocalBroadcastHandler = (message: ServerMessage, originConnectionId?: string) => void;

/**
 * Publishes server messages to every backend instance (including this one)
 * via Redis pub/sub, so WebSocket broadcasts work correctly behind a load
 * balancer with multiple app instances — a client connected to instance A
 * still sees a change written on instance B.
 */
@Injectable()
export class PubSubService implements OnModuleInit {
  private readonly logger = new Logger(PubSubService.name);
  private localHandler: LocalBroadcastHandler | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly redisSub: Redis
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redisSub.subscribe(BROADCAST_CHANNEL);
    this.redisSub.on("message", (channel, raw) => {
      if (channel !== BROADCAST_CHANNEL) return;
      try {
        const broadcast = JSON.parse(raw) as ServerMessage | { message: ServerMessage; originConnectionId: string };
        // Accept ordinary broadcasts too; routing metadata never reaches clients.
        if ("message" in broadcast) this.localHandler?.(broadcast.message, broadcast.originConnectionId);
        else this.localHandler?.(broadcast);
      } catch (err) {
        this.logger.error("failed to parse broadcast message", err as Error);
      }
    });
  }

  /** Registers the function that fans a message out to this instance's
   *  local WebSocket clients. Called once by the gateway at startup. */
  onBroadcast(handler: LocalBroadcastHandler): void {
    this.localHandler = handler;
  }

  async publish(message: ServerMessage, originConnectionId?: string): Promise<void> {
    const broadcast = originConnectionId ? { message, originConnectionId } : message;
    await this.redis.publish(BROADCAST_CHANNEL, JSON.stringify(broadcast));
  }
}
