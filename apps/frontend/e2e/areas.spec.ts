import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const API = "http://localhost:4124";
const APP = "http://localhost:5174";
const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const transparentTile = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

async function tiles(context: BrowserContext) {
  // Only third-party raster images are stubbed. Leaflet, HTTP, DB and WebSockets are real.
  await context.route(/https:\/\/.*(?:tile\.openstreetmap\.org|arcgisonline\.com).*$/, route =>
    route.fulfill({ contentType: "image/png", body: transparentTile }));
}

async function signIn(page: Page, name: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name, email: `${unique()}@example.invalid`, password: "Browser-test-password1" },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  await page.addInitScript((session) => localStorage.setItem("snapland.session", JSON.stringify(session)), session);
  await page.goto(APP);
  await expect(page.getByRole("button", { name: "Add area", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name, exact: true })).toHaveClass(/ring-success/);
  return session;
}

async function draw(page: Page) {
  await page.getByRole("button", { name: "Add area", exact: true }).click();
  for (const [x, y] of [[520, 300], [700, 300], [700, 480], [520, 480]]) await page.mouse.click(x, y);
  await expect(page.locator(".draw-vertex")).toHaveCount(4);
}
async function finish(page: Page, name?: string) {
  await page.getByRole("button", { name: "Finish drawing", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (name) await dialog.getByRole("textbox", { name: "Area name" }).fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function action(page: Page, name: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test.beforeEach(async ({ context }) => { await tiles(context); });

test("register, reload, logout and login through the browser", async ({ page }) => {
  const name = unique(), email = `${name}@example.invalid`;
  await page.goto(APP);
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Browser-test-password1");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add area", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Browser-test-password1");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add area", exact: true })).toBeVisible();
});

test("invalid draft remains editable; basemap switching and whole-shape dragging preserve it", async ({ page }) => {
  const session = await signIn(page, unique());
  const invalid = await page.request.post(`${API}/areas`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: { name: unique(), geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] } },
  });
  expect(invalid.status()).toBe(400);
  await page.getByRole("button", { name: "Add area", exact: true }).click();
  for (const [x, y] of [[500, 320], [600, 320], [700, 320]]) await page.mouse.click(x, y);
  await page.getByRole("button", { name: "Finish drawing", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/overlapping|non-zero/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.mouse.move(600, 320); await page.mouse.down(); await page.mouse.move(600, 440, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page.getByRole("radio", { name: "Satellite imagery layer" }).click();
  await expect(page.locator(".map-container")).toHaveAttribute("data-base-layer", "satellite");
  await expect(page.locator(".draw-vertex")).toHaveCount(3);
  await page.getByRole("radio", { name: "OpenStreetMap layer" }).click();
  const before = await page.locator(".draw-vertex").first().boundingBox();
  await page.mouse.move(600, 360); await page.mouse.down(); await page.mouse.move(630, 390, { steps: 8 }); await page.mouse.up();
  const after = await page.locator(".draw-vertex").first().boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(30, 0);
  expect(after!.y - before!.y).toBeCloseTo(30, 0);
  await finish(page, unique());
});

test("two users share previews, edits, conflicts, history and confirmed deletion", async ({ browser, page }) => {
  const name = unique(), renamed = `${name}-updated`;
  const actor = await signIn(page, `${name}-Alice`);
  const second = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await tiles(second);
  const bob = await second.newPage();
  try {
    await signIn(bob, `${name}-Bob`);
    await bob.getByRole("searchbox").fill(name);
    await page.getByRole("searchbox").fill(name);
    await draw(page);
    await expect(bob.locator('path[stroke="#f97316"]')).toHaveCount(1);
    await finish(page, name);
    await expect(bob.locator('path[stroke="#f97316"]')).toHaveCount(0);
    await expect(bob.getByRole("button", { name: `Actions for ${name}`, exact: true })).toBeVisible();
    await action(page, name, "Edit");
    await expect(bob.getByText(`Editing: ${name}-Alice`)).toBeVisible();
    await action(bob, name, "Edit");
    await finish(page, renamed);
    await bob.getByRole("button", { name: "Finish drawing", exact: true }).click();
    await bob.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(bob.getByRole("button", { name: "Reload latest version" })).toBeVisible();
    await bob.getByRole("button", { name: "Reload latest version" }).click();
    await expect(bob.getByRole("heading", { name: `Editing ${renamed}` })).toBeVisible();
    await bob.getByRole("button", { name: "Cancel drawing", exact: true }).click();
    const historyRoute = /\/areas\/[^/]+\/history$/;
    await page.route(historyRoute, route => route.fulfill({ status: 503, json: { message: "Temporary history outage" } }));
    await action(page, renamed, "History");
    const history = page.getByRole("dialog");
    await expect(history.getByRole("alert")).toContainText("Temporary history outage");
    await page.unroute(historyRoute);
    await history.getByRole("button", { name: "Retry" }).click();
    await expect(history.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(history.getByText("Version 1", { exact: true })).toBeVisible();
    await expect(history.getByText(name, { exact: true })).toBeVisible();
    await history.getByText("View saved shape", { exact: true }).first().click();
    await expect(history.getByRole("img", { name: "Shape at version 2" })).toBeVisible();
    await history.getByRole("button", { name: "Close", exact: true }).click();
    const found = await page.request.get(`${API}/areas/search?search=${name}`, { headers: { Authorization: `Bearer ${actor.accessToken}` } });
    const area = (await found.json()).areas[0];
    await action(page, renamed, "Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(bob.getByRole("button", { name: `Actions for ${renamed}`, exact: true })).toBeVisible();
    await action(page, renamed, "Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(bob.getByRole("button", { name: `Actions for ${renamed}`, exact: true })).toHaveCount(0);
    const response = await page.request.get(`${API}/areas/${area.id}/history`, { headers: { Authorization: `Bearer ${actor.accessToken}` } });
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).history.map((h: { changeType: string }) => h.changeType)).toEqual(["created", "updated", "deleted"]);
  } finally { await second.close(); }
});

test("narrow-screen panel controls, search and drawing remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, unique());
  await page.getByRole("button", { name: "Move panel to the left" }).click();
  await page.getByRole("searchbox").fill("unlikely-no-match");
  await expect(page.getByText("No areas match your search.")).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: /^Areas/ }).click();
  await page.getByRole("button", { name: "Add area", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel drawing", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Cancel drawing", exact: true }).click();
});

