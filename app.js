import { STORAGE_KEY, WEEKDAYS, PRESETS, holidayDefinitions, defaultPlan, enabledHolidayMap, isEligible, sanitizePto } from "./planner-core.mjs";

const $ = selector => document.querySelector(selector);
const calendar = $("#calendar");
const dialog = $("#settings-dialog");
const form = $("#settings-form");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
let state = loadState();
let draft = null;
let editingYear = null;
let dragging = false;
let suppressClick = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.plans && saved.selectedYear) return saved;
  } catch { /* Ignore malformed local state. */ }
  return { selectedYear: new Date().getFullYear(), plans: {} };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function currentPlan() { return state.plans[state.selectedYear]; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function formatDate(date) { return new Intl.DateTimeFormat(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric", timeZone:"UTC" }).format(date); }

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
  const monthName = new Intl.DateTimeFormat(undefined, { month:"long", timeZone:"UTC" }).format(new Date(Date.UTC(plan.year, month, 1)));
  section.innerHTML = `<h2>${monthName}</h2>`;
  const grid = document.createElement("div"); grid.className = "month-grid";
  for (let i = 0; i < 7; i++) { const w = document.createElement("div"); w.className="weekday"; w.textContent=WEEKDAYS[(firstDay+i)%7]; grid.append(w); }
  const firstWeekday = new Date(Date.UTC(plan.year, month, 1)).getUTCDay();
  const leading = (firstWeekday - firstDay + 7) % 7;
  for (let i=0;i<leading;i++) { const spacer=document.createElement("span"); spacer.className="day-spacer"; grid.append(spacer); }
  const total = new Date(Date.UTC(plan.year, month + 1, 0)).getUTCDate();
  for (let day=1; day<=total; day++) {
    const date = new Date(Date.UTC(plan.year, month, day));
    const key = date.toISOString().slice(0,10);
    const holiday = holidays.get(key);
    const off = plan.daysOff.includes(date.getUTCDay());
    const selected = plan.pto.includes(key);
    const button = document.createElement("button");
    button.type="button"; button.className="day"; button.dataset.date=key; button.textContent=day;
    let stateLabel = "Workday";
    if (off) { button.classList.add("off"); stateLabel="Recurring day off"; }
    if (holiday) { button.classList.add("holiday"); if (holiday.observed) button.classList.add("observed"); stateLabel=holiday.name; button.title=holiday.name; }
    if (selected) { button.classList.add("pto"); stateLabel="PTO selected"; }
    button.disabled = off || !!holiday;
    button.setAttribute("aria-label", `${formatDate(date)} — ${stateLabel}`);
    grid.append(button);
  }
  section.append(grid); return section;
}

function togglePto(date) {
  const plan=currentPlan(); if (!isEligible(plan,date)) return;
  plan.pto = plan.pto.includes(date) ? plan.pto.filter(d=>d!==date) : [...plan.pto,date]; render();
}
function addPto(date) {
  const plan=currentPlan(); if (isEligible(plan,date) && !plan.pto.includes(date)) { plan.pto.push(date); render(); }
}
calendar.addEventListener("click", event => { const day=event.target.closest(".day"); if(!day || suppressClick) { suppressClick=false; return; } togglePto(day.dataset.date); });
if (finePointer) {
  calendar.addEventListener("pointerdown", event => { const day=event.target.closest(".day:not(:disabled)"); if(!day || event.button!==0) return; dragging=true; suppressClick=false; addPto(day.dataset.date); });
  calendar.addEventListener("pointerover", event => { if(!dragging) return; const day=event.target.closest(".day:not(:disabled)"); if(day) { suppressClick=true; addPto(day.dataset.date); } });
  window.addEventListener("pointerup", () => { dragging=false; setTimeout(()=>suppressClick=false,0); });
}

function fillSelect(select, entries, chosen) {
  select.innerHTML=""; entries.forEach(([value,label]) => { const option=new Option(label,value); option.selected=value===chosen; select.add(option); });
}
function syncPresetSelectors(keepRegion=true) {
  const country=$("#country-select").value || draft.country;
  const countryData=PRESETS[country];
  const region = keepRegion && countryData.regions[draft.region] ? draft.region : Object.keys(countryData.regions)[0];
  fillSelect($("#region-select"),Object.entries(countryData.regions).map(([k,v])=>[k,v.label]),region);
  const sets=countryData.regions[region].sets;
  const preset=sets[draft.preset] ? draft.preset : Object.keys(sets)[0];
  fillSelect($("#preset-select"),Object.entries(sets),preset);
  draft.country=country; draft.region=region; draft.preset=preset; renderPresetHolidays();
}
function renderPresetHolidays() {
  const list=$("#preset-holidays"); list.innerHTML="";
  holidayDefinitions(draft.year,draft.country,draft.region,draft.preset).forEach(h => {
    const label=document.createElement("label"); label.className="holiday-item";
    label.innerHTML=`<span>${h.name}<br><small>${h.date}${h.observed ? " · observed" : ""}</small></span><input type="checkbox" data-holiday-id="${h.id}" ${draft.holidayEnabled[h.id] !== false ? "checked" : ""}>`;
    list.append(label);
  });
}
function renderCustomHolidays() {
  const list=$("#custom-holidays"); list.innerHTML="";
  draft.customHolidays.forEach((h,index)=>{ const row=document.createElement("div"); row.className="holiday-item"; row.innerHTML=`<span>${h.name || "Custom holiday"}<br><small>${h.date}</small></span><button type="button" class="remove-holiday" data-index="${index}" aria-label="Remove ${h.name || "custom holiday"}">×</button>`; list.append(row); });
}
function openSettings(firstTime=false) {
  draft=clone(currentPlan() || defaultPlan(state.selectedYear));
  editingYear=draft.year;
  $("#year-input").value=draft.year; $("#allowance-input").value=draft.allowance;
  $("#dialog-kicker").textContent=firstTime ? "WELCOME" : "PLAN YOUR YEAR"; $("#settings-title").textContent=firstTime ? "Set up your planner" : "Planner settings";
  $("#close-dialog").hidden=firstTime; $("#cancel-button").hidden=firstTime; $("#reset-button").hidden=firstTime;
  const toggles=$("#weekday-toggles"); toggles.innerHTML="";
  [[1,"M"],[2,"T"],[3,"W"],[4,"T"],[5,"F"],[6,"S"],[0,"S"]].forEach(([value,label])=>{ const el=document.createElement("label"); el.className="weekday-toggle"; el.innerHTML=`<input type="checkbox" value="${value}" ${draft.daysOff.includes(value) ? "checked" : ""}><span>${label}</span>`; toggles.append(el); });
  fillSelect($("#country-select"),Object.entries(PRESETS).map(([k,v])=>[k,v.label]),draft.country); syncPresetSelectors(); renderCustomHolidays(); dialog.showModal();
}

$("#country-select").addEventListener("change",()=>syncPresetSelectors(false));
$("#region-select").addEventListener("change",()=>{ draft.region=$("#region-select").value; draft.preset=Object.keys(PRESETS[draft.country].regions[draft.region].sets)[0]; syncPresetSelectors(); });
$("#preset-select").addEventListener("change",()=>{ draft.preset=$("#preset-select").value; renderPresetHolidays(); });
$("#year-input").addEventListener("change",()=>{ draft.year=Number($("#year-input").value); renderPresetHolidays(); });
$("#add-holiday").addEventListener("click",()=>{ const date=$("#custom-date").value; if(!date || !date.startsWith(`${draft.year}-`)) { $("#custom-date").setCustomValidity(`Choose a date in ${draft.year}.`); $("#custom-date").reportValidity(); return; } $("#custom-date").setCustomValidity(""); draft.customHolidays.push({date,name:$("#custom-name").value.trim() || "Custom holiday"}); $("#custom-date").value=""; $("#custom-name").value=""; renderCustomHolidays(); });
$("#custom-holidays").addEventListener("click",e=>{ const button=e.target.closest(".remove-holiday"); if(button){draft.customHolidays.splice(Number(button.dataset.index),1);renderCustomHolidays();} });
form.addEventListener("submit",event=>{
  event.preventDefault();
  const targetYear=Number($("#year-input").value); const allowance=Number($("#allowance-input").value);
  if(!Number.isInteger(targetYear)||targetYear<1970||targetYear>2100||!Number.isInteger(allowance)||allowance<0){form.reportValidity();return;}
  const existing=state.plans[targetYear];
  if (existing && targetYear !== editingYear) {
    state.selectedYear=targetYear; dialog.close(); render(); return;
  }
  const plan=targetYear === editingYear ? draft : (existing || defaultPlan(targetYear, draft));
  plan.year=targetYear; plan.allowance=allowance; plan.daysOff=[...document.querySelectorAll("#weekday-toggles input:checked")].map(i=>Number(i.value));
  plan.country=$("#country-select").value; plan.region=$("#region-select").value; plan.preset=$("#preset-select").value;
  plan.holidayEnabled={}; document.querySelectorAll("[data-holiday-id]").forEach(i=>plan.holidayEnabled[i.dataset.holidayId]=i.checked);
  plan.pto=sanitizePto(plan); state.plans[targetYear]=plan; state.selectedYear=targetYear; dialog.close(); render();
});
$("#settings-button").addEventListener("click",()=>openSettings(false));
$("#close-dialog").addEventListener("click",()=>dialog.close()); $("#cancel-button").addEventListener("click",()=>dialog.close());
dialog.addEventListener("cancel", event => { if ($("#close-dialog").hidden) event.preventDefault(); });
$("#clear-button").addEventListener("click",()=>{ const plan=currentPlan(); if(confirm(`Clear all PTO selections for ${plan.year}?`)){plan.pto=[];render();} });
$("#reset-button").addEventListener("click",()=>{ const year=draft.year; if(confirm(`Reset all settings and PTO selections for ${year}? This cannot be undone.`)){state.plans[year]=defaultPlan(year);state.selectedYear=year;dialog.close();render();} });

if (!state.plans[state.selectedYear]) { ensurePlan(state.selectedYear, null); render(); openSettings(true); } else render();
