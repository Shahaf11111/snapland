import "reflect-metadata";
import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "../src/audit/audit.service";
import { AuditMiddleware } from "../src/audit/audit.middleware";

const entry = { userId: "00000000-0000-0000-0000-000000000001", action: "ws.message", entityType: "connection" };
afterEach(() => vi.restoreAllMocks());

describe("audit persistence and fallback", () => {
  it("persists allowlisted metadata and excludes secrets and raw payloads", async () => {
    const pool = { query: vi.fn().mockResolvedValue({}) };
    const audit = new AuditService(pool as never, { auditFallbackCounter: { inc: vi.fn() } } as never);
    await audit.record({ ...entry, metadata: { outcome: "success", pointCount: 3, password: "secret", token: "secret", points: [[1, 2]] } });
    const metadata = JSON.parse(pool.query.mock.calls[0][1][4]);
    expect(metadata).toMatchObject({ outcome: "success", pointCount: 3, eventId: expect.any(String), occurredAt: expect.any(String) });
    expect(JSON.stringify(metadata)).not.toContain("secret");
    expect(metadata.points).toBeUndefined();
  });

  it("writes the sanitized record to structured logs and counts database failures", async () => {
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const inc = vi.fn();
    const audit = new AuditService({ query: vi.fn().mockRejectedValue(new Error("private SQL details")) } as never, { auditFallbackCounter: { inc } } as never);
    await expect(audit.record(entry)).resolves.toBeUndefined();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ event: "audit.fallback", reason: "database_error", ...entry });
    expect(inc).toHaveBeenCalledWith({ reason: "database_error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL details");
  });

  it("bounds pending database writes and logs overflow without queuing it in memory", async () => {
    const finish: (() => void)[] = [];
    const query = vi.fn(() => new Promise<void>(resolve => finish.push(resolve)));
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const audit = new AuditService({ query } as never, { auditFallbackCounter: { inc: vi.fn() } } as never);
    const writes = Array.from({ length: 9 }, () => audit.record(entry));
    expect(query).toHaveBeenCalledTimes(8);
    expect(JSON.parse(log.mock.calls[0][0] as string).reason).toBe("capacity");
    finish.forEach(resolve => resolve());
    await Promise.all(writes);
  });
});

describe("request auditing", () => {
  it.each([200, 400, 401, 409, 429, 500])("records response %s once, without sensitive request content", statusCode => {
    const record = vi.fn().mockResolvedValue(undefined);
    const req = { path: "/areas/bad", method: "GET", params: { id: "bad" }, query: { token: "secret" }, headers: { authorization: "secret" }, body: { password: "secret" }, route: { path: "/areas/:id" } };
    const res = Object.assign(new EventEmitter(), { statusCode, locals: {}, writableFinished: true, setHeader: vi.fn() });
    new AuditMiddleware({ record } as never).use(req as never, res as never, vi.fn());
    res.emit("finish"); res.emit("close");
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ userId: null, entityId: null, metadata: { route: "/areas/:id", statusCode, outcome: statusCode < 400 ? "success" : "rejected" } });
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret");
  });

  it("records aborted requests with the authenticated actor", () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const req = { path: "/areas", method: "GET", user: { id: entry.userId } };
    const res = Object.assign(new EventEmitter(), { statusCode: 200, locals: {}, writableFinished: false, setHeader: vi.fn() });
    new AuditMiddleware({ record } as never).use(req as never, res as never, vi.fn());
    res.emit("close");
    expect(record.mock.calls[0][0]).toMatchObject({ userId: entry.userId, metadata: { outcome: "aborted", statusCode: null, route: "unmatched" } });
  });
});
