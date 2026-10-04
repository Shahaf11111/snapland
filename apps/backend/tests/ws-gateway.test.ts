import "reflect-metadata";
import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { ServerMessage } from "@snapland/shared";
import { PRESENCE_HEARTBEAT_MS } from "../src/websocket/presence.service";
import { CollabGateway } from "../src/websocket/collab.gateway";

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn((_raw: string, callback?: (error?: Error) => void) => callback?.());
  ping = vi.fn();
  terminate = vi.fn(() => { this.readyState = 3; });
  close = vi.fn(() => { this.readyState = 3; });
  asWebSocket() { return this as unknown as WebSocket; }
  messages() { return this.send.mock.calls.map(([raw]) => JSON.parse(raw) as ServerMessage); }
  receive(message: unknown) { this.emit("message", Buffer.from(JSON.stringify(message))); }
}

const gateways: CollabGateway[] = [];

function setup() {
  const presence = {
    colorForUser: vi.fn(() => "#fff"), markPresent: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]), markAbsent: vi.fn().mockResolvedValue(undefined),
  };
  const areaEditing = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({}),
  };
  const pubsub = { publish: vi.fn().mockResolvedValue(undefined), onBroadcast: vi.fn() };
  const tokens = { verifyAccessToken: vi.fn(() => ({ sub: "user-1", name: "Demo", email: "demo@example.com" })) };
  const metrics = {
    wsConnectionsGauge: { inc: vi.fn(), dec: vi.fn() },
    wsMessagesCounter: { inc: vi.fn() },
    wsBackpressureCounter: { inc: vi.fn() },
  };
  const transaction = {
    zremrangebyscore: vi.fn(), zadd: vi.fn(), zcard: vi.fn(), pexpire: vi.fn(),
    exec: vi.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]),
  };
  const redis = { multi: vi.fn(() => transaction), zremrangebyrank: vi.fn().mockResolvedValue(1) };
  const config = {
    get: vi.fn((key: string) => {
      if (key === "WS_PREVIEW_MAX_PER_SECOND") return 20;
      if (key === "WS_BACKPRESSURE_SOFT_BYTES") return 65536;
      if (key === "WS_BACKPRESSURE_HARD_BYTES") return 1048576;
      return 50;
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const gateway = new CollabGateway(presence as never, areaEditing as never, pubsub as never, tokens as never, metrics as never, config as never, redis as never, audit as never);
  gateways.push(gateway);
  const socket = new FakeSocket();
  const request = { url: "/ws?token=test-token" } as IncomingMessage;
  const connect = () => gateway.handleConnection(socket.asWebSocket(), request);
  return { gateway, socket, presence, areaEditing, pubsub, tokens, metrics, transaction, redis, config, connect, audit };
}

const progress = { type: "draw:progress", payload: { points: [[34.78, 32.08]] } };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("WebSocket validation and async error boundaries", () => {
  beforeEach(() => { vi.spyOn(Logger.prototype, "error").mockImplementation(() => {}); });
  afterEach(() => { gateways.splice(0).forEach(gateway => gateway.onModuleDestroy()); vi.useRealTimers(); vi.restoreAllMocks(); });


  it("excludes only the originating connection across gateways, and keeps durable events global", async () => {
    const a = setup();
    const b = setup();
    await a.connect();
    await b.connect();
    const tab = new FakeSocket();
    await a.gateway.handleConnection(tab.asWebSocket(), { url: "/ws?token=same-user" } as IncomingMessage);
    a.gateway.afterInit();
    b.gateway.afterInit();
    a.pubsub.publish.mockImplementation(async (message: ServerMessage, origin?: string) => {
      a.pubsub.onBroadcast.mock.calls[0][0](message, origin);
      b.pubsub.onBroadcast.mock.calls[0][0](message, origin);
    });
    a.socket.send.mockClear();
    tab.send.mockClear();
    b.socket.send.mockClear();
    a.socket.receive(progress);
    await settle();
    a.socket.receive({ type: "draw:cancel", payload: {} });
    await settle();
    expect(a.socket.messages()).toEqual([]);
    for (const peer of [tab, b.socket]) {
      expect(peer.messages()).toEqual([
        { type: "draw:progress", payload: { userId: "user-1", points: progress.payload.points } },
        { type: "draw:cancel", payload: { userId: "user-1" } },
      ]);
    }
    const origin = a.pubsub.publish.mock.calls.find(([m]) => m.type === "draw:progress")![1];
    const durable: ServerMessage = { type: "area:deleted", payload: { areaId: "area-1" } };
    await a.pubsub.publish(durable, origin);
    expect(a.socket.messages()).toEqual([durable]);
    expect(tab.messages().at(-1)).toEqual(durable);
    expect(b.socket.messages().at(-1)).toEqual(durable);
    tab.receive(progress);
    await settle();
    const tabOrigin = a.pubsub.publish.mock.calls.at(-1)![1];
    expect(tabOrigin).not.toBe(origin);
    expect(a.socket.messages().at(-1)?.type).toBe("draw:progress");
  });


  it("renews a responding socket, terminates a silent one, and stops its timer on destruction", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.socket.ping).toHaveBeenCalledTimes(1);
    s.socket.emit("pong");
    await Promise.resolve();
    expect(s.presence.markPresent).toHaveBeenCalledTimes(2);
    expect(s.presence.markPresent.mock.calls[1]).toEqual(s.presence.markPresent.mock.calls[0]);
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.socket.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.socket.terminate).toHaveBeenCalledTimes(1);
    expect(s.presence.markAbsent).toHaveBeenCalledWith(s.presence.markPresent.mock.calls[0][0]);
    expect(s.metrics.wsConnectionsGauge.dec).toHaveBeenCalledTimes(1);
    s.socket.emit("pong");
    expect(s.presence.markPresent).toHaveBeenCalledTimes(2);
    s.gateway.onModuleDestroy();
    const calls = s.presence.list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.presence.list).toHaveBeenCalledTimes(calls);
  });

  it("contains renewal and sweep failures and recovers on the next heartbeat", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    s.presence.list.mockRejectedValueOnce(new Error("Redis down"));
    s.presence.markPresent.mockRejectedValueOnce(new Error("Redis down"));
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    s.socket.emit("pong");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.socket.terminate).not.toHaveBeenCalled();
    expect(s.socket.messages().slice(-2)).toEqual([
      { type: "presence:list", payload: { users: [] } },
      { type: "area:editing:list", payload: { editing: {} } },
    ]);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
  });

  it("removes the same connection when it disconnects during registration", async () => {
    const s = setup();
    let registered!: () => void;
    s.presence.markPresent.mockReturnValueOnce(new Promise<void>((resolve) => { registered = resolve; }));
    const connecting = s.connect();
    await s.gateway.handleDisconnect(s.socket.asWebSocket());
    registered();
    await connecting;
    const connectionId = s.presence.markPresent.mock.calls[0][0];
    expect(s.presence.markAbsent.mock.calls).toEqual([[connectionId], [connectionId]]);
    expect(s.metrics.wsConnectionsGauge.dec).toHaveBeenCalledTimes(1);
    expect(s.socket.messages()).toEqual([]);
  });


  it.each(["throw", "callback"])("contains heartbeat ping failures (%s)", async (mode) => {
    vi.useFakeTimers();
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    s.socket.ping.mockImplementation((_data, _mask, callback) => {
      if (mode === "throw") throw new Error("ping failed");
      callback(new Error("ping failed"));
    });
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.socket.terminate).toHaveBeenCalledTimes(1);
    expect(s.metrics.wsConnectionsGauge.dec).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it("keeps transport heartbeat checks running while Redis is slow", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    let finish!: (users: never[]) => void;
    s.presence.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2);
    expect(s.socket.terminate).toHaveBeenCalledTimes(1);
    expect(s.presence.list).toHaveBeenCalledTimes(2);
    finish([]);
    await Promise.resolve();
  });

  it("does not send heartbeat snapshots before connection setup completes", async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: (users: never[]) => void;
    s.presence.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const connecting = s.connect();
    await Promise.resolve();
    s.gateway.afterInit();
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(s.socket.messages()).toEqual([]);
    expect(s.socket.ping).not.toHaveBeenCalled();
    finish([]);
    await connecting;
    expect(s.socket.messages()).toEqual([{ type: "presence:list", payload: { users: [] } }]);
  });

  it("audits valid, invalid, throttled and failed messages without recording payloads", async () => {
    const s = setup();
    await s.connect();
    s.socket.emit("message", Buffer.from("{secret"));
    s.socket.receive({ type: "attacker-controlled-label", payload: { password: "secret" } });
    s.socket.receive(progress);
    await settle();
    s.transaction.exec.mockResolvedValueOnce([[null, 0], [null, 1], [null, 21], [null, 1]]);
    s.socket.receive(progress);
    await settle();
    s.pubsub.publish.mockRejectedValueOnce(new Error("private"));
    s.socket.receive({ type: "draw:cancel", payload: {} });
    await settle();
    await s.gateway.handleDisconnect(s.socket.asWebSocket());
    const entries = s.audit.record.mock.calls.map(([entry]) => entry);
    expect(entries.filter(e => e.action === "ws.message").map(e => e.metadata.outcome))
      .toEqual(["invalid_json", "invalid_message", "success", "rate_limited", "internal_error"]);
    expect(entries[0]).toMatchObject({ action: "ws.connect", userId: "user-1" });
    expect(entries.at(-1)).toMatchObject({ action: "ws.disconnect", userId: "user-1" });
    expect(JSON.stringify(entries)).not.toContain("secret");
    expect(JSON.stringify(entries)).not.toContain("attacker-controlled-label");
    expect(entries.find(e => e.metadata.pointCount)).toMatchObject({ metadata: { messageType: "draw:progress", pointCount: 1 } });
  });

  it("rejects bad JSON and invalid payloads before metrics, Redis or broadcasting; then accepts a valid message", async () => {
    const s = setup();
    await s.connect();
    s.pubsub.publish.mockClear();
    s.socket.emit("message", Buffer.from("{"));
    s.socket.receive(null);
    s.socket.receive({ type: "unbounded-metric-label", payload: {} });
    s.socket.receive({ type: "draw:progress", payload: { points: [[181, 0]] } });
    await settle();
    expect(s.metrics.wsMessagesCounter.inc).not.toHaveBeenCalled();
    expect(s.redis.multi).not.toHaveBeenCalled();
    expect(s.pubsub.publish).not.toHaveBeenCalled();
    expect(s.socket.messages().slice(1).map(m => m.payload)).toEqual([
      expect.objectContaining({ code: "invalid_json" }),
      expect.objectContaining({ code: "invalid_message" }),
      expect.objectContaining({ code: "invalid_message" }),
      expect.objectContaining({ code: "invalid_message" }),
    ]);
    s.socket.receive(progress);
    await settle();
    expect(s.pubsub.publish).toHaveBeenCalledWith({ type: "draw:progress", payload: { userId: "user-1", points: progress.payload.points } }, expect.any(String));
    expect(s.socket.close).not.toHaveBeenCalled();
  });

  it.each(["limiter", "publish", "transaction command"])("contains %s failures and allows later messages", async (failure) => {
    const s = setup();
    await s.connect();
    s.pubsub.publish.mockClear();
    const error = new Error("private infrastructure detail");
    if (failure === "limiter") s.transaction.exec.mockRejectedValueOnce(error);
    if (failure === "publish") s.pubsub.publish.mockRejectedValueOnce(error);
    if (failure === "transaction command") s.transaction.exec.mockResolvedValueOnce([[null, 0], [null, 1], [error, null], [null, 1]]);
    s.socket.receive(progress);
    await settle();
    expect(s.socket.messages().at(-1)).toEqual({ type: "error", payload: { code: "internal_error", message: "Unable to process message" } });
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining("type=draw:progress user=user-1"), expect.stringContaining("private infrastructure detail"));
    expect(s.socket.close).not.toHaveBeenCalled();
    s.socket.receive(progress);
    await settle();
    expect(s.pubsub.publish).toHaveBeenLastCalledWith({ type: "draw:progress", payload: { userId: "user-1", points: progress.payload.points } }, expect.any(String));
  });

  it("returns a typed rate-limit error without publishing", async () => {
    const s = setup();
    await s.connect();
    s.pubsub.publish.mockClear();
    s.transaction.exec.mockResolvedValueOnce([[null, 0], [null, 1], [null, 21], [null, 1]]);
    s.socket.receive(progress);
    await settle();
    expect(s.socket.messages().at(-1)?.payload).toEqual(expect.objectContaining({ code: "rate_limited" }));
    expect(s.pubsub.publish).not.toHaveBeenCalled();
    expect(s.config.get).toHaveBeenCalledWith("WS_PREVIEW_MAX_PER_SECOND", { infer: true });
    expect(s.transaction.zcard).toHaveBeenCalledWith("ratelimit:preview:user-1");
    expect(s.transaction.pexpire).toHaveBeenCalledWith("ratelimit:preview:user-1", 1000);
    s.socket.receive({ type: "draw:cancel", payload: {} });
    await settle();
    expect(s.pubsub.publish).toHaveBeenCalledWith({ type: "draw:cancel", payload: { userId: "user-1" } }, expect.any(String));
    expect(s.redis.multi).toHaveBeenCalledTimes(1);
  });

  it("does not publish an older preview after cancellation while the limiter was pending", async () => {
    const s = setup();
    await s.connect();
    s.pubsub.publish.mockClear();
    let finishLimit!: (value: unknown) => void;
    s.transaction.exec.mockReturnValueOnce(new Promise((resolve) => { finishLimit = resolve; }));
    s.socket.receive(progress);
    s.socket.receive({ type: "draw:cancel", payload: {} });
    await settle();
    finishLimit([[null, 0], [null, 1], [null, 1], [null, 1]]);
    await settle();
    expect(s.pubsub.publish).toHaveBeenCalledTimes(1);
    expect(s.pubsub.publish).toHaveBeenCalledWith({ type: "draw:cancel", payload: { userId: "user-1" } }, expect.any(String));
  });

  it("contains cancellation publication failures and treats valid viewport updates as a no-op", async () => {
    const s = setup();
    await s.connect();
    s.pubsub.publish.mockClear();
    s.pubsub.publish.mockRejectedValueOnce(new Error("Redis down"));
    s.socket.receive({ type: "draw:cancel", payload: {} });
    await settle();
    expect(s.socket.messages().at(-1)?.payload).toEqual(expect.objectContaining({ code: "internal_error" }));
    s.pubsub.publish.mockClear();
    s.socket.receive({ type: "viewport:update", payload: { bbox: [0, 0, 1, 1] } });
    await settle();
    expect(s.pubsub.publish).not.toHaveBeenCalled();
    expect(s.redis.multi).not.toHaveBeenCalled();
  });

  it.each(["markPresent", "list"])("closes and cleans up when connection setup fails at %s", async (stage) => {
    const s = setup();
    s.presence[stage as "markPresent" | "list"].mockRejectedValueOnce(new Error("Redis down"));
    await expect(s.connect()).resolves.toBeUndefined();
    expect(s.socket.close).toHaveBeenCalledWith(1011, "Unable to initialize connection");
    expect(s.presence.markAbsent).toHaveBeenCalledWith(expect.any(String));
    expect(s.metrics.wsConnectionsGauge.dec).toHaveBeenCalledTimes(1);
    await s.gateway.handleDisconnect(s.socket.asWebSocket());
    expect(s.metrics.wsConnectionsGauge.dec).toHaveBeenCalledTimes(1);
  });

  it("does not decrement the connection gauge for rejected authentication", async () => {
    const s = setup();
    s.tokens.verifyAccessToken.mockImplementation(() => { throw new Error("bad token"); });
    await s.connect();
    await s.gateway.handleDisconnect(s.socket.asWebSocket());
    expect(s.socket.close).toHaveBeenCalledWith(4001, "Unauthorized");
    expect(s.metrics.wsConnectionsGauge.inc).not.toHaveBeenCalled();
    expect(s.metrics.wsConnectionsGauge.dec).not.toHaveBeenCalled();
  });

  it("contains cleanup failures without announcing a false leave, and ignores messages after disconnect", async () => {
    const s = setup();
    await s.connect();
    s.presence.markAbsent.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(s.gateway.handleDisconnect(s.socket.asWebSocket())).resolves.toBeUndefined();
    expect(s.pubsub.publish).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalled();
    s.pubsub.publish.mockClear();
    s.socket.receive(progress);
    await settle();
    expect(s.pubsub.publish).not.toHaveBeenCalled();
  });

  it.each(["throw", "callback"])("isolates socket send errors (%s) so broadcast reaches other clients", async (mode) => {
    const s = setup();
    await s.connect();
    const other = new FakeSocket();
    await s.gateway.handleConnection(other.asWebSocket(), { url: "/ws?token=other-token" } as IncomingMessage);
    s.gateway.afterInit();
    s.socket.send.mockImplementation((_raw, callback) => {
      if (mode === "throw") throw new Error("socket failed");
      callback?.(new Error("socket failed"));
    });
    const broadcast = s.pubsub.onBroadcast.mock.calls[0][0] as (message: ServerMessage) => void;
    const event: ServerMessage = { type: "draw:cancel", payload: { userId: "user-1" } };
    expect(() => broadcast(event)).not.toThrow();
    expect(other.messages().at(-1)).toEqual(event);
  });

  it("drops droppable previews but still delivers durable messages to a client past the soft backpressure threshold", async () => {
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    const broadcast = s.pubsub.onBroadcast.mock.calls[0][0] as (message: ServerMessage, originConnectionId?: string) => void;
    s.socket.send.mockClear();
    s.socket.bufferedAmount = 65536;
    broadcast({ type: "draw:progress", payload: { userId: "other-user", points: [] } });
    broadcast({ type: "area:deleted", payload: { areaId: "area-1" } });
    expect(s.socket.messages()).toEqual([{ type: "area:deleted", payload: { areaId: "area-1" } }]);
    expect(s.metrics.wsBackpressureCounter.inc).toHaveBeenCalledWith({ action: "drop" });
    expect(s.socket.terminate).not.toHaveBeenCalled();
  });

  it("terminates a client past the hard backpressure threshold, even for a durable message", async () => {
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    const broadcast = s.pubsub.onBroadcast.mock.calls[0][0] as (message: ServerMessage, originConnectionId?: string) => void;
    s.socket.send.mockClear();
    s.socket.bufferedAmount = 1048576;
    broadcast({ type: "area:deleted", payload: { areaId: "area-1" } });
    expect(s.socket.messages()).toEqual([]);
    expect(s.socket.terminate).toHaveBeenCalledTimes(1);
    expect(s.metrics.wsBackpressureCounter.inc).toHaveBeenCalledWith({ action: "disconnect" });
    expect(s.presence.markAbsent).toHaveBeenCalled();
  });

  it("broadcasts an area-editing snapshot on start and stop, scoped to this connection's lease", async () => {
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    s.pubsub.publish.mockClear();
    s.areaEditing.list.mockResolvedValue({ "area-1": { userId: "user-1", name: "Demo", color: "#fff" } });
    s.socket.receive({ type: "area:editing:start", payload: { areaId: "area-1" } });
    await settle();
    expect(s.areaEditing.start).toHaveBeenCalledWith("area-1", expect.any(String), { userId: "user-1", name: "Demo", color: "#fff" });
    expect(s.pubsub.publish).toHaveBeenCalledWith({ type: "area:editing:list", payload: { editing: { "area-1": { userId: "user-1", name: "Demo", color: "#fff" } } } });

    s.areaEditing.list.mockResolvedValue({});
    s.socket.receive({ type: "area:editing:stop", payload: { areaId: "area-1" } });
    await settle();
    expect(s.areaEditing.stop).toHaveBeenCalledWith("area-1", expect.any(String));
    expect(s.pubsub.publish).toHaveBeenLastCalledWith({ type: "area:editing:list", payload: { editing: {} } });
  });

  it("releases an area-editing lease and rebroadcasts the snapshot on disconnect", async () => {
    const s = setup();
    await s.connect();
    s.gateway.afterInit();
    s.socket.receive({ type: "area:editing:start", payload: { areaId: "area-1" } });
    await settle();
    s.pubsub.publish.mockClear();
    s.areaEditing.list.mockResolvedValue({});
    const connectionId = s.areaEditing.start.mock.calls[0][1] as string;
    await s.gateway.handleDisconnect(s.socket.asWebSocket());
    expect(s.areaEditing.stop).toHaveBeenCalledWith("area-1", connectionId);
    expect(s.pubsub.publish).toHaveBeenCalledWith({ type: "area:editing:list", payload: { editing: {} } });
  });
});
