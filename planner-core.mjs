export const STORAGE_KEY = "minimal-pto-planner-v1";
export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
export const OBSERVANCE_RULES = ["none", "previous_weekday", "next_weekday", "nearest_weekday", "custom"];

const nthWeekday = (year, month, weekday, nth) => {
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(Date.UTC(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7));
};
const lastWeekday = (year, month, weekday) => {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return new Date(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)));
};
const iso = date => date.toISOString().slice(0, 10);
const shiftDate = (dateString, days) => {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
};
const isWeekend = dateString => [0, 6].includes(new Date(`${dateString}T00:00:00Z`).getUTCDay());

export const PRESETS = {
  US: { label: "United States", regions: { UT: { label: "Utah", sets: { federal: "Federal holidays" } }, national: { label: "All regions", sets: { federal: "Federal holidays" } } } },
  CA: { label: "Canada", regions: { ON: { label: "Ontario", sets: { statutory: "Statutory holidays" } } } },
  GB: { label: "United Kingdom", regions: { ENG: { label: "England & Wales", sets: { bank: "Bank holidays" } } } }
};

function definition(id, name, actualDate, supportsObservance = false) {
  return { id, name, actualDate, enabled: true, observanceRule: supportsObservance ? "nearest_weekday" : "none", observedDate: null, source: "preset", supportsObservance };
}

export function observedDateFor(actualDate, rule, customDate = null) {
  if (!actualDate || rule === "none") return null;
  if (rule === "custom") return customDate || null;
  const weekday = new Date(`${actualDate}T00:00:00Z`).getUTCDay();
  if (rule === "previous_weekday") {
    if (weekday === 0) return shiftDate(actualDate, -2);
    if (weekday === 6) return shiftDate(actualDate, -1);
    return actualDate;
  }
  if (rule === "next_weekday") {
    if (weekday === 0) return shiftDate(actualDate, 1);
    if (weekday === 6) return shiftDate(actualDate, 2);
    return actualDate;
  }
  if (rule === "nearest_weekday") {
    if (weekday === 6) return shiftDate(actualDate, -1);
    if (weekday === 0) return shiftDate(actualDate, 1);
    return actualDate;
  }
  return null;
}

export function holidayDefinitions(year, country = "US", region = "UT", preset = "federal") {
  let holidays;
  if (country === "CA") holidays = [
    definition("new-year", "New Year's Day", `${year}-01-01`, true), definition("family", "Family Day", iso(nthWeekday(year, 1, 1, 3))),
    definition("canada", "Canada Day", `${year}-07-01`, true), definition("labour", "Labour Day", iso(nthWeekday(year, 8, 1, 1))),
    definition("thanksgiving", "Thanksgiving", iso(nthWeekday(year, 9, 1, 2))), definition("christmas", "Christmas Day", `${year}-12-25`, true)
  ];
  else if (country === "GB") holidays = [
    definition("new-year", "New Year's Day", `${year}-01-01`, true), definition("early-may", "Early May bank holiday", iso(nthWeekday(year, 4, 1, 1))),
    definition("spring", "Spring bank holiday", iso(lastWeekday(year, 4, 1))), definition("summer", "Summer bank holiday", iso(lastWeekday(year, 7, 1))),
    definition("christmas", "Christmas Day", `${year}-12-25`, true), definition("boxing", "Boxing Day", `${year}-12-26`, true)
  ];
  else {
    holidays = [
      definition("new-year", "New Year's Day", `${year}-01-01`, true),
      definition("mlk", "Martin Luther King Jr. Day", iso(nthWeekday(year, 0, 1, 3))),
      definition("presidents", "Washington's Birthday", iso(nthWeekday(year, 1, 1, 3))),
      definition("memorial", "Memorial Day", iso(lastWeekday(year, 4, 1))),
      definition("juneteenth", "Juneteenth", `${year}-06-19`, true),
      definition("independence", "Independence Day", `${year}-07-04`, true),
      definition("labor", "Labor Day", iso(nthWeekday(year, 8, 1, 1))),
      definition("columbus", "Columbus Day", iso(nthWeekday(year, 9, 1, 2))),
      definition("veterans", "Veterans Day", `${year}-11-11`, true),
      definition("thanksgiving", "Thanksgiving Day", iso(nthWeekday(year, 10, 4, 4))),
      definition("christmas", "Christmas Day", `${year}-12-25`, true)
    ];
  }
  return holidays.sort((a, b) => a.actualDate.localeCompare(b.actualDate));
}

export function defaultPlan(year, carried = {}) {
  return {
    year, allowance: carried.allowance ?? 20, daysOff: [...(carried.daysOff ?? [0, 6])],
    country: carried.country ?? "US", region: carried.region ?? "UT", preset: carried.preset ?? "federal",
    holidaySettings: {}, customHolidays: [], companyClosures: [], pto: []
  };
}

