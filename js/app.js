import { loadImage, analyseQuality, toJpeg } from "./quality.js";
import { identify, serviceMode, THRESHOLDS, ServiceNotConfigured } from "./identify.js";
import * as store from "./storage.js";
import { HELP, NUTRIENTS, PHOTO_TIPS, matchNutrient } from "./guide.js";

const W = window.PaudhaWeather;
const MAX_PHOTOS = 5;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p) => `${Math.round(p * 100)}%`;
const PART_LABEL = { leaf: "Leaf", stem: "Stem", root: "Root", whole: "Whole plant", flower: "Flower / fruit" };

function toast(msg, ms = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

/* ---------------- Tabs ---------------- */
function showView(name) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "history") renderHistory();
  if (name === "places") renderPlaces();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0 });
  history.replaceState(null, "", `#${name}`);
}
$$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

/* ---------------- Scan ---------------- */
let selectedPart = "leaf";
let photos = [];

$$("#part-chips .chip").forEach((c) =>
  c.addEventListener("click", () => {
    selectedPart = c.dataset.part;
    $$("#part-chips .chip").forEach((x) => x.classList.toggle("selected", x === c));
  })
);

async function addFiles(files) {
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) {
      toast(`You can add up to ${MAX_PHOTOS} photos.`);
      break;
    }
    if (!file.type.startsWith("image/")) {
      toast("That file is not a photo.");
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
    } catch (e) {
      toast(e.message);
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
      <img src="${p.url}" alt="${esc(PART_LABEL[p.part])} photo">
      <div class="meta">
        <strong>${esc(PART_LABEL[p.part])}</strong>
        ${p.quality.ok ? "✅ Clear photo" : p.quality.problems.map((x) => `⚠️ ${esc(x.text)}`).join("<br>")}
      </div>
      <button class="icon-btn" data-remove="${p.id}" aria-label="Remove photo">✕</button>
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
    ? `Up to ${MAX_PHOTOS} photos. Each photo is checked for blur and light before it is sent.`
    : `${good} clear photo${good === 1 ? "" : "s"} ready${bad ? `, ${bad} will be skipped. Retake ${bad === 1 ? "it" : "them"} for a better result` : ""}.`;
}

function fillPlaceSelect() {
  const sel = $("#scan-place");
  const current = sel.value;
  sel.innerHTML = `<option value="">Not linked to a place</option>` +
    store.getPlaces().map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  sel.value = current;
}

$("#analyse-btn").addEventListener("click", async () => {
  const good = photos.filter((p) => p.quality.ok);
  if (!good.length) return;
  const placeId = $("#scan-place").value;
  const place = store.getPlaces().find((p) => p.id === placeId);
  const result = $("#result");
  result.innerHTML = `<div class="card loading"><div class="spinner"></div>Checking your plant… this can take up to 20 seconds.</div>`;
  result.scrollIntoView({ behavior: "smooth" });
  $("#analyse-btn").disabled = true;

  try {
    const res = await identify(good.map((p) => p.upload), place ? { lat: place.lat, lon: place.lon } : null);
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
    if (e instanceof ServiceNotConfigured) {
      result.innerHTML = `<div class="banner warn"><h3>Service not set up</h3>
        <p>The plant identification service has not been connected yet. Add a Plant.id API key in <a href="#settings" data-goto="settings">Settings</a>.</p></div>`;
      $("[data-goto]", result)?.addEventListener("click", (ev) => { ev.preventDefault(); showView("settings"); });
    } else {
      const offline = !navigator.onLine;
      result.innerHTML = `<div class="banner danger"><h3>Could not check the plant</h3>
        <p>${offline ? "You are offline. Connect to the internet and try again." : esc(e.message || "Something went wrong.")}</p></div>`;
    }
  } finally {
    $("#analyse-btn").disabled = photos.filter((p) => p.quality.ok).length === 0;
  }
});

