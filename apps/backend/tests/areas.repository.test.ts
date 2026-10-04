import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AreaGeometry } from "@snapland/shared";
import { AreasRepository } from "../src/areas/areas.repository";

const GEOMETRY: AreaGeometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const AREA_ROW = {
  id: "area-1", name: "Test Area", geometry: GEOMETRY,
  size_km2: 1, version: 1, created_by: "user-1", created_at: "t0", updated_at: "t0", deleted_at: null,
};
const UPDATED_ROW = { ...AREA_ROW, name: "Renamed", version: 2 };

/** Fake client whose `query` is scripted per statement prefix, with an
 *  optional forced failure on the statement containing `failOn`. Lets each
 *  test assert the exact BEGIN/.../COMMIT|ROLLBACK sequence that ran. */
function makeClient(options: { failOn?: string; updateMatches?: boolean } = {}) {
  const calls: string[] = [];
  const query = vi.fn(async (text: string) => {
    const statement = text.trim();
    calls.push(statement);
    if (options.failOn && statement.startsWith(options.failOn)) {
      throw new Error(`forced failure: ${options.failOn}`);
    }
    if (statement.startsWith("INSERT INTO areas")) return { rows: [AREA_ROW] };
    if (statement.startsWith("UPDATE areas SET deleted_at")) {
      return { rows: options.updateMatches === false ? [] : [{ ...AREA_ROW, deleted_at: "t1", version: 2 }] };
    }
    if (statement.startsWith("UPDATE areas SET")) {
      return { rows: options.updateMatches === false ? [] : [UPDATED_ROW] };
    }
    return { rows: [] }; // BEGIN, COMMIT, ROLLBACK, INSERT INTO area_history
  });
  return { query, release: vi.fn(), calls };
}

function makeRepo(client: ReturnType<typeof makeClient>) {
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return new AreasRepository(pool);
}

describe("AreasRepository transactional writes", () => {
  it("createWithHistory: commits the area insert and its history row together", async () => {
    const client = makeClient();
    const repo = makeRepo(client);

    const row = await repo.createWithHistory("Test Area", GEOMETRY, "user-1");

    expect(row).toEqual(AREA_ROW);
    expect(client.calls).toEqual(["BEGIN", expect.stringContaining("INSERT INTO areas"), expect.stringContaining("INSERT INTO area_history"), "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("createWithHistory: rolls back the area insert when the history write fails", async () => {
    const client = makeClient({ failOn: "INSERT INTO area_history" });
    const repo = makeRepo(client);

    await expect(repo.createWithHistory("Test Area", GEOMETRY, "user-1")).rejects.toThrow("forced failure");

    // The area INSERT ran (and would have "succeeded" on its own), but the
    // transaction was rolled back instead of committed — so in a real
    // database the newly created area does not remain.
    expect(client.calls).toEqual(["BEGIN", expect.stringContaining("INSERT INTO areas"), expect.stringContaining("INSERT INTO area_history"), "ROLLBACK"]);
    expect(client.calls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("updateWithHistory: rolls back the version-checked update when the history write fails", async () => {
    const client = makeClient({ failOn: "INSERT INTO area_history" });
    const repo = makeRepo(client);

    await expect(repo.updateWithHistory("area-1", 1, { name: "Renamed" }, "user-1")).rejects.toThrow("forced failure");

    // In a real database the row's name/geometry/version are unchanged —
    // the UPDATE ran inside the same rolled-back transaction.
    expect(client.calls).toEqual(["BEGIN", expect.stringContaining("UPDATE areas SET"), expect.stringContaining("INSERT INTO area_history"), "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("updateWithHistory: a version mismatch commits an empty transaction without writing history", async () => {
    const client = makeClient({ updateMatches: false });
    const repo = makeRepo(client);

    const row = await repo.updateWithHistory("area-1", 1, { name: "Renamed" }, "user-1");

    expect(row).toBeNull();
    expect(client.calls).toEqual(["BEGIN", expect.stringContaining("UPDATE areas SET"), "COMMIT"]);
    expect(client.calls.some((c) => c.includes("area_history"))).toBe(false);
  });

  it("removeWithHistory: rolls back the soft delete when the history write fails, leaving the area visible", async () => {
    const client = makeClient({ failOn: "INSERT INTO area_history" });
    const repo = makeRepo(client);

    await expect(repo.removeWithHistory("area-1", 1, "user-1")).rejects.toThrow("forced failure");

    // deleted_at was set by the UPDATE inside the transaction, but the
    // rollback means it was never committed — the area stays visible.
    expect(client.calls).toEqual(["BEGIN", expect.stringContaining("UPDATE areas SET deleted_at"), expect.stringContaining("INSERT INTO area_history"), "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("removeWithHistory: commits the soft delete and its history row together on success", async () => {
    const client = makeClient();
    const repo = makeRepo(client);

    const row = await repo.removeWithHistory("area-1", 1, "user-1");

    expect(row?.deleted_at).not.toBeNull();
    expect(client.calls).toEqual(["BEGIN", expect.stringContaining("UPDATE areas SET deleted_at"), expect.stringContaining("INSERT INTO area_history"), "COMMIT"]);
  });
});
