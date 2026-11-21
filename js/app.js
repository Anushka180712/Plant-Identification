import { loadImage, analyseQuality, toJpeg } from "./quality.js";
import { identify, serviceMode, THRESHOLDS, ServiceNotConfigured, ApiError } from "./identify.js";
import * as store from "./storage.js";
import { HELP, NUTRIENTS, PHOTO_TIP_KEYS, matchNutrient } from "./guide.js";
import { t, setLang, getLang, hasChosenLang, LANGS, locale } from "./i18n.js";

const W = window.PaudhaWeather;
const MAX_PHOTOS = 5;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p) => `${Math.round(p * 100)}%`;
const partLabel = (p) => t(`part.${p}`);
const fmtDate = (iso, opts) => new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString(locale(), opts);
const fmtDateTime = (iso) => new Date(iso).toLocaleString(locale());

function toast(msg, ms = 3000) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

/* ---------------- Tabs ---------------- */
let currentView = "scan";
function showView(name) {
  currentView = name;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "history") renderHistory();
  if (name === "places") renderPlaces();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0 });
  history.replaceState(null, "", `#${name}`);
}
$$(".tab").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

/* ---------------- Scan ---------------- */
let selectedPart = "leaf";
let photos = [];
let lastResult = null;

$$("#part-chips .chip").forEach((c) =>
  c.addEventListener("click", () => {
    selectedPart = c.dataset.part;
    $$("#part-chips .chip").forEach((x) => x.classList.toggle("selected", x === c));
  })
);

async function addFiles(files) {
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) {
      toast(t("scan.maxPhotos", { max: MAX_PHOTOS }));
      break;
    }
    if (!file.type.startsWith("image/")) {
      toast(t("scan.notImage"));
      continue;
    }
    try {
      const { img, url } = await loadImage(file);
      const quality = analyseQuality(img);
      photos.push({
        id: store.uid(),
        part: selectedPart,
        url,
        quality,
        upload: quality.ok ? toJpeg(img, 1500, 0.85) : null,
        thumb: toJpeg(img, 160, 0.7)
      });
    } catch {
      toast(t("scan.cantOpen"));
    }
  }
  renderPhotos();
}

$("#camera-input").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
$("#gallery-input").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

function renderPhotos() {
  const list = $("#photo-list");
  list.innerHTML = photos.map((p) => `
    <li class="photo-item ${p.quality.ok ? "" : "bad"}">
      <img src="${p.url}" alt="${esc(partLabel(p.part))}">
      <div class="meta">
        <strong>${esc(partLabel(p.part))}</strong>
        ${p.quality.ok ? `✅ ${esc(t("scan.clear"))}` : p.quality.problems.map((x) => `⚠️ ${esc(t(`q.${x.code}`))}`).join("<br>")}
      </div>
      <button class="icon-btn" data-remove="${p.id}" aria-label="${esc(t("scan.remove"))}">✕</button>
    </li>`).join("");
  $$("[data-remove]", list).forEach((b) => b.addEventListener("click", () => {
    const p = photos.find((x) => x.id === b.dataset.remove);
    if (p) URL.revokeObjectURL(p.url);
    photos = photos.filter((x) => x.id !== b.dataset.remove);
    renderPhotos();
  }));

  const good = photos.filter((p) => p.quality.ok).length;
  const bad = photos.length - good;
  $("#analyse-btn").disabled = good === 0;
  $("#photo-count").textContent = photos.length === 0
    ? t("scan.countEmpty", { max: MAX_PHOTOS })
    : t("scan.countReady", { good }) + (bad ? " " + t("scan.countSkipped", { bad }) : "");
}

function renderTips() {
  $("#tips-list").innerHTML = PHOTO_TIP_KEYS.map((k) => `<li>${esc(t(k))}</li>`).join("");
}

function fillPlaceSelect() {
  const sel = $("#scan-place");
  const current = sel.value;
  sel.innerHTML = `<option value="">${esc(t("scan.noPlace"))}</option>` +
    store.getPlaces().map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  sel.value = current;
}

