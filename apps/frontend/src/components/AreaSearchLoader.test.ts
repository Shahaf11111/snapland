import { describe, expect, it, vi } from "vitest";
import type { Area, AreaSearchPage } from "@snapland/shared";
import { AreaSearchLoader } from "./AreaSearchLoader";

const area = (id: string) => ({ id, name: id } as Area);
const page = (ids: string[], nextCursor: string | null = null): AreaSearchPage => ({
  areas: ids.map(area), total: 300, nextCursor,
});
function deferred() {
  let resolve!: (value: AreaSearchPage) => void;
  const promise = new Promise<AreaSearchPage>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("paginated area search", () => {
  it("uses the cursor, prevents concurrent loads and deduplicates overlapping pages", async () => {
    const second = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(page(["a", "b"], "b")).mockReturnValueOnce(second.promise);
    const changed = vi.fn();
    const loader = new AreaSearchLoader(fetch, changed);
    await loader.reset("field");
    const pending = loader.loadMore();
    await loader.loadMore();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1].slice(0, 2)).toEqual(["field", "b"]);
    second.resolve(page(["b", "c"]));
    await pending;
    expect(changed.mock.lastCall?.[0].areas.map((a: Area) => a.id)).toEqual(["a", "b", "c"]);
    await loader.loadMore();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels stale searches and ignores late responses", async () => {
    const old = deferred();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(["new"]));
    const changed = vi.fn();
    const loader = new AreaSearchLoader(fetch, changed);
    const pending = loader.reset("old");
    await loader.reset("new");
    expect(fetch.mock.calls[0][2].aborted).toBe(true);
    old.resolve(page(["old"]));
    await pending;
    expect(changed.mock.lastCall?.[0].areas[0].id).toBe("new");
  });

  it("keeps loaded results on failure and retries the same cursor", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page(["a"], "a"))
      .mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(page(["b"]));
    const changed = vi.fn();
    const loader = new AreaSearchLoader(fetch, changed);
    await loader.reset("");
    await loader.loadMore();
    expect(changed.mock.lastCall?.[0]).toMatchObject({ error: "Offline", areas: [area("a")] });
    await loader.loadMore();
    expect(fetch.mock.calls[2][1]).toBe("a");
    expect(changed.mock.lastCall?.[0].areas).toEqual([area("a"), area("b")]);
  });

  it("does not notify after unmount", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    const changed = vi.fn();
    const loader = new AreaSearchLoader(fetch, changed);
    const loading = loader.reset("");
    loader.dispose();
    changed.mockClear();
    pending.resolve(page(["a"]));
    await loading;
    expect(changed).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][2].aborted).toBe(true);
  });
});
