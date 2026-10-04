import "reflect-metadata";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@snapland/shared";
import { PubSubService } from "../src/websocket/pubsub.service";

describe("internal broadcast routing", () => {
  it.each([undefined, "connection-uuid"])("round-trips origin %s separately from the public message", async (origin) => {
    const subscriber = Object.assign(new EventEmitter(), { subscribe: vi.fn().mockResolvedValue(1) });
    const redis = { publish: vi.fn(async (channel: string, raw: string) => {
      subscriber.emit("message", channel, raw);
      return 1;
    }) };
    const service = new PubSubService(redis as never, subscriber as never);
    const handler = vi.fn();
    service.onBroadcast(handler);
    await service.onModuleInit();
    const message: ServerMessage = { type: "draw:cancel", payload: { userId: "user-1" } };
    await service.publish(message, origin);
    if (origin) {
      expect(JSON.parse(redis.publish.mock.calls[0][1])).toEqual({ message, originConnectionId: origin });
      expect(handler).toHaveBeenCalledWith(message, origin);
    } else {
      expect(JSON.parse(redis.publish.mock.calls[0][1])).toEqual(message);
      expect(handler).toHaveBeenCalledWith(message);
    }
    expect(handler.mock.calls[0][0]).toEqual(message);
    expect(Object.keys(handler.mock.calls[0][0]).sort()).toEqual(["payload", "type"]);
  });
});