$("#analyse-btn").addEventListener("click", async () => {
  const good = photos.filter((p) => p.quality.ok);
  if (!good.length) return;
  const placeId = $("#scan-place").value;
  const place = store.getPlaces().find((p) => p.id === placeId);
  const result = $("#result");
  result.innerHTML = `<div class="card loading"><div class="spinner"></div>${esc(t("scan.loading"))}</div>`;
  result.scrollIntoView({ behavior: "smooth" });
  $("#analyse-btn").disabled = true;

  try {
    const res = await identify(good.map((p) => p.upload), place ? { lat: place.lat, lon: place.lon } : null);
    lastResult = res;
    renderResult(res, result);
    if (res.verdict === "plant") {
      store.addHistory({
        thumb: good[0].thumb,
        parts: good.map((p) => p.part),
        placeId: place?.id || "",
        placeName: place?.name || "",
        result: res
      });
    }
  } catch (e) {
    lastResult = null;
    if (e instanceof ServiceNotConfigured) {
      result.innerHTML = `<div class="banner warn"><h3>${esc(t("err.noService.title"))}</h3>
        <p>${esc(t("err.noService.body"))}</p>
        <p><button class="btn small" data-goto="settings">⚙️ ${esc(t("tab.settings"))}</button></p></div>`;
      $("[data-goto]", result).addEventListener("click", () => showView("settings"));
    } else {
      const msg = !navigator.onLine ? t("err.offline") : e instanceof ApiError ? t(e.key, e.vars) : t("err.generic");
      result.innerHTML = `<div class="banner danger"><h3>${esc(t("err.title"))}</h3><p>${esc(msg)}</p></div>`;
    }
  } finally {
    $("#analyse-btn").disabled = photos.filter((p) => p.quality.ok).length === 0;
  }
});

function expertBox(reasonKey) {
  return `<div class="expert">
    <strong>👩‍🔬 ${esc(t("ex.title"))}</strong>
    <p>${esc(t(reasonKey))}</p>
    <p>📞 <a href="tel:${HELP.kccPhone}">${HELP.kccDisplay}</a>, ${esc(t("help.kcc"))}<br>
    🏛️ <a href="${HELP.links[0].url}" target="_blank" rel="noopener">${esc(t(HELP.links[0].key))}</a></p>
  </div>`;
}

function photoTipsHtml() {
  return `<ul class="fix-list">${PHOTO_TIP_KEYS.map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul>`;
}

const sureBadge = (p) => `<span class="confidence">${esc(t("r.sure", { p: pct(p) }))}</span>`;

