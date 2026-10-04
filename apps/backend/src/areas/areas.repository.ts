import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { AreaGeometry, BoundingBox } from "@snapland/shared";
import { PG_POOL } from "../database/database.constants";
import { withTransaction } from "../database/transaction.util";
import { geometryToWkt } from "../common/utils/geo.util";

export interface AreaRow {
  id: string;
  name: string;
  geometry: AreaGeometry;
  size_km2: number;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AreaHistoryRow {
  id: string;
  area_id: string;
  geometry: AreaGeometry;
  name: string;
  size_km2: number;
  version: number;
  edited_by: string;
  editor_name: string;
  edited_at: string;
  change_type: "created" | "updated" | "deleted";
}

export interface UpdateAreaPatch {
  name?: string;
  geometry?: AreaGeometry;
}

/** Either a pool or a connection checked out of one — both expose the same
 *  `.query()` shape, which is all the private helpers below need. Public
 *  methods that must be atomic pass a transaction's client through; the
 *  read-only methods just use the pool directly. */
type Executor = Pick<Pool, "query">;

const SELECT_COLUMNS = `
  id, name,
  ST_AsGeoJSON(geom::geometry)::json AS geometry,
  size_km2, version, created_by, created_at, updated_at, deleted_at
`;

@Injectable()
export class AreasRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Creates the area and its "created" history row in one transaction —
   *  either both are written or neither is. */
  async createWithHistory(name: string, geometry: AreaGeometry, userId: string): Promise<AreaRow> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.insertArea(client, name, geometry, userId);
      await this.insertHistoryRow(client, row, userId, "created");
      return row;
    });
  }

  /**
   * Optimistic-concurrency update plus its "updated" history row, in one
   * transaction. Returns null if the row doesn't exist, is already deleted,
   * or `expectedVersion` didn't match — the caller distinguishes those via
   * `findById`. A version mismatch commits an empty transaction (nothing
   * was written), which is harmless.
   */
  async updateWithHistory(id: string, expectedVersion: number, patch: UpdateAreaPatch, userId: string): Promise<AreaRow | null> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.updateAreaWithVersion(client, id, expectedVersion, patch);
      if (!row) return null;
      await this.insertHistoryRow(client, row, userId, "updated");
      return row;
    });
  }

  /** Soft-delete plus its "deleted" history row, in one transaction. Same
   *  null-on-mismatch contract as `updateWithHistory`. */
  async removeWithHistory(id: string, expectedVersion: number, userId: string): Promise<AreaRow | null> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.softDeleteArea(client, id, expectedVersion);
      if (!row) return null;
      await this.insertHistoryRow(client, row, userId, "deleted");
      return row;
    });
  }

  async findById(id: string): Promise<AreaRow | null> {
    const { rows } = await this.pool.query<AreaRow>(
      `SELECT ${SELECT_COLUMNS} FROM areas WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ?? null;
  }

  async listInBounds(bbox: BoundingBox, limit = Number(process.env.AREAS_QUERY_LIMIT ?? 1000)): Promise<AreaRow[]> {
    const { rows } = await this.pool.query<AreaRow>(
      `SELECT ${SELECT_COLUMNS} FROM areas
       WHERE deleted_at IS NULL
         AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
       ORDER BY created_at DESC
       LIMIT $5`,
      [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, limit]
    );
    return rows;
  }

  async search(search: string, cursor: string | undefined, limit: number) {
    // Treat wildcard characters as literal name text. UUID order is immutable,
    // so equal timestamps and renamed/deleted cursor rows do not break paging.
    const pattern = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const { rows } = await this.pool.query<{ total: number; items: AreaRow[] }>(
      `SELECT
        (SELECT count(*)::int FROM areas WHERE deleted_at IS NULL AND name ILIKE $1) AS total,
        COALESCE((SELECT json_agg(page ORDER BY page.id) FROM (
          SELECT ${SELECT_COLUMNS} FROM areas
          WHERE deleted_at IS NULL AND name ILIKE $1
            AND ($2::uuid IS NULL OR id > $2::uuid)
          ORDER BY id ASC LIMIT $3
        ) page), '[]'::json) AS items`,
      [pattern, cursor ?? null, limit + 1]
    );
    const items = rows[0].items;
    const page = items.slice(0, limit);
    return {
      rows: page,
      total: rows[0].total,
      nextCursor: items.length > limit ? page[page.length - 1].id : null,
    };
  }

  async listHistory(areaId: string): Promise<AreaHistoryRow[]> {
    const { rows } = await this.pool.query<AreaHistoryRow>(
      `SELECT h.id, h.area_id, ST_AsGeoJSON(h.geom::geometry)::json AS geometry,
         h.name, h.size_km2, h.version, h.edited_by, h.edited_at, h.change_type,
         u.name AS editor_name
       FROM area_history h JOIN users u ON u.id = h.edited_by
       WHERE h.area_id = $1 ORDER BY h.version ASC`,
      [areaId]
    );
    return rows;
  }

  private async insertArea(executor: Executor, name: string, geometry: AreaGeometry, userId: string): Promise<AreaRow> {
    const wkt = geometryToWkt(geometry);
    const { rows } = await executor.query<AreaRow>(
      `INSERT INTO areas (name, geom, size_km2, created_by)
       VALUES ($1, ST_GeogFromText($2), ST_Area(ST_GeogFromText($2)) / 1000000.0, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [name, wkt, userId]
    );
    return rows[0];
  }

  private async updateAreaWithVersion(executor: Executor, id: string, expectedVersion: number, patch: UpdateAreaPatch): Promise<AreaRow | null> {
    // $1 = id, $2 = expectedVersion, remaining params follow.
    const setClauses: string[] = ["version = version + 1", "updated_at = now()"];
    const values: unknown[] = [id, expectedVersion];
    let paramIndex = 2;

    if (patch.name !== undefined) {
      setClauses.push(`name = $${++paramIndex}`);
      values.push(patch.name);
    }
    if (patch.geometry !== undefined) {
      const wkt = geometryToWkt(patch.geometry);
      const geomParamIndex = ++paramIndex;
      setClauses.push(`geom = ST_GeogFromText($${geomParamIndex})`);
      setClauses.push(`size_km2 = ST_Area(ST_GeogFromText($${geomParamIndex})) / 1000000.0`);
      values.push(wkt);
    }

    const query = `
      UPDATE areas SET ${setClauses.join(", ")}
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
      RETURNING ${SELECT_COLUMNS}
    `;
    const { rows } = await executor.query<AreaRow>(query, values);
    return rows[0] ?? null;
  }

  private async softDeleteArea(executor: Executor, id: string, expectedVersion: number): Promise<AreaRow | null> {
    const { rows } = await executor.query<AreaRow>(
      `UPDATE areas SET deleted_at = now(), version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [id, expectedVersion]
    );
    return rows[0] ?? null;
  }

  private async insertHistoryRow(
    executor: Executor,
    area: Pick<AreaRow, "id" | "name" | "geometry" | "size_km2" | "version">,
    editedBy: string,
    changeType: "created" | "updated" | "deleted"
  ): Promise<void> {
    const wkt = geometryToWkt(area.geometry);
    await executor.query(
      `INSERT INTO area_history (area_id, name, geom, size_km2, version, edited_by, change_type)
       VALUES ($1, $2, ST_GeogFromText($3), $4, $5, $6, $7)`,
      [area.id, area.name, wkt, area.size_km2, area.version, editedBy, changeType]
    );
  }
}