export function normalizePlan(plan) {
  const normalized = { ...defaultPlan(plan.year, plan), ...plan };
  normalized.holidaySettings = { ...(plan.holidaySettings ?? {}) };
  // Migrate the old split preset model without dropping ambiguous custom entries.
  holidayDefinitions(normalized.year, normalized.country, normalized.region, normalized.preset).forEach(holiday => {
    const oldObservedId = `${holiday.id}-observed`;
    const settings = { ...(normalized.holidaySettings[holiday.id] ?? {}) };
    if (plan.holidayEnabled && Object.hasOwn(plan.holidayEnabled, holiday.id)) settings.enabled = plan.holidayEnabled[holiday.id];
    if (plan.holidayEnabled && Object.hasOwn(plan.holidayEnabled, oldObservedId) && plan.holidayEnabled[oldObservedId] === false) settings.observanceRule = "none";
    if (Object.keys(settings).length) normalized.holidaySettings[holiday.id] = settings;
  });
  normalized.customHolidays = (plan.customHolidays ?? []).map((holiday, index) => ({
    ...holiday,
    id: holiday.id ?? `custom-${index}-${holiday.date ?? holiday.actualDate}`,
    name: holiday.name || "Custom holiday", actualDate: holiday.actualDate ?? holiday.date,
    enabled: holiday.enabled !== false, observanceRule: holiday.observanceRule ?? "none",
    customObservedDate: holiday.customObservedDate ?? holiday.observedDate ?? null, source: "custom"
  })).filter(holiday => holiday.actualDate);
  normalized.companyClosures = (plan.companyClosures ?? []).map((closure, index) => ({
    ...closure,
    id: closure.id ?? `closure-${index}-${closure.date}`, name: closure.name || "Company closure",
    date: closure.date, enabled: closure.enabled !== false, source: closure.source ?? "custom_closure"
  })).filter(closure => closure.date);
  delete normalized.holidayEnabled;
  return normalized;
}

export function configuredHolidays(plan) {
  const normalized = normalizePlan(plan);
  const presets = holidayDefinitions(normalized.year, normalized.country, normalized.region, normalized.preset).map(holiday => {
    const settings = normalized.holidaySettings[holiday.id] ?? {};
    const observanceRule = settings.observanceRule ?? holiday.observanceRule;
    return { ...holiday, ...settings, enabled: settings.enabled ?? true, observanceRule,
      observedDate: observedDateFor(holiday.actualDate, observanceRule, settings.customObservedDate) };
  });
  return [...presets, ...normalized.customHolidays.map(holiday => ({
    ...holiday, observedDate: observedDateFor(holiday.actualDate, holiday.observanceRule, holiday.customObservedDate)
  }))];
}

export function calendarEntries(plan) {
  const entries = [];
  configuredHolidays(plan).filter(holiday => holiday.enabled).forEach(holiday => {
    entries.push({ id: holiday.id, name: holiday.name, date: holiday.actualDate, kind: "actual", source: holiday.source });
    if (holiday.observedDate && holiday.observedDate !== holiday.actualDate) entries.push({ id: `${holiday.id}-observed`, holidayId: holiday.id, name: `${holiday.name} Observed`, date: holiday.observedDate, kind: "observed", source: holiday.source });
  });
  normalizePlan(plan).companyClosures.filter(closure => closure.enabled).forEach(closure => entries.push({ ...closure, kind: "closure" }));
  return entries;
}

export function enabledHolidayMap(plan) {
  const map = new Map();
  calendarEntries(plan).forEach(entry => map.set(entry.date, [...(map.get(entry.date) ?? []), entry]));
  return map;
}

export function suggestObservedDate(plan, holidayId, fromDate) {
  const used = new Set(calendarEntries(plan).filter(entry => entry.holidayId !== holidayId && entry.id !== holidayId).map(entry => entry.date));
  let candidate = fromDate;
  for (let tries = 0; tries < 14; tries++) {
    candidate = shiftDate(candidate, 1);
    if (!isWeekend(candidate) && !used.has(candidate)) return candidate;
  }
  return null;
}

export function observanceConflict(plan, holidayId) {
  const holiday = configuredHolidays(plan).find(item => item.id === holidayId);
  if (!holiday?.enabled || !holiday.observedDate || holiday.observedDate === holiday.actualDate) return null;
  const collision = calendarEntries(plan).find(entry => entry.date === holiday.observedDate && entry.id !== holiday.id && entry.holidayId !== holiday.id);
  if (!collision) return null;
  return { date: holiday.observedDate, with: collision, suggestion: suggestObservedDate(plan, holidayId, holiday.observedDate) };
}

export function commonClosureShortcuts(year) {
  const thanksgiving = iso(nthWeekday(year, 10, 4, 4));
  const julyFourth = `${year}-07-04`;
  const adjacent = !isWeekend(shiftDate(julyFourth, -1)) ? shiftDate(julyFourth, -1) : shiftDate(julyFourth, 1);
  return [
    { key: "christmas-eve", name: "Christmas Eve", date: `${year}-12-24` },
    { key: "new-years-eve", name: "New Year's Eve", date: `${year}-12-31` },
    { key: "day-after-thanksgiving", name: "Day after Thanksgiving", date: shiftDate(thanksgiving, 1) },
    { key: "independence-adjacent", name: "Independence Day adjacent day", date: adjacent }
  ];
}

export function isEligible(plan, dateString) {
  const weekday = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return !plan.daysOff.includes(weekday) && !enabledHolidayMap(plan).has(dateString);
}

export function sanitizePto(plan) {
  return [...new Set(plan.pto ?? [])].filter(date => date.startsWith(`${plan.year}-`) && isEligible(plan, date)).sort();
}