test("server search reaches unloaded results and scrolling loads the next virtualized page", async ({ page }) => {
  const prefix = unique();
  const names: string[] = [];
  for (let batch = 0; batch < 3; batch++) {
    const response = await page.request.post(`${API}/auth/register`, {
      data: { name: `${prefix}-${batch}`, email: `${unique()}@example.invalid`, password: "Browser-test-password1" },
    });
    const session = await response.json();
    for (let i = 0; i < 35; i++) {
      const name = `${prefix}-${String(batch * 35 + i).padStart(3, "0")}`;
      names.push(name);
      const created = await page.request.post(`${API}/areas`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        data: { name, geometry: { type: "Polygon", coordinates: [[[34.78, 32.08], [34.781, 32.08], [34.781, 32.081], [34.78, 32.08]]] } },
      });
      expect(created.ok()).toBeTruthy();
    }
  }
  const actor = await signIn(page, unique());
  const initial = await page.request.get(`${API}/areas/search?search=${prefix}`, { headers: { Authorization: `Bearer ${actor.accessToken}` } });
  const firstPage = await initial.json();
  expect(firstPage.total).toBe(105);
  expect(firstPage.areas).toHaveLength(100);
  const unloaded = names.find(name => !firstPage.areas.some((area: { name: string }) => area.name === name))!;
  await page.getByRole("searchbox").fill(prefix);
  const list = page.getByRole("region", { name: "Areas list" });
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "105");
  expect(await list.getByRole("listitem").count()).toBeLessThan(30);
  const nextPage = page.waitForResponse(response => response.url().includes("/areas/search?") && response.url().includes("cursor="));
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect((await (await nextPage).json()).areas).toHaveLength(5);
  expect(await list.getByRole("listitem").count()).toBeLessThan(30);
  await page.getByRole("searchbox").fill(unloaded);
  await expect(page.getByRole("button", { name: `Actions for ${unloaded}`, exact: true })).toBeVisible();
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "1");
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
});

test("reconnect refreshes missed saved changes without discarding the active draft", async ({ page, context }) => {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { browserTestSockets: sockets });
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); }
    };
  });
  const prefix = unique();
  const actor = await signIn(page, prefix);
  await page.getByRole("searchbox").fill(prefix);
  await draw(page);
  await context.setOffline(true);
  await page.evaluate(() => {
    const sockets = (window as unknown as { browserTestSockets: WebSocket[] }).browserTestSockets;
    sockets.forEach(socket => socket.close());
  });
  await expect(page.getByRole("button", { name: prefix, exact: true })).not.toHaveClass(/ring-success/);
  // APIRequestContext is outside the browser's offline emulation, like another client.
  const result = await page.request.post(`${API}/areas`, {
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    data: { name: prefix, geometry: { type: "Polygon", coordinates: [[[34.78, 32.08], [34.781, 32.08], [34.781, 32.081], [34.78, 32.08]]] } },
  });
  expect(result.ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: prefix, exact: true })).toHaveClass(/ring-success/, { timeout: 20000 });
  await expect(page.getByRole("button", { name: `Actions for ${prefix}`, exact: true })).toBeVisible();
  await expect(page.locator(".draw-vertex")).toHaveCount(4);
  await page.getByRole("button", { name: "Cancel drawing", exact: true }).click();
});
