import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../src/database/transaction.util";

function makeClient(query: ReturnType<typeof vi.fn>) {
  return { query, release: vi.fn() };
}

function makePool(client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) {
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

describe("withTransaction", () => {
  it("runs fn between BEGIN and COMMIT, then releases the connection", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = makeClient(query);
    const pool = makePool(client);
    const fn = vi.fn(async (c: PoolClient) => {
      await c.query("INSERT INTO areas ...");
      return "result";
    });

    const result = await withTransaction(pool, fn);

    expect(result).toBe("result");
    expect(query.mock.calls.map(([text]) => text)).toEqual(["BEGIN", "INSERT INTO areas ...", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases, then rethrows, when fn throws", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = makeClient(query);
    const pool = makePool(client);
    const error = new Error("history insert failed");
    const fn = vi.fn(async () => { throw error; });

    await expect(withTransaction(pool, fn)).rejects.toBe(error);

    expect(query.mock.calls.map(([text]) => text)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("still releases and surfaces the original error if ROLLBACK itself fails", async () => {
    const query = vi.fn((text: string) => {
      if (text === "ROLLBACK") return Promise.reject(new Error("connection already closed"));
      return Promise.resolve({ rows: [] });
    });
    const client = makeClient(query);
    const pool = makePool(client);
    const original = new Error("original failure");
    const fn = vi.fn(async () => { throw original; });

    await expect(withTransaction(pool, fn)).rejects.toBe(original);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
