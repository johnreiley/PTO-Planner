import {
  STORAGE_KEY, WEEKDAYS, PRESETS, holidayDefinitions, defaultPlan, normalizePlan,
  configuredHolidays, enabledHolidayMap, isEligible, sanitizePto, observedDateFor,
  observanceConflict, commonClosureShortcuts
} from "./planner-core.mjs";

const $ = selector => document.querySelector(selector);
const calendar = $("#calendar");
const dialog = $("#settings-dialog");
const form = $("#settings-form");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
const ruleLabels = {
  none: "No observed day", previous_weekday: "Previous weekday", next_weekday: "Next weekday",
  nearest_weekday: "Nearest weekday", custom: "Custom date"
};
let state = loadState();
let draft = null;
let editingYear = null;
let dragging = false;
let suppressClick = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.plans && saved.selectedYear) {
      Object.entries(saved.plans).forEach(([year, plan]) => { saved.plans[year] = normalizePlan(plan); });
      return saved;
    }
  } catch { /* Ignore malformed local state. */ }
  return { selectedYear: new Date().getFullYear(), plans: {} };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function currentPlan() { return state.plans[state.selectedYear]; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function formatDate(date) { return new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date); }
function shortDate(dateString) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dateString}T00:00:00Z`)); }
function escapeHtml(value) { const span = document.createElement("span"); span.textContent = value; return span.innerHTML; }
function uniqueId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function ensurePlan(year, source = currentPlan()) {
  if (!state.plans[year]) state.plans[year] = defaultPlan(year, source || {});
  return state.plans[year];
}

function render() {
  const plan = currentPlan();
  if (!plan) return;
  plan.pto = sanitizePto(plan);
  const holidayMap = enabledHolidayMap(plan);
  $("#summary-year").textContent = plan.year;
  $("#summary-allowance").textContent = plan.allowance;
  const remaining = plan.allowance - plan.pto.length;
  $("#summary-remaining").textContent = remaining;
  $("#summary-remaining").classList.toggle("negative", remaining < 0);
  calendar.innerHTML = "";
  const localeFirstDay = ["US", "CA"].includes(plan.country) ? 0 : 1;
  for (let month = 0; month < 12; month++) calendar.append(buildMonth(plan, holidayMap, month, localeFirstDay));
  saveState();
}

function buildMonth(plan, holidays, month, firstDay) {
  const section = document.createElement("article");
  section.className = "month";
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(plan.year, month, 1)));
  section.innerHTML = `<h2>${monthName}</h2>`;
  const grid = document.createElement("div"); grid.className = "month-grid";
  for (let i = 0; i < 7; i++) { const w = document.createElement("div"); w.className = "weekday"; w.textContent = WEEKDAYS[(firstDay + i) % 7]; grid.append(w); }
  const firstWeekday = new Date(Date.UTC(plan.year, month, 1)).getUTCDay();
  const leading = (firstWeekday - firstDay + 7) % 7;
  for (let i = 0; i < leading; i++) { const spacer = document.createElement("span"); spacer.className = "day-spacer"; grid.append(spacer); }
  const total = new Date(Date.UTC(plan.year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= total; day++) {
    const date = new Date(Date.UTC(plan.year, month, day));
    const key = date.toISOString().slice(0, 10);
    const entries = holidays.get(key) ?? [];
    const off = plan.daysOff.includes(date.getUTCDay());
    const selected = plan.pto.includes(key);
    const button = document.createElement("button");
    button.type = "button"; button.className = "day"; button.dataset.date = key; button.textContent = day;
    let stateLabel = "Workday";
    if (off) { button.classList.add("off"); stateLabel = "Recurring day off"; }
    if (entries.length) {
      button.classList.add("holiday", ...new Set(entries.map(entry => entry.kind)));
      stateLabel = entries.map(entry => entry.name).join("; "); button.title = stateLabel;
    }
    if (selected) { button.classList.add("pto"); stateLabel = "PTO selected"; }
    button.disabled = off || entries.length > 0;
    button.setAttribute("aria-label", `${formatDate(date)} — ${stateLabel}`);
    grid.append(button);
  }
  section.append(grid); return section;
}

function togglePto(date) {
  const plan = currentPlan(); if (!isEligible(plan, date)) return;
  plan.pto = plan.pto.includes(date) ? plan.pto.filter(item => item !== date) : [...plan.pto, date]; render();
}
function addPto(date) {
  const plan = currentPlan(); if (isEligible(plan, date) && !plan.pto.includes(date)) { plan.pto.push(date); render(); }
}
calendar.addEventListener("click", event => { const day = event.target.closest(".day"); if (!day || suppressClick) { suppressClick = false; return; } togglePto(day.dataset.date); });
if (finePointer) {
  calendar.addEventListener("pointerdown", event => { const day = event.target.closest(".day:not(:disabled)"); if (!day || event.button !== 0) return; dragging = true; suppressClick = false; addPto(day.dataset.date); });
  calendar.addEventListener("pointerover", event => { if (!dragging) return; const day = event.target.closest(".day:not(:disabled)"); if (day) { suppressClick = true; addPto(day.dataset.date); } });
  window.addEventListener("pointerup", () => { dragging = false; setTimeout(() => suppressClick = false, 0); });
}

function fillSelect(select, entries, chosen) {
  select.innerHTML = ""; entries.forEach(([value, label]) => { const option = new Option(label, value); option.selected = value === chosen; select.add(option); });
}
function syncPresetSelectors(keepRegion = true) {
  const country = $("#country-select").value || draft.country;
  const countryData = PRESETS[country];
  const region = keepRegion && countryData.regions[draft.region] ? draft.region : Object.keys(countryData.regions)[0];
  fillSelect($("#region-select"), Object.entries(countryData.regions).map(([key, value]) => [key, value.label]), region);
  const sets = countryData.regions[region].sets;
  const preset = sets[draft.preset] ? draft.preset : Object.keys(sets)[0];
  fillSelect($("#preset-select"), Object.entries(sets), preset);
  draft.country = country; draft.region = region; draft.preset = preset; renderHolidaySettings();
}

function holidayCard(holiday, custom = false) {
  const settings = custom ? holiday : (draft.holidaySettings[holiday.id] ?? {});
  const enabled = settings.enabled ?? true;
  const rule = settings.observanceRule ?? holiday.observanceRule;
  const observedDate = observedDateFor(holiday.actualDate, rule, settings.customObservedDate);
  const conflict = observanceConflict(draft, holiday.id);
  const showConflict = conflict && settings.allowedConflictDate !== conflict.date;
  const options = Object.entries(ruleLabels).map(([value, label]) => `<option value="${value}" ${rule === value ? "selected" : ""}>${label}</option>`).join("");
  return `<article class="holiday-card ${enabled ? "" : "disabled"}" data-holiday-card="${holiday.id}" data-custom="${custom}">
    <div class="holiday-card-heading"><div><strong>${escapeHtml(holiday.name)}</strong><small>Actual date · ${shortDate(holiday.actualDate)}</small></div>
      <label class="switch-label"><span>Enabled</span><input class="holiday-enabled" type="checkbox" ${enabled ? "checked" : ""}></label></div>
    <div class="observance-fields">
      <label>Observed day<select class="observance-rule" ${enabled ? "" : "disabled"}>${options}</select></label>
      <label class="custom-observed ${rule === "custom" ? "" : "hidden"}">Custom date<input class="observed-date" type="date" min="${draft.year}-01-01" max="${draft.year}-12-31" value="${settings.customObservedDate ?? ""}" ${enabled ? "" : "disabled"}></label>
      <div class="observed-summary"><span>Observed date</span><strong>${observedDate && observedDate !== holiday.actualDate ? shortDate(observedDate) : "—"}</strong></div>
    </div>
    ${showConflict ? `<div class="conflict" role="alert"><p><strong>${shortDate(conflict.date)}</strong> is already used for ${escapeHtml(conflict.with.name)}. ${conflict.suggestion ? `Move ${escapeHtml(holiday.name)} observed to ${shortDate(conflict.suggestion)}?` : "Choose another observed date."}</p><div>${conflict.suggestion ? `<button type="button" data-conflict-action="move" data-date="${conflict.suggestion}">Move to ${shortDate(conflict.suggestion)}</button>` : ""}<button type="button" data-conflict-action="keep" data-date="${conflict.date}">Keep both</button><button type="button" data-conflict-action="choose">Choose another date</button></div></div>` : ""}
    ${custom ? `<button type="button" class="remove-link remove-holiday" aria-label="Remove ${escapeHtml(holiday.name)}">Remove holiday</button>` : ""}
  </article>`;
}

function renderHolidaySettings() {
  const list = $("#preset-holidays");
  list.innerHTML = holidayDefinitions(draft.year, draft.country, draft.region, draft.preset).map(holiday => holidayCard(holiday)).join("");
  renderCustomHolidays();
}
function renderCustomHolidays() {
  $("#custom-holidays").innerHTML = draft.customHolidays.map(holiday => holidayCard(holiday, true)).join("");
}
function renderClosures() {
  [$("#custom-date"), $("#closure-date")].forEach(input => { input.min = `${draft.year}-01-01`; input.max = `${draft.year}-12-31`; });
  const shortcuts = commonClosureShortcuts(draft.year);
  $("#closure-shortcuts").innerHTML = shortcuts.map(shortcut => {
    const active = draft.companyClosures.some(closure => closure.enabled && closure.source === "preset_closure" && closure.shortcut === shortcut.key);
    return `<button type="button" class="shortcut ${active ? "active" : ""}" data-shortcut="${shortcut.key}" aria-pressed="${active}">${active ? "✓ " : "+ "}${escapeHtml(shortcut.name)}<small>${shortDate(shortcut.date)}</small></button>`;
  }).join("");
  $("#company-closures").innerHTML = draft.companyClosures.map(closure => `<div class="holiday-item closure-item"><span><strong>${escapeHtml(closure.name)}</strong><small>${shortDate(closure.date)} · Company closure</small></span><label class="switch-label"><span>Enabled</span><input type="checkbox" class="closure-enabled" data-id="${closure.id}" ${closure.enabled ? "checked" : ""}></label><button type="button" class="remove-holiday remove-closure" data-id="${closure.id}" aria-label="Remove ${escapeHtml(closure.name)}">×</button></div>`).join("");
}
function rerenderSettings() { renderHolidaySettings(); renderClosures(); }

function holidayAndSettings(card) {
  const id = card.dataset.holidayCard;
  if (card.dataset.custom === "true") {
    const holiday = draft.customHolidays.find(item => item.id === id);
    return { holiday, settings: holiday };
  }
  const holiday = holidayDefinitions(draft.year, draft.country, draft.region, draft.preset).find(item => item.id === id);
  draft.holidaySettings[id] ??= {};
  return { holiday, settings: draft.holidaySettings[id] };
}

function openSettings(firstTime = false) {
  draft = normalizePlan(clone(currentPlan() || defaultPlan(state.selectedYear)));
  editingYear = draft.year;
  $("#year-input").value = draft.year; $("#allowance-input").value = draft.allowance;
  $("#dialog-kicker").textContent = firstTime ? "WELCOME" : "PLAN YOUR YEAR"; $("#settings-title").textContent = firstTime ? "Set up your planner" : "Planner settings";
  $("#close-dialog").hidden = firstTime; $("#cancel-button").hidden = firstTime; $("#reset-button").hidden = firstTime;
  const toggles = $("#weekday-toggles"); toggles.innerHTML = "";
  [[1, "M"], [2, "T"], [3, "W"], [4, "T"], [5, "F"], [6, "S"], [0, "S"]].forEach(([value, label]) => { const el = document.createElement("label"); el.className = "weekday-toggle"; el.innerHTML = `<input type="checkbox" value="${value}" ${draft.daysOff.includes(value) ? "checked" : ""}><span>${label}</span>`; toggles.append(el); });
  fillSelect($("#country-select"), Object.entries(PRESETS).map(([key, value]) => [key, value.label]), draft.country); syncPresetSelectors(); renderClosures(); dialog.showModal();
}

$("#country-select").addEventListener("change", () => syncPresetSelectors(false));
$("#region-select").addEventListener("change", () => { draft.region = $("#region-select").value; draft.preset = Object.keys(PRESETS[draft.country].regions[draft.region].sets)[0]; syncPresetSelectors(); });
$("#preset-select").addEventListener("change", () => { draft.preset = $("#preset-select").value; renderHolidaySettings(); });
$("#year-input").addEventListener("change", () => { draft.year = Number($("#year-input").value); rerenderSettings(); });

function handleHolidayChange(event) {
  const card = event.target.closest("[data-holiday-card]"); if (!card) return;
  const { settings } = holidayAndSettings(card); if (!settings) return;
  if (event.target.matches(".holiday-enabled")) settings.enabled = event.target.checked;
  if (event.target.matches(".observance-rule")) { settings.observanceRule = event.target.value; delete settings.allowedConflictDate; }
  if (event.target.matches(".observed-date")) { settings.customObservedDate = event.target.value || null; delete settings.allowedConflictDate; }
  rerenderSettings();
}
$("#preset-holidays").addEventListener("change", handleHolidayChange);
$("#custom-holidays").addEventListener("change", handleHolidayChange);

function handleHolidayClick(event) {
  const card = event.target.closest("[data-holiday-card]"); if (!card) return;
  const { holiday, settings } = holidayAndSettings(card); if (!holiday) return;
  if (event.target.closest(".remove-holiday")) { draft.customHolidays = draft.customHolidays.filter(item => item.id !== holiday.id); rerenderSettings(); return; }
  const action = event.target.dataset.conflictAction;
  if (action === "move") { settings.observanceRule = "custom"; settings.customObservedDate = event.target.dataset.date; delete settings.allowedConflictDate; }
  if (action === "keep") settings.allowedConflictDate = event.target.dataset.date;
  if (action === "choose") { settings.observanceRule = "custom"; settings.customObservedDate = ""; }
  if (action) { rerenderSettings(); if (action === "choose") document.querySelector(`[data-holiday-card="${holiday.id}"] .observed-date`)?.focus(); }
}
$("#preset-holidays").addEventListener("click", handleHolidayClick);
$("#custom-holidays").addEventListener("click", handleHolidayClick);

$("#add-holiday").addEventListener("click", () => {
  const date = $("#custom-date").value;
  if (!date || !date.startsWith(`${draft.year}-`)) { $("#custom-date").setCustomValidity(`Choose a date in ${draft.year}.`); $("#custom-date").reportValidity(); return; }
  $("#custom-date").setCustomValidity("");
  draft.customHolidays.push({ id: uniqueId("custom"), actualDate: date, name: $("#custom-name").value.trim() || "Custom holiday", enabled: true, observanceRule: "none", customObservedDate: null, source: "custom" });
  $("#custom-date").value = ""; $("#custom-name").value = ""; rerenderSettings();
});

$("#add-closure").addEventListener("click", () => {
  const date = $("#closure-date").value;
  if (!date || !date.startsWith(`${draft.year}-`)) { $("#closure-date").setCustomValidity(`Choose a date in ${draft.year}.`); $("#closure-date").reportValidity(); return; }
  $("#closure-date").setCustomValidity("");
  draft.companyClosures.push({ id: uniqueId("closure"), date, name: $("#closure-name").value.trim() || "Company closure", enabled: true, source: "custom_closure" });
  $("#closure-date").value = ""; $("#closure-name").value = ""; rerenderSettings();
});
$("#closure-shortcuts").addEventListener("click", event => {
  const button = event.target.closest("[data-shortcut]"); if (!button) return;
  const shortcut = commonClosureShortcuts(draft.year).find(item => item.key === button.dataset.shortcut);
  const existing = draft.companyClosures.find(closure => closure.source === "preset_closure" && closure.shortcut === shortcut.key);
  if (existing) draft.companyClosures = draft.companyClosures.filter(closure => closure !== existing);
  else draft.companyClosures.push({ id: `shortcut-${shortcut.key}`, ...shortcut, enabled: true, source: "preset_closure", shortcut: shortcut.key });
  rerenderSettings();
});
$("#company-closures").addEventListener("change", event => { if (event.target.matches(".closure-enabled")) { const closure = draft.companyClosures.find(item => item.id === event.target.dataset.id); closure.enabled = event.target.checked; rerenderSettings(); } });
$("#company-closures").addEventListener("click", event => { const button = event.target.closest(".remove-closure"); if (button) { draft.companyClosures = draft.companyClosures.filter(item => item.id !== button.dataset.id); rerenderSettings(); } });

form.addEventListener("submit", event => {
  event.preventDefault();
  const targetYear = Number($("#year-input").value); const allowance = Number($("#allowance-input").value);
  if (!Number.isInteger(targetYear) || targetYear < 1970 || targetYear > 2100 || !Number.isInteger(allowance) || allowance < 0) { form.reportValidity(); return; }
  const existing = state.plans[targetYear];
  if (existing && targetYear !== editingYear) { state.selectedYear = targetYear; dialog.close(); render(); return; }
  const plan = targetYear === editingYear ? draft : (existing || defaultPlan(targetYear, draft));
  plan.year = targetYear; plan.allowance = allowance; plan.daysOff = [...document.querySelectorAll("#weekday-toggles input:checked")].map(input => Number(input.value));
  plan.country = $("#country-select").value; plan.region = $("#region-select").value; plan.preset = $("#preset-select").value;
  plan.pto = sanitizePto(plan); state.plans[targetYear] = normalizePlan(plan); state.selectedYear = targetYear; dialog.close(); render();
});
$("#settings-button").addEventListener("click", () => openSettings(false));
$("#close-dialog").addEventListener("click", () => dialog.close()); $("#cancel-button").addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", event => { if ($("#close-dialog").hidden) event.preventDefault(); });
$("#clear-button").addEventListener("click", () => { const plan = currentPlan(); if (confirm(`Clear all PTO selections for ${plan.year}?`)) { plan.pto = []; render(); } });
$("#reset-button").addEventListener("click", () => { const year = draft.year; if (confirm(`Reset all settings and PTO selections for ${year}? This cannot be undone.`)) { state.plans[year] = defaultPlan(year); state.selectedYear = year; dialog.close(); render(); } });

if (!state.plans[state.selectedYear]) { ensurePlan(state.selectedYear, null); render(); openSettings(true); } else render();