function renderResult(res, el, { fromHistory = false } = {}) {
  if (res.verdict === "not_plant") {
    el.innerHTML = `<div class="banner danger"><h3>🚫 ${esc(t("r.notPlant.title"))}</h3>
      <p>${esc(t("r.notPlant.body"))}</p>${photoTipsHtml()}</div>`;
    return;
  }
  if (res.verdict === "unclear") {
    el.innerHTML = `<div class="banner warn"><h3>📷 ${esc(t("r.unclear.title"))}</h3>
      <p>${esc(t("r.unclear.body"))}</p>${photoTipsHtml()}</div>`;
    return;
  }

  let html = "";

  if (res.plant.status === "sure") {
    const p = res.plant;
    const common = p.commonNames.slice(0, 3).join(", ");
    html += `<div class="card">
      <h3>🌿 ${esc(common || p.name)} ${sureBadge(p.probability)}</h3>
      <p class="sci">${esc(p.level === "genus" ? p.genus : p.name)}${p.family ? ` · ${esc(t("r.family", { f: p.family }))}` : ""}</p>
      ${p.level === "genus" ? `<p class="hint">${esc(t("r.genus", { g: p.genus }))}</p>` : ""}
      ${p.description ? `<p>${esc(p.description.slice(0, 420))}${p.description.length > 420 ? "…" : ""}</p>` : ""}
      ${careFacts(p)}
      ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t("r.readMore"))}</a></p>` : ""}
    </div>`;
  } else {
    html += `<div class="banner warn"><h3>🤔 ${esc(t("r.unsurePlant.title"))}</h3>
      <p>${esc(t("r.unsurePlant.body", { p: pct(THRESHOLDS.species) }))}</p>
      ${candidatesHtml(res.plantCandidates, "r.candidates.title", (c) => c.common ? `${c.common} (${c.name})` : c.name)}</div>`;
  }

  if (res.health.status === "healthy") {
    html += `<div class="banner ok"><h3>✅ ${esc(t("r.healthy.title"))} ${sureBadge(res.health.probability)}</h3>
      <p>${esc(t("r.healthy.body"))}</p></div>`;
  } else if (res.health.status === "problem") {
    for (const d of res.diseases) html += diseaseCard(d);
  } else {
    const extra = res.health.status === "unhealthy_unsure" ? t("r.healthUnsure.maybe") : t("r.healthUnsure.unknown");
    html += `<div class="banner warn"><h3>🩺 ${esc(t("r.healthUnsure.title"))}</h3>
      <p>${esc(extra)} ${esc(t("r.healthUnsure.noGuess"))}</p>
      <p>${esc(t("r.healthUnsure.retake"))}</p>
      ${candidatesHtml(res.diseaseCandidates, "r.diseaseCandidates.title", (c) => c.name)}
      ${expertBox("r.healthUnsure.expert")}</div>`;
  }

  if (res.diseases.length && res.diseaseCandidates?.length) {
    html += `<div class="card">${candidatesHtml(res.diseaseCandidates, "r.diseaseCandidates.title", (c) => c.name)}</div>`;
  }
  if (res.sources?.length) html += `<p class="hint">${esc(t("r.source", { s: res.sources.join(" + ") }))}</p>`;
  if (!fromHistory && res.keyMoved) html += `<p class="hint">ℹ️ ${esc(t("err.keyMoved", { service: res.keyMoved === "cropKey" ? "crop.health" : "Plant.id" }))}</p>`;
  if (!fromHistory) for (const w of res.warnings || []) html += `<p class="hint">⚠️ ${esc(t(w.key, w.vars))}</p>`;

  if (!fromHistory) {
    html += `<div class="row space"><button class="btn small" id="share-btn">↗ ${esc(t("r.share"))}</button><button class="btn small" id="new-scan">＋ ${esc(t("r.newScan"))}</button></div>`;
  }
  el.innerHTML = html;

  $("#share-btn", el)?.addEventListener("click", () => shareResult(res));
  $("#new-scan", el)?.addEventListener("click", () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = [];
    lastResult = null;
    renderPhotos();
    el.innerHTML = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function candidatesHtml(list, titleKey, label) {
  if (!list?.length) return "";
  return `<details class="candidates"><summary>${esc(t(titleKey))}</summary>
    <p class="hint">${esc(t("r.candidates.note"))}</p>
    <ul class="fix-list">${list.map((c) => `<li>${esc(label(c))}: ${pct(c.probability)}</li>`).join("")}</ul></details>`;
}

function careFacts(p) {
  const rows = [];
  if (p.watering && typeof p.watering === "object" && p.watering.min != null) {
    const lvl = p.watering.max || p.watering.min;
    if (lvl >= 1 && lvl <= 3) rows.push([t("r.water"), t(`r.water.${lvl}`)]);
  }
  if (p.light) rows.push([t("r.light"), p.light]);
  if (p.soil) rows.push([t("r.soil"), p.soil]);
  if (p.toxicity) rows.push([t("r.toxicity"), p.toxicity]);
  const filtered = rows.filter((r) => r[1]);
  if (!filtered.length) return "";
  return `<table class="guide-table">${filtered.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v).slice(0, 300))}</td></tr>`).join("")}</table>`;
}

