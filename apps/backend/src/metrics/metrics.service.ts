import { Injectable } from "@nestjs/common";
import client from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  readonly httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly wsConnectionsGauge = new client.Gauge({
    name: "ws_active_connections",
    help: "Currently active WebSocket connections on this instance",
    registers: [this.registry],
  });

  readonly wsMessagesCounter = new client.Counter({
    name: "ws_messages_total",
    help: "Total WebSocket messages received, by type",
    labelNames: ["type"],
    registers: [this.registry],
  });

  readonly drawActionsCounter = new client.Counter({
    name: "draw_actions_total",
    help: "Total area create/update/delete actions",
    labelNames: ["action"],
    registers: [this.registry],
  });

  readonly wsBackpressureCounter = new client.Counter({
    name: "ws_backpressure_events_total",
    help: "WebSocket backpressure events: droppable messages skipped or backlogged clients disconnected",
    labelNames: ["action"],
    registers: [this.registry],
  });

  readonly auditFallbackCounter = new client.Counter({
    name: "audit_fallback_events_total",
    help: "Audit records routed to structured logs instead of PostgreSQL",
    labelNames: ["reason"],
    registers: [this.registry],
  });

  constructor() {
    client.collectDefaultMetrics({ register: this.registry });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
