import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { Pool } from "pg";
import { AreasRepository } from "../src/areas/areas.repository";
import { SearchAreasQueryDto } from "../src/areas/dto/search-areas-query.dto";

describe("area search pagination", () => {
  it("fetches a lookahead row and produces the cursor from the last returned row", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total: 3, items: [{ id: "a" }, { id: "b" }, { id: "c" }] }] });
    const repo = new AreasRepository({ query } as unknown as Pool);
    expect(await repo.search("  50%_\\  ", undefined, 2)).toEqual({
      rows: [{ id: "a" }, { id: "b" }], total: 3, nextCursor: "b",
    });
    expect(query.mock.calls[0][1]).toEqual(["%50\\%\\_\\\\%", null, 3]);
  });

  it("returns no next cursor on the final page and preserves total on empty pages", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total: 3, items: [] }] });
    const repo = new AreasRepository({ query } as unknown as Pool);
    expect(await repo.search("field", "00000000-0000-4000-8000-000000000001", 100))
      .toEqual({ rows: [], total: 3, nextCursor: null });
  });

  it("validates cursor and page-size bounds", async () => {
    const valid = plainToInstance(SearchAreasQueryDto, { search: "field", limit: "100" });
    expect(await validate(valid)).toEqual([]);
    expect(valid.limit).toBe(100);
    expect(await validate(plainToInstance(SearchAreasQueryDto, { cursor: "01234567-89ab-cdef-0123-456789abcdef" }))).toEqual([]);
    for (const limit of ["0", "201", "1.5", "nope"]) {
      expect((await validate(plainToInstance(SearchAreasQueryDto, { limit }))).length).toBeGreaterThan(0);
    }
    expect((await validate(plainToInstance(SearchAreasQueryDto, { cursor: "invalid" }))).length).toBeGreaterThan(0);
  });
});
