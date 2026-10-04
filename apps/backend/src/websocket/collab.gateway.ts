import { randomUUID } from "node:crypto";
import { Inject, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type Redis from "ioredis";
import type { PresenceUser, ServerMessage } from "@snapland/shared";
import { REDIS_CLIENT } from "../database/redis.constants";
import { checkSlidingWindowRateLimit } from "../common/rate-limit/rate-limit.util";
import { PresenceService, PRESENCE_HEARTBEAT_MS } from "./presence.service";
import { AreaEditingService } from "./area-editing.service";
import { PubSubService } from "./pubsub.service";
import { TokenService } from "../auth/token.service";
import { AuditService } from "../audit/audit.service";
import { MetricsService } from "../metrics/metrics.service";
import type { EnvConfig } from "../config/env.validation";
import { clientMessageSchema, MAX_WS_PAYLOAD_BYTES } from "./client-message.schema";

interface ClientState {
  connectionId: string;
  userId: string;
  name: string;
  previewRevision: number;
  alive: boolean;
  ready: boolean;
  editingAreaId?: string;
}

/**
 * Message types that are safe to drop for a single backlogged client: both
 * are latest-wins previews (see `ClientState.previewRevision` and the
 * frontend's single-pending-preview buffer), so skipping a stale one just
 * means the next one arrives sooner. Durable types (area:*, presence:*,
 * error) are never dropped — only shed via the hard disconnect threshold.
 */
const DROPPABLE_UNDER_PRESSURE: ReadonlySet<ServerMessage["type"]> = new Set(["draw:progress", "draw:cancel"]);

/**
 * Hand-rolled connection/message handling instead of `@SubscribeMessage`
 * decorators: the wire protocol here is the same `{type, payload}` JSON
 * envelope the frontend already speaks (see `packages/shared/src/ws-protocol.ts`),
 * not the `{event, data}` convention Nest's `WsAdapter` assumes — so
 * messages are parsed manually, exactly as a plain `ws` server would.
 */
@WebSocketGateway({ path: "/ws", maxPayload: MAX_WS_PAYLOAD_BYTES })
export class CollabGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(CollabGateway.name);
  private readonly clients = new Map<WebSocket, ClientState>();

  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private heartbeatRunning = false;

  constructor(
    private readonly presence: PresenceService,
    private readonly areaEditing: AreaEditingService,
    private readonly pubsub: PubSubService,
    private readonly tokens: TokenService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService
  ) {}

  afterInit(): void {
    this.pubsub.onBroadcast((message, originConnectionId) => this.broadcastLocal(message, originConnectionId));
    this.heartbeatTimer = setInterval(() => { void this.heartbeat(); }, PRESENCE_HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const url = new URL(request.url ?? "", "http://localhost");
      const token = url.searchParams.get("token") ?? undefined;
      const user = this.verifyTokenOrNull(token);

      if (!user) {
        void this.audit.record({ userId: null, action: "ws.connect", entityType: "connection", metadata: { outcome: "unauthorized" } });
        this.send(client, { type: "error", payload: { code: "unauthorized", message: "Unauthorized: invalid or missing token" } });
        client.close(4001, "Unauthorized");
        return;
      }

      const state: ClientState = { connectionId: randomUUID(), userId: user.id, name: user.name, previewRevision: 0, alive: true, ready: false };
      this.clients.set(client, state);
      client.on("error", (error: Error & { code?: string }) => {
        void this.audit.record({ userId: state.userId, action: "ws.transport.error", entityType: "connection", metadata: { connectionId: state.connectionId, reason: error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ? "message_too_large" : "transport_error" } });
      });
      this.metrics.wsConnectionsGauge.inc();

      const presenceUser: PresenceUser = { userId: user.id, name: user.name, color: this.presence.colorForUser(user.id) };
      await this.presence.markPresent(state.connectionId, presenceUser);
      if (!this.clients.has(client)) {
        await this.presence.markAbsent(state.connectionId);
        return;
      }
      const users = await this.presence.list();
      if (!this.clients.has(client)) return;
      state.ready = true;
      client.on("pong", () => {
        if (this.clients.get(client) !== state) return;
        state.alive = true;
        void this.presence.markPresent(state.connectionId, presenceUser)
          .catch((err) => this.logFailure("presence renewal", err));
        if (state.editingAreaId) {
          void this.areaEditing.renew(state.editingAreaId, state.connectionId)
            .catch((err) => this.logFailure("area-editing renewal", err));
        }
      });
      client.on("message", (raw) => { void this.handleMessage(client, user.id, raw.toString()); });
      this.send(client, { type: "presence:list", payload: { users } });
      void this.audit.record({ userId: user.id, action: "ws.connect", entityType: "connection", metadata: { connectionId: state.connectionId, outcome: "success" } });
    } catch (err) {
      this.logFailure("connection setup", err);
      const state = this.clients.get(client);
      void this.audit.record({ userId: state?.userId ?? null, action: "ws.connect", entityType: "connection", metadata: { connectionId: state?.connectionId, outcome: "internal_error" } });
      this.send(client, { type: "error", payload: { code: "internal_error", message: "Unable to initialize connection" } });
      client.close(1011, "Unable to initialize connection");
      await this.handleDisconnect(client);
    }
  }

  async handleDisconnect(client: WebSocket): Promise<void> {
    const state = this.clients.get(client);
    if (!state) return;
    this.clients.delete(client);
    void this.audit.record({ userId: state.userId, action: "ws.disconnect", entityType: "connection", metadata: { connectionId: state.connectionId } });
    this.metrics.wsConnectionsGauge.dec();

    try {
      await this.presence.markAbsent(state.connectionId);
    } catch (err) {
      this.logFailure(`presence cleanup user=${state.userId}`, err);
    }

    if (state.editingAreaId) {
      try {
        await this.areaEditing.stop(state.editingAreaId, state.connectionId);
        await this.broadcastEditingList();
      } catch (err) {
        this.logFailure(`area-editing cleanup user=${state.userId}`, err);
      }
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeatTimer);
  }

  private async heartbeat(): Promise<void> {
    // Transport liveness must keep running even while a Redis sweep is pending.
    for (const [client, state] of this.clients) {
      if (!state.ready) continue;
      if (!state.alive || client.readyState !== client.OPEN) {
        client.terminate();
        void this.handleDisconnect(client);
        continue;
      }
      state.alive = false;
      try {
        client.ping(undefined, undefined, (err) => {
          if (!err) return;
          this.logFailure("heartbeat ping", err);
          client.terminate();
          void this.handleDisconnect(client);
        });
      } catch (err) {
        this.logFailure("heartbeat ping", err);
        client.terminate();
        void this.handleDisconnect(client);
      }
    }
    if (this.heartbeatRunning) return;
    this.heartbeatRunning = true;
    try {
      // Also sweeps leases owned by crashed instances; snapshots repair missed
      // pub/sub presence events after Redis reconnects.
      const users = await this.presence.list();
      this.broadcastLocal({ type: "presence:list", payload: { users } });
      // Same resync role for area-editing leases: computed from shared Redis
      // state, so every instance can broadcast directly to its own clients
      // without relaying through pub/sub on every heartbeat tick.
      const editing = await this.areaEditing.list();
      this.broadcastLocal({ type: "area:editing:list", payload: { editing } });
    } catch (err) {
      this.logFailure("presence sweep", err);
    } finally {
      this.heartbeatRunning = false;
    }
  }

  private async handleMessage(client: WebSocket, userId: string, raw: string): Promise<void> {
    const state = this.clients.get(client);
    if (!state) return;
    const audit = (outcome: string, messageType = "invalid", pointCount?: number) => {
      void this.audit.record({
        userId, action: "ws.message", entityType: "connection",
        metadata: { connectionId: state.connectionId, outcome, messageType, pointCount, bytes: Buffer.byteLength(raw) },
      });
    };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      audit("invalid_json");
      this.send(client, { type: "error", payload: { code: "invalid_json", message: "Malformed JSON message" } });
      return;
    }

    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      audit("invalid_message");
      this.send(client, { type: "error", payload: { code: "invalid_message", message: "Invalid WebSocket message: expected a supported type and valid payload" } });
      return;
    }
    const message = result.data;
    try {
      this.metrics.wsMessagesCounter.inc({ type: message.type });

      switch (message.type) {
        case "draw:progress": {
          const revision = ++state.previewRevision;
          const limit = this.config.get("WS_PREVIEW_MAX_PER_SECOND", { infer: true });
          const { allowed } = await checkSlidingWindowRateLimit(this.redis, `ratelimit:preview:${userId}`, limit, 1000);
          // A newer preview or cancel may arrive while the limiter is pending.
          if (this.clients.get(client) !== state || state.previewRevision !== revision) { audit("superseded", message.type, message.payload.points.length); return; }
          if (!allowed) {
            audit("rate_limited", message.type, message.payload.points.length);
            this.send(client, { type: "error", payload: { code: "rate_limited", message: `Rate limit exceeded: max ${limit} preview updates/sec` } });
            return;
          }
          await this.pubsub.publish({ type: "draw:progress", payload: { userId, points: message.payload.points } }, state.connectionId);
          break;
        }
        case "draw:cancel": {
          state.previewRevision++;
          await this.pubsub.publish({ type: "draw:cancel", payload: { userId } }, state.connectionId);
          break;
        }
        case "viewport:update": {
          // Validated but intentionally not broadcast or acknowledged yet.
          break;
        }
        case "area:editing:start": {
          const { areaId } = message.payload;
          state.editingAreaId = areaId;
          const user: PresenceUser = { userId, name: state.name, color: this.presence.colorForUser(userId) };
          await this.areaEditing.start(areaId, state.connectionId, user);
          await this.broadcastEditingList();
          break;
        }
        case "area:editing:stop": {
          const { areaId } = message.payload;
          if (state.editingAreaId === areaId) state.editingAreaId = undefined;
          await this.areaEditing.stop(areaId, state.connectionId);
          await this.broadcastEditingList();
          break;
        }
      }
      audit(message.type === "viewport:update" ? "ignored" : "success", message.type, message.type === "draw:progress" ? message.payload.points.length : undefined);
    } catch (err) {
      audit("internal_error", message.type);
      this.logFailure(`message type=${message.type} user=${userId}`, err);
      this.send(client, { type: "error", payload: { code: "internal_error", message: "Unable to process message" } });
    }
  }

  /** Cross-instance immediate update for a single start/stop (unlike the
   *  heartbeat resync, this needs pub/sub since the triggering connection
   *  may live on a different instance than the clients watching this area). */
  private async broadcastEditingList(): Promise<void> {
    const editing = await this.areaEditing.list();
    await this.pubsub.publish({ type: "area:editing:list", payload: { editing } });
  }

  private broadcastLocal(message: ServerMessage, originConnectionId?: string): void {
    const transient = message.type === "draw:progress" || message.type === "draw:cancel";
    for (const [client, state] of this.clients) {
      if (!state.ready) continue;
      if (transient && state.connectionId === originConnectionId) continue;
      this.send(client, message);
    }
  }

  /**
   * Backpressure: `ws` buffers outbound frames in process memory whenever a
   * client can't drain its socket fast enough (slow network, backgrounded
   * tab). Left unchecked, a single stuck client's `bufferedAmount` grows
   * without bound under high broadcast volume. Past the hard threshold the
   * connection is treated like a failed heartbeat and torn down; below that,
   * droppable preview types are shed first so durable messages (area
   * mutations, presence) still get through to a merely-slow client.
   */
  private send(client: WebSocket, message: ServerMessage): void {
    if (client.readyState !== client.OPEN) return;

    const hardLimit = this.config.get("WS_BACKPRESSURE_HARD_BYTES", { infer: true });
    if (client.bufferedAmount >= hardLimit) {
      this.metrics.wsBackpressureCounter.inc({ action: "disconnect" });
      this.logger.warn(`Terminating backlogged client (bufferedAmount=${client.bufferedAmount})`);
      client.terminate();
      void this.handleDisconnect(client);
      return;
    }

    const softLimit = this.config.get("WS_BACKPRESSURE_SOFT_BYTES", { infer: true });
    if (client.bufferedAmount >= softLimit && DROPPABLE_UNDER_PRESSURE.has(message.type)) {
      this.metrics.wsBackpressureCounter.inc({ action: "drop" });
      return;
    }

    try {
      client.send(JSON.stringify(message), (err) => {
        if (err) this.logFailure(`send type=${message.type}`, err);
      });
    } catch (err) {
      this.logFailure(`send type=${message.type}`, err);
    }
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.error(`WebSocket ${operation} failed`, error instanceof Error ? error.stack : String(error));
  }

  private verifyTokenOrNull(token: string | undefined) {
    if (!token) return null;
    try {
      const payload = this.tokens.verifyAccessToken(token);
      return { id: payload.sub, email: payload.email, name: payload.name };
    } catch {
      return null;
    }
  }
}
