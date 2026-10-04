import type { Pool, PoolClient } from "pg";

/**
 * Runs `fn` on a single dedicated connection inside one transaction: BEGIN,
 * then `fn`, then COMMIT on success or ROLLBACK if `fn` throws. The
 * connection is always released back to the pool. A failed ROLLBACK (e.g.
 * the connection already dropped) is swallowed so it doesn't mask the
 * original error that triggered it.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
