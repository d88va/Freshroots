import { describe, expect, it } from "vitest";
import { parseProjectValue, validateProject } from "./settings";

const current = { project_start_date: "2026-05-26", go_live_date: "2026-07-20", k3_override_pct: 30, k3_amber_pct: 20, k1_day: 30 };
describe("validateProject", () => {
  it("accepts good changes", () => expect(validateProject(current, { k1_day: 45, k3_amber_pct: 25 })).toEqual([]));
  it("rejects bad dates, numbers and unknown settings", () => {
    expect(validateProject(current, { project_start_date: "26/05/2026" }).length).toBe(1);
    expect(validateProject(current, { project_start_date: "2026-02-30" }).length).toBe(1);
    expect(validateProject(current, { k1_day: 0 }).length).toBe(1);
    expect(validateProject(current, { k3_override_pct: 140 }).length).toBe(1);
    expect(validateProject(current, { colour: 1 }).length).toBe(1);
  });
  it("allows go-live to be empty", () => expect(validateProject(current, { go_live_date: null })).toEqual([]));
  it("keeps go-live from being before the project start", () => expect(validateProject(current, { go_live_date: "2026-05-01" })[0]).toMatch(/before the project start/));
  it("keeps the amber level below the pause line", () => expect(validateProject(current, { k3_amber_pct: 30 })[0]).toMatch(/amber level/));
  it("refuses an empty change", () => expect(validateProject(current, {})).toEqual(["Nothing to change."]));
});
describe("parseProjectValue", () => {
  it("reads what the form sends", () => {
    expect(parseProjectValue("k1_day", "45")).toBe(45);
    expect(parseProjectValue("go_live_date", "")).toBeNull();
    expect(parseProjectValue("go_live_date", "2026-07-20")).toBe("2026-07-20");
    expect(parseProjectValue("k1_export_automated", "true")).toBe(true);
    expect(parseProjectValue("k1_export_automated", "false")).toBe(false);
    expect(Number.isNaN(parseProjectValue("k1_day", ""))).toBe(true);
  });
});