function expertBox(reason) {
  return `<div class="expert">
    <strong>👩‍🔬 Ask an agricultural expert</strong>
    <p>${esc(reason)}</p>
    <p>📞 <a href="tel:${HELP.kcc.phone}">${HELP.kcc.display}</a>, ${esc(HELP.kcc.label)}<br>
    🏛️ <a href="${HELP.links[0].url}" target="_blank" rel="noopener">${esc(HELP.links[0].label)}</a></p>
  </div>`;
}

function photoTipsHtml() {
  return `<ul class="fix-list">${PHOTO_TIPS.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

function renderResult(res, el, { fromHistory = false } = {}) {
  if (res.verdict === "not_plant") {
    el.innerHTML = `<div class="banner danger"><h3>🚫 This doesn't look like a plant</h3>
      <p>Please take a photo of a real plant: a leaf, stem, root or the whole plant.</p>${photoTipsHtml()}</div>`;
    return;
  }
  if (res.verdict === "unclear") {
    el.innerHTML = `<div class="banner warn"><h3>📷 Photo not clear enough</h3>
      <p>We can't be sure there is a plant clearly visible in the photo, so we won't guess. Please retake it:</p>${photoTipsHtml()}</div>`;
    return;
  }

  let html = "";

  // Plant name
  if (res.plant.status === "sure") {
    const p = res.plant;
    const common = p.commonNames.slice(0, 3).join(", ");
    html += `<div class="card">
      <h3>🌿 ${esc(common || p.name)} <span class="confidence">${pct(p.probability)} sure</span></h3>
      <p class="sci">${esc(p.name)}${p.family ? ` · family ${esc(p.family)}` : ""}</p>
      ${p.description ? `<p>${esc(p.description.slice(0, 420))}${p.description.length > 420 ? "…" : ""}</p>` : ""}
      ${careFacts(p)}
      ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Read more</a></p>` : ""}
    </div>`;
  } else {
    html += `<div class="banner warn"><h3>🤔 Not sure which plant this is</h3>
      <p>The best match was below ${pct(THRESHOLDS.species)} confidence, so we are not naming it. To improve the result, add a photo of the whole plant and a close-up of a leaf${res.plant.best ? "" : ""}, and a flower or fruit if there is one.</p></div>`;
  }

  // Health
  if (res.health.status === "healthy") {
    html += `<div class="banner ok"><h3>✅ Looks healthy <span class="confidence">${pct(res.health.probability)} sure</span></h3>
      <p>No disease, pest or deficiency was found in these photos. Keep an eye on new spots or yellowing.</p></div>`;
  } else if (res.health.status === "problem") {
    for (const d of res.diseases) html += diseaseCard(d);
  } else {
    const extra = res.health.status === "unhealthy_unsure"
      ? "The plant may have a problem, but we can't tell what it is with enough confidence."
      : "We couldn't tell confidently whether the plant is healthy or not.";
    html += `<div class="banner warn"><h3>🩺 Health: not sure</h3><p>${extra} We won't guess a disease or treatment.</p>
      <p>Try close-ups of the affected leaf (top and underside), the stem and the roots.</p>
      ${expertBox("Show the plant or photos to an expert if the symptoms are spreading.")}</div>`;
  }

  if (res.diseases.length && res.uncertainDiseaseCount) {
    html += `<p class="hint">There ${res.uncertainDiseaseCount === 1 ? "was 1 other possible problem" : `were ${res.uncertainDiseaseCount} other possible problems`} below our confidence level. These are not shown.</p>`;
  }

  if (!fromHistory) {
    html += `<div class="row space"><button class="btn small" id="share-btn">↗ Share result</button><button class="btn small" id="new-scan">＋ New scan</button></div>`;
  }
  el.innerHTML = html;

  $("#share-btn", el)?.addEventListener("click", () => shareResult(res));
  $("#new-scan", el)?.addEventListener("click", () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = [];
    renderPhotos();
    el.innerHTML = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function careFacts(p) {
  const rows = [];
  if (p.watering && typeof p.watering === "object" && p.watering.min != null) {
    const lvl = ["", "Dry soil (little water)", "Medium (keep slightly moist)", "Wet (lots of water)"];
    rows.push(["Water", lvl[p.watering.max] || lvl[p.watering.min] || ""]);
  }
  if (p.light) rows.push(["Light", p.light]);
  if (p.soil) rows.push(["Soil", p.soil]);
  if (p.toxicity) rows.push(["Toxicity", p.toxicity]);
  const filtered = rows.filter((r) => r[1]);
  if (!filtered.length) return "";
  return `<table class="guide-table">${filtered.map(([k, v]) => `<tr><th>${k}</th><td>${esc(String(v).slice(0, 300))}</td></tr>`).join("")}</table>`;
}

function diseaseCard(d) {
  const nutrient = d.deficiency ? matchNutrient(d.deficiency) : null;
  const kinds = (d.classification || []).join(", ");
  let html = `<div class="banner danger"><h3>🩺 ${esc(d.name)} <span class="confidence">${pct(d.probability)} sure</span></h3>`;
  if (kinds) html += `<p class="hint">Type: ${esc(kinds)}</p>`;
  if (d.description) html += `<p>${esc(d.description.slice(0, 500))}${d.description.length > 500 ? "…" : ""}</p>`;
  if (d.cause) html += `<p><strong>Cause:</strong> ${esc(d.cause)}</p>`;

  if (d.deficiency) {
    if (nutrient) {
      html += `<p><strong>Mineral needed:</strong> ${esc(nutrient.name)}</p>
        <p><strong>Typical signs:</strong> ${esc(nutrient.signs)}</p>
        <p><strong>First step (no chemicals):</strong> ${esc(nutrient.firstStep)}</p>`;
    } else {
      html += `<p>The photos show a nutrient deficiency, but not which mineral with certainty. A soil test will tell you exactly what is missing.</p>`;
    }
  }

  if (d.primaryFix.length) {
    html += `<p><strong>Primary fix:</strong></p><ul class="fix-list">${d.primaryFix.slice(0, 6).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  }

  html += expertBox(
    d.deficiency
      ? "For the right fertiliser and the amount to use, get a soil test and ask an agricultural scientist. Wrong doses can burn roots or harm the soil."
      : d.hasChemicalOptions
        ? "Chemical treatments exist for this problem. Please don't buy or spray any pesticide, fungicide or fertiliser without advice from an agricultural scientist; they will confirm the problem and give a safe product and dose."
        : "If the problem keeps spreading after the steps above, show the plant to an agricultural scientist."
  );
  if (d.url) html += `<p><a href="${esc(d.url)}" target="_blank" rel="noopener">Learn more</a></p>`;
  html += `</div>`;
  return html;
}

async function shareResult(res) {
  const lines = ["Paudha plant check"];
  if (res.plant.status === "sure") lines.push(`Plant: ${res.plant.commonNames[0] || res.plant.name} (${res.plant.name}), ${pct(res.plant.probability)} sure`);
  else lines.push("Plant: not sure");
  if (res.health.status === "healthy") lines.push("Health: looks healthy");
  else if (res.diseases.length) res.diseases.forEach((d) => lines.push(`Problem: ${d.name}, ${pct(d.probability)} sure`));
  else lines.push("Health: not sure");
  const text = lines.join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Paudha plant check", text });
    else { await navigator.clipboard.writeText(text); toast("Result copied."); }
  } catch { /* cancelled */ }
}

/* ---------------- Places & weather ---------------- */
async function searchPlaces(q) {
  const base = "https://geocoding-api.open-meteo.com/v1/search";
  const url = (cc) => `${base}?${new URLSearchParams({ name: q, count: "8", language: "en", format: "json", ...(cc ? { countryCode: cc } : {}) })}`;
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
  list.innerHTML = `<li class="hint">Searching…</li>`;
  try {
    const results = await searchPlaces(q);
    if (!results.length) { list.innerHTML = `<li class="hint">No places found. Try the nearest town, or use your current location.</li>`; return; }
    list.innerHTML = results.map((r, i) => `<li><button data-i="${i}">${esc(r.name)}<span class="place-sub">, ${esc([r.admin2, r.admin1, r.country].filter(Boolean).join(", "))}</span></button></li>`).join("");
    $$("button", list).forEach((b) => b.addEventListener("click", () => {
      const r = results[+b.dataset.i];
      savePlace({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude });
      list.innerHTML = "";
      $("#place-search").value = "";
    }));
  } catch {
    list.innerHTML = `<li class="hint">Search failed. Check your internet connection.</li>`;
  }
}

$("#use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Location is not available on this device.");
  toast("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      savePlace({ name: "My plants here", region: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon });
    },
    () => toast("Couldn't get your location. Allow location access, or search by name."),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

async function savePlace(p) {
  const place = store.addPlace(p);
  syncPlacesForWorker();
  fillPlaceSelect();
  toast(`Saved ${place.name}.`);
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
  const places = store.getPlaces();
  await Promise.all(places.map(refreshForecast));
  renderPlaces();
  updateBadge();
  if (notify) await sendDueNotifications();
  syncPlacesForWorker();
}

$("#refresh-weather").addEventListener("click", async () => {
  toast("Updating forecasts…");
  await refreshAll();
  toast("Forecasts updated.");
});

function renderPlaces() {
  fillPlaceSelect();
  const places = store.getPlaces();
  const forecasts = store.getForecasts();
  const list = $("#places-list");
  if (!places.length) {
    list.innerHTML = `<div class="card"><p class="muted">No places saved yet. Add your garden, farm or balcony above.</p></div>`;
    $("#alert-summary").innerHTML = "";
    return;
  }

  let total = 0;
  list.innerHTML = places.map((p) => {
    const f = forecasts[p.id];
    const events = f ? W.analyse(f) : [];
    const soon = events.filter((e) => e.daysAhead <= 7);
    const later = events.filter((e) => e.daysAhead > 7);
    total += soon.length;
    const hazardDates = new Set(events.map((e) => e.date));
    const today = f ? W.todayIn(f.timezone) : "";

    const strip = f ? `<div class="forecast">${f.days.filter((d) => W.daysBetween(today, d.date) >= 0).slice(0, 10).map((d) => {
      const [icon, label] = W.WX[d.code] || ["🌡️", ""];
      const dt = new Date(d.date + "T00:00:00");
      return `<div class="day ${hazardDates.has(d.date) ? "hazard" : ""}" title="${esc(label)}">
        <div>${dt.toLocaleDateString(undefined, { weekday: "short" })}</div><div class="wx">${icon}</div>
        <div>${Math.round(d.tmax)}° / ${Math.round(d.tmin)}°</div><div>${d.rain >= 0.5 ? `${Math.round(d.rain)} mm` : "&nbsp;"}</div></div>`;
    }).join("")}</div>` : `<p class="hint">Forecast not loaded yet.</p>`;

    const alertHtml = (e) => `<div class="alert ${e.severe ? "severe" : ""}">
      <strong>${e.severe ? "🔴" : "🟠"} ${esc(e.title)}: ${W.whenText(e.daysAhead)}</strong>
      <span class="when">${esc(e.detail)} · ${new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}${e.lowConfidence ? " · early forecast, may change" : ""}</span>
      <ul>${e.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`;

    return `<div class="card place-card" data-id="${p.id}">
      <header>
        <div><h3>${esc(p.name)}</h3><div class="place-sub">${esc(p.region || "")}</div></div>
        <button class="icon-btn" data-del="${p.id}" aria-label="Remove place">🗑️</button>
      </header>
      ${strip}
      ${soon.length ? soon.map(alertHtml).join("") : f ? `<p class="hint">✅ No weather danger for your plants in the next 7 days.</p>` : ""}
      ${later.length ? `<details><summary class="hint">${later.length} possible later event${later.length > 1 ? "s" : ""} (8 to 16 days, less certain)</summary>${later.map(alertHtml).join("")}</details>` : ""}
      <div class="plant-tags">${(p.plants || []).map((pl, i) => `<span class="tag">🌱 ${esc(pl)}<button data-rmplant="${i}" aria-label="Remove">✕</button></span>`).join("")}</div>
      <div class="row"><input type="text" placeholder="Add a plant here (e.g. Tomato, Tulsi)" data-plant-input><button class="btn small" data-addplant>Add</button></div>
      <details><summary class="hint">Rename or add notes</summary>
        <label class="field-label">Name</label><input type="text" data-rename value="${esc(p.name)}">
        <label class="field-label">Notes</label><textarea rows="3" data-notes placeholder="Soil type, when you last added compost, etc.">${esc(p.notes || "")}</textarea>
        <button class="btn small" data-savedetails style="margin-top:8px">Save</button>
      </details>
      ${f ? `<p class="hint">Updated ${new Date(f.fetchedAt).toLocaleString()} · weather data from Open-Meteo</p>` : ""}
    </div>`;
  }).join("");

  $("#alert-summary").innerHTML = total
    ? `<div class="banner warn"><strong>⚠️ ${total} weather warning${total > 1 ? "s" : ""} in the next 7 days</strong> for your saved places. Details below.</div>`
    : "";

  $$(".place-card", list).forEach((card) => {
    const id = card.dataset.id;
    const place = () => store.getPlaces().find((x) => x.id === id);
    $("[data-del]", card).addEventListener("click", () => {
      if (!confirm(`Remove ${place().name}?`)) return;
      store.removePlace(id);
      syncPlacesForWorker();
      renderPlaces();
      updateBadge();
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
      syncPlacesForWorker();
      renderPlaces();
      toast("Saved.");
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
  const due = W.dueNotifications(store.getPlaces(), store.getForecasts(), store.getNotified());
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
  if (!("Notification" in window)) return toast("This browser can't show alerts. The warnings will still appear in the app.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("Alerts are off. You can still see warnings here.");
  await registerPeriodicSync();
  updateNotifyButton();
  toast("Alerts on. You'll be warned 7, 5, 3, 2 and 1 day before bad weather.");
  await sendDueNotifications();
});

function updateNotifyButton() {
  const on = "Notification" in window && Notification.permission === "granted";
  $("#enable-notify").textContent = on ? "🔔 Alerts on" : "🔔 Turn on alerts";
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
async function syncPlacesForWorker() {
  try {
    const cache = await caches.open("paudha-data");
    const body = JSON.stringify({ places: store.getPlaces(), notified: store.getNotified() });
    await cache.put("data/state.json", new Response(body, { headers: { "Content-Type": "application/json" } }));
  } catch { /* ignore */ }
}

/* ---------------- History ---------------- */
function renderHistory() {
  const list = $("#history-list");
  const items = store.getHistory();
  if (!items.length) {
    list.innerHTML = `<div class="card"><p class="muted">No scans yet.</p></div>`;
    return;
  }
  list.innerHTML = items.map((h) => {
    const r = h.result;
    const name = r.plant.status === "sure" ? (r.plant.commonNames[0] || r.plant.name) : "Plant not identified";
    const health = r.health.status === "healthy" ? "Looks healthy" : r.diseases?.length ? r.diseases.map((d) => d.name).join(", ") : "Health not sure";
    return `<div class="card">
      <div class="history-item">
        <img src="${h.thumb}" alt="">
        <div>
          <strong>${esc(name)}</strong><br>${esc(health)}
          <div class="when">${new Date(h.at).toLocaleString()}${h.placeName ? ` · ${esc(h.placeName)}` : ""} · ${h.parts.map((p) => PART_LABEL[p]).join(", ")}</div>
        </div>
      </div>
      <details><summary class="hint">Show full result</summary><div data-full="${h.id}"></div></details>
      <button class="btn small danger" data-rmhist="${h.id}">Delete</button>
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
  const rules = W.RULES;
  $("#guide-content").innerHTML = `
    <div class="card">
      <h3>📞 Talk to an expert</h3>
      <p>Paudha never prescribes chemicals or fertiliser doses. For those, please talk to an agricultural scientist:</p>
      <p><a class="btn primary" href="tel:${HELP.kcc.phone}">Call ${HELP.kcc.display}</a></p>
      <p class="hint">${esc(HELP.kcc.label)}</p>
      <ul>${HELP.links.map((l) => `<li><a href="${l.url}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul>
    </div>
    <div class="card">
      <h3>📸 Taking a good photo</h3>
      <ul class="fix-list">${PHOTO_TIPS.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>
    <div class="card">
      <h3>🧪 Signs of mineral deficiency</h3>
      <p class="hint">For learning only. Several problems look alike, so confirm with a soil test or an expert before adding anything.</p>
      <table class="guide-table"><tr><th>Mineral</th><th>Signs</th></tr>
      ${NUTRIENTS.map((n) => `<tr><td><strong>${esc(n.name)}</strong></td><td>${esc(n.signs)}</td></tr>`).join("")}</table>
      <p class="hint">Tip: problems on <strong>older</strong> leaves first usually point to nitrogen, phosphorus, potassium or magnesium. Problems on <strong>new</strong> leaves first point to iron, zinc, calcium, sulphur, boron or manganese.</p>
    </div>
    <div class="card">
      <h3>🌦️ When we warn you</h3>
      <p>We check the 16-day forecast for each saved place and alert you ${W.MILESTONES.join(", ")} day(s) before:</p>
      <ul class="fix-list">
        <li>Heavy rain: 64.5 mm or more in a day (IMD "heavy"); very heavy from 115.6 mm, extremely heavy from 204.5 mm</li>
        <li>Heatwave: 40°C or more; severe from 45°C</li>
        <li>Cold night: 6°C or less; frost risk at 2°C or less</li>
        <li>Thunderstorms and hail</li>
        <li>Strong wind gusts: 60 km/h or more; damaging from 90 km/h</li>
        <li>Long dry spell: 7+ hot days (35°C+) in a row with no rain</li>
      </ul>
      <p class="hint">Forecasts more than a week ahead can change. For official warnings, check IMD. ${rules.length} weather rules active.</p>
    </div>
    <div class="card">
      <h3>ℹ️ About the results</h3>
      <p>Photos are analysed by the Plant.id service. Paudha only shows a name, disease or deficiency when the analysis is very confident. Results are a guide, not a lab test.</p>
    </div>`;
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const s = store.getSettings();
  const mode = serviceMode();
  $("#service-status").textContent = mode === "proxy"
    ? "✅ Connected through this app's server. No key needed."
    : mode === "key" ? "✅ Using the API key saved on this phone." : "⚠️ Service not set up. Paste a Plant.id API key below.";
  $("#api-key").value = s.apiKey ? "••••••••" : "";
  $("#name-lang").value = s.nameLang || "en";
  $("#threshold-list").innerHTML = `
    <li>Photo shows a plant: ${pct(THRESHOLDS.isPlant)}</li>
    <li>Plant name: ${pct(THRESHOLDS.species)}</li>
    <li>"Looks healthy": ${pct(THRESHOLDS.healthy)}</li>
    <li>Disease, pest or deficiency: ${pct(THRESHOLDS.disease)}</li>`;
}

$("#save-key").addEventListener("click", () => {
  const v = $("#api-key").value.trim();
  if (v && !v.startsWith("•")) { store.saveSettings({ apiKey: v }); toast("Key saved on this phone."); }
  else if (!v) { store.saveSettings({ apiKey: "" }); toast("Key removed."); }
  renderSettings();
});
$("#name-lang").addEventListener("change", (e) => { store.saveSettings({ nameLang: e.target.value }); toast("Saved."); });
$("#clear-history").addEventListener("click", () => {
  if (confirm("Delete all saved scans?")) { store.clearHistory(); toast("History cleared."); }
});
$("#export-data").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `paudha-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------------- Start ---------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "notified") e.data.keys.forEach(store.markNotified);
  });
}

renderGuide();
renderPhotos();
fillPlaceSelect();
updateNotifyButton();
updateBadge();
const start = location.hash.slice(1);
if (["scan", "places", "history", "guide", "settings"].includes(start)) showView(start);

// Refresh forecasts at most every 3 hours when the app opens.
const lastFetch = Math.min(...Object.values(store.getForecasts()).map((f) => Date.parse(f.fetchedAt)), Date.now());
if (store.getPlaces().length && Date.now() - lastFetch > 3 * 3600e3 || store.getPlaces().some((p) => !store.getForecasts()[p.id])) {
  refreshAll();
} else {
  sendDueNotifications();
}

