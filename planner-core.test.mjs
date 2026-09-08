import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPlan, holidayDefinitions, configuredHolidays, calendarEntries, enabledHolidayMap,
  observedDateFor, observanceConflict, suggestObservedDate, normalizePlan, isEligible, sanitizePto,
  commonClosureShortcuts
} from "./planner-core.mjs";

test("preset holidays are logical records with actual and observed dates", () => {
  const definition = holidayDefinitions(2027).find(holiday => holiday.id === "christmas");
  const configured = configuredHolidays(defaultPlan(2027)).find(holiday => holiday.id === "christmas");
  assert.equal(definition.actualDate, "2027-12-25");
  assert.equal(definition.source, "preset");
  assert.equal(configured.observanceRule, "nearest_weekday");
  assert.equal(configured.observedDate, "2027-12-24");
});

test("each observance rule calculates the expected workday", () => {
  assert.equal(observedDateFor("2027-12-25", "none"), null);
  assert.equal(observedDateFor("2027-12-25", "previous_weekday"), "2027-12-24");
  assert.equal(observedDateFor("2027-12-25", "next_weekday"), "2027-12-27");
  assert.equal(observedDateFor("2027-12-25", "nearest_weekday"), "2027-12-24");
  assert.equal(observedDateFor("2027-12-25", "custom", "2027-12-28"), "2027-12-28");
  assert.equal(observedDateFor("2027-12-23", "nearest_weekday"), "2027-12-23");
});

test("preset observance can be disabled or customized without recreating a holiday", () => {
  const plan = defaultPlan(2027);
  plan.holidaySettings.christmas = { enabled: true, observanceRule: "custom", customObservedDate: "2027-12-27" };
  let entries = calendarEntries(plan).filter(entry => entry.id.startsWith("christmas"));
  assert.deepEqual(entries.map(entry => entry.date), ["2027-12-25", "2027-12-27"]);
  plan.holidaySettings.christmas.observanceRule = "none";
  entries = calendarEntries(plan).filter(entry => entry.id.startsWith("christmas"));
  assert.deepEqual(entries.map(entry => entry.date), ["2027-12-25"]);
});

test("company closures remain separate and block PTO", () => {
  const plan = defaultPlan(2027);
  plan.companyClosures.push({ id: "eve", name: "Christmas Eve", date: "2027-12-24", enabled: true, source: "custom_closure" });
  const entries = enabledHolidayMap(plan).get("2027-12-24");
  assert.ok(entries.some(entry => entry.kind === "closure"));
  assert.ok(entries.some(entry => entry.kind === "observed"));
  assert.equal(isEligible(plan, "2027-12-24"), false);
  plan.companyClosures[0].enabled = false;
  plan.holidaySettings.christmas = { observanceRule: "next_weekday" };
  assert.equal(isEligible(plan, "2027-12-24"), true);
});

test("observance conflicts suggest the next unused weekday but are not applied", () => {
  const plan = defaultPlan(2027);
  plan.companyClosures.push({ id: "eve", name: "Christmas Eve", date: "2027-12-24", enabled: true, source: "custom_closure" });
  const conflict = observanceConflict(plan, "christmas");
  assert.equal(conflict.with.name, "Christmas Eve");
  assert.equal(conflict.suggestion, "2027-12-27");
  assert.equal(configuredHolidays(plan).find(holiday => holiday.id === "christmas").observedDate, "2027-12-24");
  assert.equal(suggestObservedDate(plan, "christmas", "2027-12-24"), "2027-12-27");
});

test("custom holidays use the same actual and observed date model", () => {
  const plan = defaultPlan(2027);
  plan.customHolidays.push({ id: "founders", name: "Founder's Day", actualDate: "2027-08-07", enabled: true, observanceRule: "next_weekday", source: "custom" });
  const entries = calendarEntries(plan).filter(entry => entry.id.startsWith("founders"));
  assert.deepEqual(entries.map(entry => [entry.kind, entry.date]), [["actual", "2027-08-07"], ["observed", "2027-08-09"]]);
});

test("legacy plans migrate enablement and preserve ambiguous custom dates", () => {
  const migrated = normalizePlan({
    ...defaultPlan(2027), holidayEnabled: { christmas: true, "christmas-observed": false },
    customHolidays: [{ name: "Legacy day", date: "2027-06-02" }]
  });
  assert.equal(migrated.holidaySettings.christmas.observanceRule, "none");
  assert.equal(migrated.customHolidays[0].actualDate, "2027-06-02");
  assert.equal(migrated.customHolidays[0].source, "custom");
  assert.equal("holidayEnabled" in migrated, false);
});

test("normalization preserves persisted closure shortcut and conflict choices", () => {
  const plan = defaultPlan(2027);
  plan.companyClosures.push({ id: "shortcut-christmas-eve", name: "Christmas Eve", date: "2027-12-24", enabled: true, source: "preset_closure", shortcut: "christmas-eve" });
  plan.customHolidays.push({ id: "custom-day", name: "Custom day", actualDate: "2027-12-24", enabled: true, observanceRule: "custom", customObservedDate: "2027-12-24", allowedConflictDate: "2027-12-24", source: "custom" });
  const normalized = normalizePlan(plan);
  assert.equal(normalized.companyClosures[0].shortcut, "christmas-eve");
  assert.equal(normalized.customHolidays[0].allowedConflictDate, "2027-12-24");
});

test("common closure shortcuts produce year-specific workplace dates", () => {
  const shortcuts = commonClosureShortcuts(2027);
  assert.deepEqual(shortcuts.find(item => item.key === "christmas-eve").date, "2027-12-24");
  assert.deepEqual(shortcuts.find(item => item.key === "day-after-thanksgiving").date, "2027-11-26");
});

test("weekends and all enabled calendar entry types are ineligible", () => {
  const plan = defaultPlan(2027);
  plan.holidaySettings.independence = { observanceRule: "next_weekday" };
  assert.equal(isEligible(plan, "2027-07-03"), false);
  assert.equal(isEligible(plan, "2027-07-04"), false);
  assert.equal(isEligible(plan, "2027-07-05"), false);
  assert.equal(isEligible(plan, "2027-07-06"), true);
});

test("sanitizing PTO removes duplicate and newly invalid selections", () => {
  const plan = defaultPlan(2027);
  plan.pto = ["2027-07-06", "2027-07-06", "2027-07-05", "2026-01-02"];
  assert.deepEqual(sanitizePto(plan), ["2027-07-06"]);
});
