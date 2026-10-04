import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { BboxQueryDto } from "../src/areas/dto/bbox-query.dto";
import { CreateAreaDto } from "../src/areas/dto/create-area.dto";
import { UpdateAreaDto } from "../src/areas/dto/update-area.dto";
import { UiAuditDto } from "../src/audit/ui-audit.controller";
import { AreaIdPipe } from "../src/common/pipes/area-id.pipe";

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] };

describe("REST input boundaries", () => {
  it.each([
    undefined, "", "0,0,1", "0,0,1,1,2", "0,,1,1", "0, ,1,1", "0,0,Infinity,1",
    "0,0,NaN,1", "0,0,1e999,1", "-181,0,1,1", "0,-91,1,1", "0,0,181,1",
    "0,0,1,91", "1,0,0,1", "0,1,1,0", "0x10,0,17,1", [0, 0, 1, 1, 2],
  ])("rejects malformed bbox %j", async bbox => {
    await expect(pipe.transform({ bbox }, { type: "query", metatype: BboxQueryDto })).rejects.toMatchObject({ status: 400 });
  });

  it("accepts ordered boundaries including zero, negatives and decimal exponents", async () => {
    await expect(pipe.transform({ bbox: " -180, -90, 1.8e2,90 " }, { type: "query", metatype: BboxQueryDto }))
      .resolves.toMatchObject({ bbox: [-180, -90, 180, 90] });
  });

  it.each([undefined, null, "", "   ", "nul\u0000name"])("rejects missing or empty names %j", async name => {
    await expect(pipe.transform({ name, geometry }, { type: "body", metatype: CreateAreaDto })).rejects.toMatchObject({ status: 400 });
  });

  it("trims names while retaining literal text rather than destructively stripping it", async () => {
    await expect(pipe.transform({ name: " <b>A & B</b> ", geometry }, { type: "body", metatype: CreateAreaDto }))
      .resolves.toMatchObject({ name: "<b>A & B</b>" });
  });

  it.each([{}, { geometry: null }, { geometry: "not geometry" }])("rejects absent/invalid geometry %j", async data => {
    await expect(pipe.transform({ name: "Test", ...data }, { type: "body", metatype: CreateAreaDto })).rejects.toMatchObject({ status: 400 });
  });

  it.each([{ name: null }, { geometry: null }, { version: 2147483648 }, { unexpected: true }])("rejects invalid patch %j", async data => {
    await expect(pipe.transform({ version: 1, ...data }, { type: "body", metatype: UpdateAreaDto })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects malformed path IDs before SQL and accepts deterministic UUID seed IDs", () => {
    const ids = new AreaIdPipe();
    expect(() => ids.transform("not-a-uuid")).toThrow();
    expect(ids.transform("00000000-0000-0000-0000-000000000001")).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("UI audit input", () => {
  it.each([{ action: "area.delete" }, { action: "ui.theme.change", userId: "spoofed" }, { action: "ui.theme.change", value: "secret" }, { action: "ui.area.focus", areaId: "invalid" }, { action: "ui.theme.change", value: null }])("rejects forged or unbounded metadata %j", async payload => {
    await expect(pipe.transform(payload, { type: "body", metatype: UiAuditDto })).rejects.toMatchObject({ status: 400 });
  });
  it("accepts a supported action with a bounded value", async () => {
    await expect(pipe.transform({ action: "ui.theme.change", value: "dark" }, { type: "body", metatype: UiAuditDto }))
      .resolves.toMatchObject({ action: "ui.theme.change", value: "dark" });
  });
});