function diseaseCard(d) {
  const nutrient = d.deficiency ? matchNutrient(d.deficiency) : null;
  const kinds = (d.classification || []).join(", ");
  let html = `<div class="banner danger"><h3>🩺 ${esc(d.name)} ${sureBadge(d.probability)}</h3>`;
  if (kinds) html += `<p class="hint">${esc(t("r.type", { t: kinds }))}</p>`;
  if (d.description) html += `<p>${esc(d.description.slice(0, 500))}${d.description.length > 500 ? "…" : ""}</p>`;
  if (d.scientific) html += `<p class="sci">${esc(d.scientific)}</p>`;
  if (d.symptoms?.length) html += `<p><strong>${esc(t("r.symptoms"))}</strong> ${esc(d.symptoms.join(" "))}</p>`;
  if (d.cause) html += `<p><strong>${esc(t("r.cause"))}</strong> ${esc(d.cause)}</p>`;

  if (d.deficiency) {
    if (nutrient) {
      html += `<p><strong>${esc(t("r.mineral"))}</strong> ${esc(t(`nut.${nutrient.id}.name`))}</p>
        <p><strong>${esc(t("r.signs"))}</strong> ${esc(t(`nut.${nutrient.id}.signs`))}</p>
        <p><strong>${esc(t("r.firstStep"))}</strong> ${esc(t(`nut.${nutrient.id}.step`))}</p>`;
    } else {
      html += `<p>${esc(t("r.defUnknown"))}</p>`;
    }
  }

  if (d.primaryFix.length) {
    html += `<p><strong>${esc(t("r.primaryFix"))}</strong></p><ul class="fix-list">${d.primaryFix.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  }

  html += expertBox(d.deficiency ? "ex.def" : d.hasChemicalOptions ? "ex.chem" : "ex.spread");
  if (d.url) html += `<p><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(t("r.learnMore"))}</a></p>`;
  html += `</div>`;
  return html;
}

async function shareResult(res) {
  const lines = ["Paudha"];
  if (res.plant.status === "sure") lines.push(`${t("r.plant")}: ${res.plant.commonNames[0] || res.plant.name} (${res.plant.name}), ${t("r.sure", { p: pct(res.plant.probability) })}`);
  else lines.push(`${t("r.plant")}: ${t("r.notSure")}`);
  if (res.health.status === "healthy") lines.push(`${t("r.health")}: ${t("r.healthy.title")}`);
  else if (res.diseases.length) res.diseases.forEach((d) => lines.push(`${t("r.problem")}: ${d.name}, ${t("r.sure", { p: pct(d.probability) })}`));
  else lines.push(`${t("r.health")}: ${t("r.notSure")}`);
  const text = lines.join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Paudha", text });
    else { await navigator.clipboard.writeText(text); toast(t("r.copied")); }
  } catch { /* cancelled */ }
}

/* ---------------- Places & weather ---------------- */
async function searchPlaces(q) {
  const base = "https://geocoding-api.open-meteo.com/v1/search";
  const lang = ["en", "hi", "bn", "mr", "ta", "te", "kn", "ml", "gu", "pa", "or"].includes(getLang()) ? getLang() : "en";
  const url = (cc) => `${base}?${new URLSearchParams({ name: q, count: "8", language: lang, format: "json", ...(cc ? { countryCode: cc } : {}) })}`;
  let res = await fetch(url("IN")).then((r) => r.json());
  if (!res.results?.length) res = await fetch(url("")).then((r) => r.json());
  return res.results || [];
}

$("#place-search-btn").addEventListener("click", doSearch);
$("#place-search").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

async function doSearch() {
  const q = $("#place-search").value.trim();
  const list = $("#place-results");
  if (q.length < 2) return;
  list.innerHTML = `<li class="hint">${esc(t("places.searching"))}</li>`;
  try {
    const results = await searchPlaces(q);
    if (!results.length) { list.innerHTML = `<li class="hint">${esc(t("places.noResults"))}</li>`; return; }
    list.innerHTML = results.map((r, i) => `<li><button data-i="${i}">${esc(r.name)}<span class="place-sub">, ${esc([r.admin2, r.admin1, r.country].filter(Boolean).join(", "))}</span></button></li>`).join("");
    $$("button", list).forEach((b) => b.addEventListener("click", () => {
      const r = results[+b.dataset.i];
      savePlace({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude });
      list.innerHTML = "";
      $("#place-search").value = "";
    }));
  } catch {
    list.innerHTML = `<li class="hint">${esc(t("places.searchFailed"))}</li>`;
  }
}

$("#use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return toast(t("places.noGeo"));
  toast(t("places.gettingLoc"));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      savePlace({ name: t("places.myLocation"), region: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon });
    },
    () => toast(t("places.locFailed")),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

async function savePlace(p) {
  const place = store.addPlace(p);
  syncWorkerState();
  fillPlaceSelect();
  toast(t("places.saved", { name: place.name }));
  await refreshForecast(place);
  renderPlaces();
}

async function refreshForecast(place) {
  try {
    const f = await W.fetchForecast(place.lat, place.lon);
    store.saveForecast(place.id, f);
    return f;
  } catch {
    return null;
  }
}

async function refreshAll({ notify = true } = {}) {
  await Promise.all(store.getPlaces().map(refreshForecast));
  if (currentView === "places") renderPlaces();
  updateBadge();
  if (notify) await sendDueNotifications();
  syncWorkerState();
}

$("#refresh-weather").addEventListener("click", async () => {
  toast(t("places.updating"));
  await refreshAll();
  toast(t("places.updated"));
});

function renderPlaces() {
  fillPlaceSelect();
  updateNotifyButton();
  const places = store.getPlaces();
  const forecasts = store.getForecasts();
  const list = $("#places-list");
  if (!places.length) {
    list.innerHTML = `<div class="card"><p class="muted">${esc(t("places.empty"))}</p></div>`;
    $("#alert-summary").innerHTML = "";
    updateBadge();
    return;
  }

  let total = 0;
  list.innerHTML = places.map((p) => {
    const f = forecasts[p.id];
    const events = f ? W.analyse(f, t) : [];
    const soon = events.filter((e) => e.daysAhead <= 7);
    const later = events.filter((e) => e.daysAhead > 7);
    total += soon.length;
    const hazardDates = new Set(events.map((e) => e.date));
    const today = f ? W.todayIn(f.timezone) : "";

    const strip = f ? `<div class="forecast">${f.days.filter((d) => W.daysBetween(today, d.date) >= 0).slice(0, 10).map((d) => {
      const [icon] = W.WX[d.code] || ["🌡️"];
      return `<div class="day ${hazardDates.has(d.date) ? "hazard" : ""}">
        <div>${esc(fmtDate(d.date, { weekday: "short" }))}</div><div class="wx">${icon}</div>
        <div>${Math.round(d.tmax)}° / ${Math.round(d.tmin)}°</div><div>${d.rain >= 0.5 ? `${Math.round(d.rain)} mm` : "&nbsp;"}</div></div>`;
    }).join("")}</div>` : `<p class="hint">${esc(t("places.noForecast"))}</p>`;

    const alertHtml = (e) => `<div class="alert ${e.severe ? "severe" : ""}">
      <strong>${e.severe ? "🔴" : "🟠"} ${esc(e.title)}: ${esc(W.whenText(e.daysAhead, t))}</strong>
      <span class="when">${esc(e.detail)} · ${esc(fmtDate(e.date, { weekday: "long", day: "numeric", month: "short" }))}${e.lowConfidence ? ` · ${esc(t("places.early"))}` : ""}</span>
      <ul>${e.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`;

    return `<div class="card place-card" data-id="${p.id}">
      <header>
        <div><h3>${esc(p.name)}</h3><div class="place-sub">${esc(p.region || "")}</div></div>
        <button class="icon-btn" data-del="${p.id}" aria-label="${esc(t("places.remove"))}">🗑️</button>
      </header>
      ${strip}
      ${soon.length ? soon.map(alertHtml).join("") : f ? `<p class="hint">✅ ${esc(t("places.noDanger"))}</p>` : ""}
      ${later.length ? `<details><summary class="hint">${esc(t("places.later", { n: later.length }))}</summary>${later.map(alertHtml).join("")}</details>` : ""}
      <div class="plant-tags">${(p.plants || []).map((pl, i) => `<span class="tag">🌱 ${esc(pl)}<button data-rmplant="${i}" aria-label="✕">✕</button></span>`).join("")}</div>
      <div class="row"><input type="text" placeholder="${esc(t("places.addPlantPh"))}" data-plant-input><button class="btn small" data-addplant>${esc(t("places.addPlant"))}</button></div>
      <details><summary class="hint">${esc(t("places.details"))}</summary>
        <label class="field-label">${esc(t("places.name"))}</label><input type="text" data-rename value="${esc(p.name)}">
        <label class="field-label">${esc(t("places.notes"))}</label><textarea rows="3" data-notes placeholder="${esc(t("places.notesPh"))}">${esc(p.notes || "")}</textarea>
        <button class="btn small" data-savedetails style="margin-top:8px">${esc(t("places.save"))}</button>
      </details>
      ${f ? `<p class="hint">${esc(t("places.updatedAt", { when: fmtDateTime(f.fetchedAt) }))}</p>` : ""}
    </div>`;
  }).join("");

  $("#alert-summary").innerHTML = total
    ? `<div class="banner warn"><strong>⚠️ ${esc(t("places.summary", { n: total }))}</strong></div>`
    : "";

  $$(".place-card", list).forEach((card) => {
    const id = card.dataset.id;
    const place = () => store.getPlaces().find((x) => x.id === id);
    $("[data-del]", card).addEventListener("click", () => {
      if (!confirm(t("places.removeQ", { name: place().name }))) return;
      store.removePlace(id);
      syncWorkerState();
      renderPlaces();
    });
    const input = $("[data-plant-input]", card);
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      store.updatePlace(id, { plants: [...(place().plants || []), v] });
      renderPlaces();
    };
    $("[data-addplant]", card).addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    $$("[data-rmplant]", card).forEach((b) => b.addEventListener("click", () => {
      const plants = [...place().plants];
      plants.splice(+b.dataset.rmplant, 1);
      store.updatePlace(id, { plants });
      renderPlaces();
    }));
    $("[data-savedetails]", card).addEventListener("click", () => {
      store.updatePlace(id, { name: $("[data-rename]", card).value.trim() || place().name, notes: $("[data-notes]", card).value });
      syncWorkerState();
      renderPlaces();
      toast(t("places.savedShort"));
    });
  });
  updateBadge();
}

function updateBadge() {
  const forecasts = store.getForecasts();
  let n = 0;
  for (const p of store.getPlaces()) {
    if (forecasts[p.id]) n += W.analyse(forecasts[p.id]).filter((e) => e.daysAhead <= 7).length;
  }
  const b = $("#alert-badge");
  b.hidden = n === 0;
  b.textContent = n > 9 ? "9+" : String(n);
}

/* Notifications */
async function sendDueNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const due = W.dueNotifications(store.getPlaces(), store.getForecasts(), store.getNotified(), t);
  const reg = await navigator.serviceWorker?.getRegistration();
  for (const n of due) {
    const opts = { body: n.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: n.key, data: { url: "./#places" } };
    try {
      if (reg) await reg.showNotification(n.title, opts);
      else new Notification(n.title, opts);
      store.markNotified(n.key);
    } catch { /* ignore */ }
  }
}

$("#enable-notify").addEventListener("click", async () => {
  if (!("Notification" in window)) return toast(t("notify.unsupported"));
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast(t("notify.denied"));
  await registerPeriodicSync();
  updateNotifyButton();
  toast(t("notify.on"));
  await sendDueNotifications();
});

function updateNotifyButton() {
  const on = "Notification" in window && Notification.permission === "granted";
  $("#enable-notify").textContent = `🔔 ${on ? t("places.alertsOn") : t("places.alertsOff")}`;
  $("#enable-notify").disabled = on;
}

async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") await reg.periodicSync.register("paudha-weather", { minInterval: 6 * 60 * 60 * 1000 });
    }
  } catch { /* not supported */ }
}

// The service worker can't read localStorage, so mirror the data it needs.
async function syncWorkerState() {
  try {
    const cache = await caches.open("paudha-data");
    const body = JSON.stringify({ places: store.getPlaces(), notified: store.getNotified(), lang: getLang() });
    await cache.put("data/state.json", new Response(body, { headers: { "Content-Type": "application/json" } }));
  } catch { /* ignore */ }
}

/* ---------------- History ---------------- */
function renderHistory() {
  const list = $("#history-list");
  const items = store.getHistory();
  if (!items.length) {
    list.innerHTML = `<div class="card"><p class="muted">${esc(t("history.empty"))}</p></div>`;
    return;
  }
  list.innerHTML = items.map((h) => {
    const r = h.result;
    const name = r.plant.status === "sure" ? (r.plant.commonNames[0] || r.plant.name) : t("history.unknownPlant");
    const health = r.health.status === "healthy" ? t("history.healthy") : r.diseases?.length ? r.diseases.map((d) => d.name).join(", ") : t("history.unsure");
    return `<div class="card">
      <div class="history-item">
        <img src="${h.thumb}" alt="">
        <div>
          <strong>${esc(name)}</strong><br>${esc(health)}
          <div class="when">${esc(fmtDateTime(h.at))}${h.placeName ? ` · ${esc(h.placeName)}` : ""} · ${esc(h.parts.map(partLabel).join(", "))}</div>
        </div>
      </div>
      <details><summary class="hint">${esc(t("history.full"))}</summary><div data-full="${h.id}"></div></details>
      <button class="btn small danger" data-rmhist="${h.id}">${esc(t("history.delete"))}</button>
    </div>`;
  }).join("");
  $$("details", list).forEach((d) => d.addEventListener("toggle", () => {
    const box = $("[data-full]", d);
    if (d.open && !box.innerHTML) {
      const h = items.find((x) => x.id === box.dataset.full);
      renderResult(h.result, box, { fromHistory: true });
    }
  }));
  $$("[data-rmhist]", list).forEach((b) => b.addEventListener("click", () => { store.removeHistory(b.dataset.rmhist); renderHistory(); }));
}

/* ---------------- Guide ---------------- */
function renderGuide() {
  $("#guide-content").innerHTML = `
    <div class="card">
      <h3>📞 ${esc(t("guide.expert"))}</h3>
      <p>${esc(t("guide.expertBody"))}</p>
      <p><a class="btn primary" href="tel:${HELP.kccPhone}">${esc(t("guide.call", { n: HELP.kccDisplay }))}</a></p>
      <p class="hint">${esc(t("help.kcc"))}</p>
      <ul>${HELP.links.map((l) => `<li><a href="${l.url}" target="_blank" rel="noopener">${esc(t(l.key))}</a></li>`).join("")}</ul>
    </div>
    <div class="card">
      <h3>📸 ${esc(t("guide.photo"))}</h3>
      ${photoTipsHtml()}
    </div>
    <div class="card">
      <h3>🧪 ${esc(t("guide.def"))}</h3>
      <p class="hint">${esc(t("guide.defNote"))}</p>
      <table class="guide-table"><tr><th>${esc(t("guide.mineral"))}</th><th>${esc(t("guide.signs"))}</th></tr>
      ${NUTRIENTS.map((n) => `<tr><td><strong>${esc(t(`nut.${n.id}.name`))}</strong></td><td>${esc(t(`nut.${n.id}.signs`))}</td></tr>`).join("")}</table>
      <p class="hint">${esc(t("guide.defTip"))}</p>
    </div>
    <div class="card">
      <h3>🌦️ ${esc(t("guide.weather"))}</h3>
      <p>${esc(t("guide.weatherIntro"))}</p>
      <ul class="fix-list">${["guide.w1", "guide.w2", "guide.w3", "guide.w4", "guide.w5", "guide.w6"].map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul>
      <p class="hint">${esc(t("guide.weatherNote"))}</p>
    </div>
    <div class="card">
      <h3>ℹ️ ${esc(t("guide.about"))}</h3>
      <p>${esc(t("guide.aboutBody"))}</p>
    </div>`;
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const s = store.getSettings();
  const mode = serviceMode();
  $("#service-status").textContent = mode === "proxy" ? `✅ ${t("settings.proxy")}` : mode === "key" ? `✅ ${t("settings.keyMode")}` : `⚠️ ${t("settings.none")}`;
  $("#api-key").value = s.apiKey ? "••••••••" : "";
  $("#crop-key").value = s.cropKey ? "••••••••" : "";
  $("#threshold-list").innerHTML = [
    t("settings.sure.plant", { p: pct(THRESHOLDS.isPlant) }),
    t("settings.sure.species", { p: pct(THRESHOLDS.species) }),
    t("settings.sure.healthy", { p: pct(THRESHOLDS.healthy) }),
    t("settings.sure.disease", { p: pct(THRESHOLDS.disease) })
  ].map((x) => `<li>${esc(x)}</li>`).join("");
}

$("#save-key").addEventListener("click", () => {
  let changed = false;
  for (const [id, field] of [["#api-key", "apiKey"], ["#crop-key", "cropKey"]]) {
    const v = $(id).value.trim();
    if (v.startsWith("•")) continue;
    if (v !== (store.getSettings()[field] || "")) { store.saveSettings({ [field]: v }); changed = true; }
  }
  if (changed) toast(t("settings.keySaved"));
  renderSettings();
});
$("#clear-history").addEventListener("click", () => {
  if (confirm(t("settings.clearQ"))) { store.clearHistory(); toast(t("settings.cleared")); }
});
$("#export-data").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `paudha-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------------- Language ---------------- */
function fillLangSelects() {
  const opts = LANGS.map((l) => `<option value="${l.code}">${l.name}${l.code === "en" ? "" : ` (${l.en})`}</option>`).join("");
  for (const sel of [$("#app-lang"), $("#top-lang")]) {
    sel.innerHTML = opts;
    sel.value = getLang();
  }
}

// Re-draw everything that is built from JavaScript.
function renderAll() {
  fillLangSelects();
  renderTips();
  renderPhotos();
  renderGuide();
  fillPlaceSelect();
  updateNotifyButton();
  if (lastResult) renderResult(lastResult, $("#result"));
  if (currentView === "places") renderPlaces();
  if (currentView === "history") renderHistory();
  if (currentView === "settings") renderSettings();
}

async function changeLang(code) {
  await setLang(code);
  renderAll();
  syncWorkerState();
}
$("#app-lang").addEventListener("change", (e) => changeLang(e.target.value).then(() => toast(t("settings.saved"))));
$("#top-lang").addEventListener("change", (e) => changeLang(e.target.value));

function showLangPicker() {
  const overlay = document.createElement("div");
  overlay.className = "lang-overlay";
  overlay.innerHTML = `<img src="icons/icon.svg" alt="" style="width:64px;display:block;margin:0 auto">
    <h2>भाषा चुनें · Choose your language</h2>
    <div class="lang-grid">${LANGS.map((l) => `<button data-code="${l.code}">${l.name}<small>${l.en}</small></button>`).join("")}</div>`;
  document.body.appendChild(overlay);
  $$("button", overlay).forEach((b) => b.addEventListener("click", async () => {
    await changeLang(b.dataset.code);
    overlay.remove();
  }));
}

/* ---------------- Start ---------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "notified") e.data.keys.forEach(store.markNotified);
  });
}

(async function start() {
  const saved = store.getSettings().lang;
  await setLang(saved || "en", { save: Boolean(saved) });
  renderAll();
  updateBadge();
  if (!hasChosenLang()) showLangPicker();

  const startView = location.hash.slice(1);
  if (["scan", "places", "history", "guide", "settings"].includes(startView)) showView(startView);

  // Refresh forecasts at most every 3 hours when the app opens.
  const forecasts = store.getForecasts();
  const places = store.getPlaces();
  const lastFetch = Math.min(Date.now(), ...Object.values(forecasts).map((f) => Date.parse(f.fetchedAt)));
  if (places.some((p) => !forecasts[p.id]) || (places.length && Date.now() - lastFetch > 3 * 3600e3)) refreshAll();
  else sendDueNotifications();
})();
