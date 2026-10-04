import { randomUUID } from "node:crypto";
import { MetricsService } from "../metrics/metrics.service";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.constants";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  private inFlight = 0;
  private readonly maxInFlight = 8;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly metrics: MetricsService,
  ) {}

  /** Bounded DB writes; failed/overloaded records go to structured server logs.
   * This is not a durable queue. Preserve logs externally for outage recovery. */
  async record(entry: AuditEntry): Promise<void> {
    const allowed = new Set([
      "source", "value", "sizeKm2", "version", "requestId", "route", "method", "statusCode", "outcome",
      "durationMs", "connectionId", "messageType", "pointCount", "bytes", "reason", "closeCode",
    ]);
    const metadata: Record<string, unknown> = { eventId: randomUUID(), occurredAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(entry.metadata ?? {})) {
      if (!allowed.has(key)) continue;
      if (typeof value === "string") metadata[key] = value.slice(0, 256);
      else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) metadata[key] = value;
    }
    const safeEntry = { userId: entry.userId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, metadata };
    const fallback = (reason: "database_error" | "capacity") => {
      this.metrics.auditFallbackCounter.inc({ reason });
      this.logger.error(JSON.stringify({ event: "audit.fallback", reason, ...safeEntry }));
    };
    if (this.inFlight >= this.maxInFlight) { fallback("capacity"); return; }
    this.inFlight++;
    try {
      await this.pool.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)`,
        [safeEntry.userId, safeEntry.action, safeEntry.entityType, safeEntry.entityId, JSON.stringify(metadata)]
      );
    } catch {
      fallback("database_error");
    } finally {
      this.inFlight--;
    }
  }
}
