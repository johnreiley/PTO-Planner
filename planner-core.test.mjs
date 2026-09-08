import test from "node:test";
import assert from "node:assert/strict";
import { defaultPlan, holidayDefinitions, isEligible, sanitizePto } from "./planner-core.mjs";

test("weekends and enabled holidays are ineligible", () => {
  const plan=defaultPlan(2027,{allowance:20});
  assert.equal(isEligible(plan,"2027-07-03"),false);
  assert.equal(isEligible(plan,"2027-07-05"),false);
  assert.equal(isEligible(plan,"2027-07-06"),true);
});
test("US fixed weekend holidays include an observed weekday",()=>{
  const holidays=holidayDefinitions(2027);
  assert.ok(holidays.some(h=>h.id==="independence-observed"&&h.date==="2027-07-05"));
});
test("sanitizing PTO removes duplicate and newly invalid selections",()=>{
  const plan=defaultPlan(2027); plan.pto=["2027-07-06","2027-07-06","2027-07-05","2026-01-02"];
  assert.deepEqual(sanitizePto(plan),["2027-07-06"]);
});
