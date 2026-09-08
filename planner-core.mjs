export const STORAGE_KEY = "minimal-pto-planner-v1";
export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const nthWeekday = (year, month, weekday, nth) => {
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(Date.UTC(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7));
};
const lastWeekday = (year, month, weekday) => {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return new Date(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)));
};
const iso = date => date.toISOString().slice(0, 10);
const observed = (year, month, day) => {
  const actual = new Date(Date.UTC(year, month, day));
  const weekday = actual.getUTCDay();
  if (weekday === 6) return iso(new Date(Date.UTC(year, month, day - 1)));
  if (weekday === 0) return iso(new Date(Date.UTC(year, month, day + 1)));
  return null;
};

export const PRESETS = {
  US: { label: "United States", regions: { UT: { label: "Utah", sets: { federal: "Federal holidays" } }, national: { label: "All regions", sets: { federal: "Federal holidays" } } } },
  CA: { label: "Canada", regions: { ON: { label: "Ontario", sets: { statutory: "Statutory holidays" } } } },
  GB: { label: "United Kingdom", regions: { ENG: { label: "England & Wales", sets: { bank: "Bank holidays" } } } }
};

export function holidayDefinitions(year, country = "US", region = "UT", preset = "federal") {
  if (country === "CA") return [
    ["new-year", "New Year's Day", `${year}-01-01`], ["family", "Family Day", iso(nthWeekday(year, 1, 1, 3))],
    ["canada", "Canada Day", `${year}-07-01`], ["labour", "Labour Day", iso(nthWeekday(year, 8, 1, 1))],
    ["thanksgiving", "Thanksgiving", iso(nthWeekday(year, 9, 1, 2))], ["christmas", "Christmas Day", `${year}-12-25`]
  ].map(([id, name, date]) => ({ id, name, date, observed: false }));
  if (country === "GB") return [
    ["new-year", "New Year's Day", `${year}-01-01`], ["early-may", "Early May bank holiday", iso(nthWeekday(year, 4, 1, 1))],
    ["spring", "Spring bank holiday", iso(lastWeekday(year, 4, 1))], ["summer", "Summer bank holiday", iso(lastWeekday(year, 7, 1))],
    ["christmas", "Christmas Day", `${year}-12-25`], ["boxing", "Boxing Day", `${year}-12-26`]
  ].map(([id, name, date]) => ({ id, name, date, observed: false }));

  const fixed = [["new-year", "New Year's Day", 0, 1], ["juneteenth", "Juneteenth", 5, 19], ["independence", "Independence Day", 6, 4], ["veterans", "Veterans Day", 10, 11], ["christmas", "Christmas Day", 11, 25]];
  const results = fixed.flatMap(([id, name, month, day]) => {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const obs = observed(year, month, day);
    return [{ id, name, date, observed: false }, ...(obs ? [{ id: `${id}-observed`, name: `${name} Observed`, date: obs, observed: true }] : [])];
  });
  return [...results,
    { id: "mlk", name: "Martin Luther King Jr. Day", date: iso(nthWeekday(year, 0, 1, 3)), observed: false },
    { id: "presidents", name: "Washington's Birthday", date: iso(nthWeekday(year, 1, 1, 3)), observed: false },
    { id: "memorial", name: "Memorial Day", date: iso(lastWeekday(year, 4, 1)), observed: false },
    { id: "labor", name: "Labor Day", date: iso(nthWeekday(year, 8, 1, 1)), observed: false },
    { id: "columbus", name: "Columbus Day", date: iso(nthWeekday(year, 9, 1, 2)), observed: false },
    { id: "thanksgiving", name: "Thanksgiving Day", date: iso(nthWeekday(year, 10, 4, 4)), observed: false }
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function defaultPlan(year, carried = {}) {
  return { year, allowance: carried.allowance ?? 20, daysOff: [...(carried.daysOff ?? [0, 6])], country: carried.country ?? "US", region: carried.region ?? "UT", preset: carried.preset ?? "federal", holidayEnabled: { ...(carried.holidayEnabled ?? {}) }, customHolidays: [], pto: [] };
}

export function enabledHolidayMap(plan) {
  const map = new Map();
  holidayDefinitions(plan.year, plan.country, plan.region, plan.preset).forEach(h => {
    if (plan.holidayEnabled[h.id] !== false) map.set(h.date, h);
  });
  plan.customHolidays.forEach((h, index) => map.set(h.date, { ...h, id: `custom-${index}`, observed: false }));
  return map;
}

export function isEligible(plan, dateString) {
  const weekday = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return !plan.daysOff.includes(weekday) && !enabledHolidayMap(plan).has(dateString);
}

export function sanitizePto(plan) {
  return [...new Set(plan.pto)].filter(date => date.startsWith(`${plan.year}-`) && isEligible(plan, date)).sort();
}
