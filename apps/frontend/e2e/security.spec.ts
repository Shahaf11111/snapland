import { test, expect } from "@playwright/test";

const API = "http://localhost:4124";

test("stored names remain literal text in new and updated tooltips; UI actions are reported", async ({ page, context }) => {
  await context.route(/https:\/\/.*(?:tile\.openstreetmap\.org|arcgisonline\.com).*$/, route => route.abort());
  const name = `security-${Date.now()}`;
  const registered = await page.request.post(`${API}/auth/register`, {
    data: { name, email: `${name}@example.invalid`, password: "Test-password-123" },
  });
  expect(registered.ok()).toBeTruthy();
  const session = await registered.json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const payload = '<img src=x onerror="window.__tooltipXss=1">';
  const created = await page.request.post(`${API}/areas`, {
    headers, data: { name: payload, geometry: { type: "Polygon", coordinates: [[[34.78, 32.08], [34.79, 32.08], [34.79, 32.09], [34.78, 32.09], [34.78, 32.08]]] } },
  });
  expect(created.ok()).toBeTruthy();
  const { area } = await created.json();
  // Limit rendered data to this persisted fixture, independent of other test areas.
  await page.route(/\/areas\?bbox=/, route => route.fulfill({ json: { areas: [area] } }));
  await page.addInitScript(session => localStorage.setItem("snapland.session", JSON.stringify(session)), session);
  const events: { action: string; value?: string }[] = [];
  page.on("request", req => {
    if (req.method() === "POST" && req.url().endsWith("/audit/events")) events.push(req.postDataJSON());
  });
  await page.goto("http://localhost:5174");
  await expect(page.getByRole("button", { name, exact: true })).toHaveClass(/ring-success/);
  const polygon = page.locator('.leaflet-overlay-pane path[stroke="#16a34a"]').first();
  await polygon.dispatchEvent("mouseover");
  await expect(page.locator(".leaflet-tooltip")).toContainText(payload);
  await expect(page.locator(".leaflet-tooltip img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tooltipXss?: number }).__tooltipXss)).toBeUndefined();
  const renamed = '<svg onload="window.__tooltipXss=2">';
  const updated = await page.request.put(`${API}/areas/${area.id}`, { headers, data: { version: 1, name: renamed } });
  expect(updated.ok()).toBeTruthy();
  await expect(page.locator(".leaflet-tooltip")).toContainText(renamed);
  await expect(page.locator(".leaflet-tooltip svg")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tooltipXss?: number }).__tooltipXss)).toBeUndefined();
  await page.getByRole("radio", { name: "Satellite imagery layer" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByText("Dark", { exact: true }).click();
  await expect.poll(() => events.some(e => e.action === "ui.map.layer" && e.value === "satellite")).toBe(true);
  await expect.poll(() => events.some(e => e.action === "ui.theme.change" && e.value === "dark")).toBe(true);
});
