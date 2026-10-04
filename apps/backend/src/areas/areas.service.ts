import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Area, AreaGeometry, BoundingBox } from "@snapland/shared";
import { AreasRepository, type AreaRow, type UpdateAreaPatch } from "./areas.repository";
import { AreasCache } from "./areas.cache";
import { AuditService } from "../audit/audit.service";
import { PubSubService } from "../websocket/pubsub.service";
import { MetricsService } from "../metrics/metrics.service";
import { InvalidGeometryError, validatePolygonGeometry } from "../common/utils/geo.util";

function toArea(row: AreaRow): Area {
  return {
    id: row.id,
    name: row.name,
    geometry: row.geometry,
    sizeKm2: row.size_km2,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function assertValidGeometry(geometry: AreaGeometry): void {
  try {
    validatePolygonGeometry(geometry);
  } catch (err) {
    if (err instanceof InvalidGeometryError) {
      throw new BadRequestException({ error: "invalid_geometry", message: err.message });
    }
    throw err;
  }
}

@Injectable()
export class AreasService {
  constructor(
    private readonly repo: AreasRepository,
    private readonly cache: AreasCache,
    private readonly audit: AuditService,
    private readonly pubsub: PubSubService,
    private readonly metrics: MetricsService
  ) {}

  async search(search: string, cursor: string | undefined, limit: number) {
    const page = await this.repo.search(search, cursor, limit);
    return { areas: page.rows.map(toArea), total: page.total, nextCursor: page.nextCursor };
  }

  async create(name: string, geometry: AreaGeometry, userId: string): Promise<Area> {
    assertValidGeometry(geometry);

    // Area + its "created" history row commit or roll back together — see
    // AreasRepository.createWithHistory. Everything below only runs once
    // that's durably committed.
    const row = await this.repo.createWithHistory(name, geometry, userId);
    await this.cache.invalidate();

    const area = toArea(row);
    await this.audit.record({ userId, action: "area.create", entityType: "area", entityId: area.id, metadata: { sizeKm2: area.sizeKm2 } });
    await this.pubsub.publish({ type: "area:created", payload: { area } });
    this.metrics.drawActionsCounter.inc({ action: "create" });
    return area;
  }

  async update(id: string, expectedVersion: number, patch: UpdateAreaPatch, userId: string): Promise<Area> {
    if (patch.geometry) assertValidGeometry(patch.geometry);

    const row = await this.repo.updateWithHistory(id, expectedVersion, patch, userId);
    if (!row) {
      await this.throwNotFoundOrConflict(id, expectedVersion);
    }

    await this.cache.invalidate();

    const area = toArea(row!);
    await this.audit.record({ userId, action: "area.update", entityType: "area", entityId: area.id, metadata: { version: area.version } });
    await this.pubsub.publish({ type: "area:updated", payload: { area } });
    this.metrics.drawActionsCounter.inc({ action: "update" });
    return area;
  }

  async remove(id: string, expectedVersion: number, userId: string): Promise<void> {
    const row = await this.repo.removeWithHistory(id, expectedVersion, userId);
    if (!row) {
      await this.throwNotFoundOrConflict(id, expectedVersion);
    }

    await this.cache.invalidate();

    await this.audit.record({ userId, action: "area.delete", entityType: "area", entityId: id });
    await this.pubsub.publish({ type: "area:deleted", payload: { areaId: id } });
    this.metrics.drawActionsCounter.inc({ action: "delete" });
  }

  async getInBounds(bbox: BoundingBox): Promise<Area[]> {
    const cached = await this.cache.get(bbox);
    if (cached) return cached.map(toArea);

    const rows = await this.repo.listInBounds(bbox);
    await this.cache.set(bbox, rows);
    return rows.map(toArea);
  }

  async getHistory(areaId: string) {
    const rows = await this.repo.listHistory(areaId);
    // Preserve access to the audit history after an area is soft-deleted.
    if (rows.length === 0) await this.getByIdOrThrow(areaId);
    return rows.map((row) => ({
      id: row.id,
      areaId: row.area_id,
      geometry: row.geometry,
      name: row.name,
      sizeKm2: row.size_km2,
      version: row.version,
      editedBy: row.edited_by,
      editorName: row.editor_name,
      editedAt: row.edited_at,
      changeType: row.change_type,
    }));
  }

  async getByIdOrThrow(id: string): Promise<Area> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException({ error: "not_found", message: `Area ${id} not found` });
    return toArea(row);
  }

  private async throwNotFoundOrConflict(id: string, expectedVersion: number): Promise<never> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundException({ error: "not_found", message: `Area ${id} not found` });
    }
    throw new ConflictException({
      error: "conflict",
      message: `Version mismatch: expected ${expectedVersion}, area is currently at version ${existing.version}`,
    });
  }
}
