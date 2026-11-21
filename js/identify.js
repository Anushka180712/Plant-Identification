// Talks to Kindwise services and turns their answers into "sure / not sure":
//  - Plant.id: plant identification + general plant health (house, garden, trees)
//  - crop.health (optional): crop identification + crop diseases (wheat, rice,
//    cotton, vegetables...), which is far better for field crops.
// Nothing is shown as an answer unless it clears the thresholds below.
// Lower-scoring candidates are returned separately as "possible matches".

import { getSettings, saveSettings } from "./storage.js";

export const THRESHOLDS = {
  isPlant: 0.80,     // photo really shows a plant
  species: 0.80,     // plant name (species, or genus when species are split)
  healthy: 0.80,     // "looks healthy"
  disease: 0.75      // disease / pest / deficiency
};
const CANDIDATE_MIN = 0.10;   // smallest score worth listing as a possible match

const PLANT_ID_URL = "https://plant.id/api/v3/identification";
const CROP_URL = "https://crop.kindwise.com/api/v1/identification";
const PLANT_DETAILS = [
  "common_names", "url", "description", "taxonomy", "watering", "best_light_condition",
  "best_soil_type", "common_uses", "toxicity",
  "local_name", "treatment", "classification", "cause"
].join(",");
const PLANT_MIN_DETAILS = "common_names,url,description,treatment,cause";
const CROP_DETAILS = "common_names,type,description,treatment,symptoms,severity,spreading,wiki_url";

export class ServiceNotConfigured extends Error {}
export class ApiError extends Error {
  constructor(key, vars) { super(key); this.key = key; this.vars = vars; }
}

const API_LANGS = ["en", "hi", "bn", "mr", "ta", "te", "kn", "ml", "gu", "pa", "or"];

function endpoint(kind) {
  const cfg = window.PAUDHA_CONFIG || {};
  const s = getSettings();
  if (kind === "plant") {
    if (cfg.proxyUrl) return { url: cfg.proxyUrl };
    if (s.apiKey) return { url: PLANT_ID_URL, key: cleanKey(s.apiKey), field: "apiKey" };
  } else {
    if (cfg.cropProxyUrl) return { url: cfg.cropProxyUrl };
    if (s.cropKey) return { url: CROP_URL, key: cleanKey(s.cropKey), field: "cropKey" };
  }
  return null;
}

const cleanKey = (k) => String(k || "").replace(/[\s"'`]/g, "");

export function serviceMode() {
  const cfg = window.PAUDHA_CONFIG || {};
  if (cfg.proxyUrl || cfg.cropProxyUrl) return "proxy";
  const s = getSettings();
  if (s.apiKey || s.cropKey) return "key";
  return "none";
}
export const cropEnabled = () => Boolean(endpoint("crop"));

const SERVICE_NAME = { [PLANT_ID_URL]: "Plant.id", [CROP_URL]: "crop.health" };

async function post(ep, params, body) {
  const headers = { "Content-Type": "application/json" };
  if (ep.key) headers["Api-Key"] = ep.key;
  const res = await fetch(`${ep.url}?${new URLSearchParams(params)}`, { method: "POST", headers, body: JSON.stringify(body) });
  const service = SERVICE_NAME[ep.url] || "server";
  if (res.status === 401 || res.status === 403) {
    let reason = "";
    try { reason = (await res.clone().text()).slice(0, 120); } catch { /* ignore */ }
    throw new ApiError("err.badKeyFor", { service, reason, status: res.status, field: ep.field });
  }
  if (res.status === 429) throw new ApiError("err.creditsFor", { service });
  return res;
}

async function callPlantId(ep, images, location, language) {
  const body = { images, similar_images: true, health: "all", classification_level: "species" };
  if (location) { body.latitude = location.lat; body.longitude = location.lon; }
  let res = await post(ep, { details: PLANT_DETAILS, language }, body);
  if (res.status === 400) res = await post(ep, { details: PLANT_MIN_DETAILS, language }, body);
  if (res.status === 400 && language !== "en") res = await post(ep, { details: PLANT_MIN_DETAILS, language: "en" }, body);
  if (!res.ok) throw new ApiError("err.service", { status: res.status });
  return res.json();
}

async function callCrop(ep, images, location, language) {
  const body = { images, similar_images: true };
  if (location) { body.latitude = location.lat; body.longitude = location.lon; }
  let res = await post(ep, { details: CROP_DETAILS, language }, body);
  if (res.status === 400) res = await post(ep, { details: CROP_DETAILS, language: "en" }, body);
  if (res.status === 400) res = await post(ep, { details: "common_names,description,treatment", language: "en" }, body);
  if (!res.ok) throw new ApiError("err.service", { status: res.status });
  return res.json();
}

const isKeyError = (r) => r?.status === "rejected" && r.reason?.key === "err.badKeyFor";

export async function identify(images, location) {
  let plantEp = endpoint("plant");
  let cropEp = endpoint("crop");
  if (!plantEp && !cropEp) throw new ServiceNotConfigured();
  const lang = API_LANGS.includes(getSettings().lang) ? getSettings().lang : "en";

  const run = (pe, ce) => Promise.allSettled([
    pe ? callPlantId(pe, images, location, lang) : Promise.resolve(null),
    ce ? callCrop(ce, images, location, lang) : Promise.resolve(null)
  ]);
  let [plantRes, cropRes] = await run(plantEp, cropEp);

  // A Kindwise key only works for its own product. If a key was pasted into
  // the wrong box, try it on the other service and move it there if it works.
  const keyMoves = [];
  if (isKeyError(plantRes) && plantEp?.key && !cropEp) {
    const ep = { url: CROP_URL, key: plantEp.key, field: "cropKey" };
    const r = (await Promise.allSettled([callCrop(ep, images, location, lang)]))[0];
    if (r.status === "fulfilled") { cropRes = r; plantRes = { status: "fulfilled", value: null }; keyMoves.push(["apiKey", "cropKey", plantEp.key]); }
  } else if (isKeyError(cropRes) && cropEp?.key && !plantEp) {
    const ep = { url: PLANT_ID_URL, key: cropEp.key, field: "apiKey" };
    const r = (await Promise.allSettled([callPlantId(ep, images, location, lang)]))[0];
    if (r.status === "fulfilled") { plantRes = r; cropRes = { status: "fulfilled", value: null }; keyMoves.push(["cropKey", "apiKey", cropEp.key]); }
  }
  if (keyMoves.length) {
    const [from, to, key] = keyMoves[0];
    saveSettings({ [from]: "", [to]: key });
  }

  const plantData = plantRes.status === "fulfilled" ? plantRes.value : null;
  const cropData = cropRes.status === "fulfilled" ? cropRes.value : null;
  if (!plantData && !cropData) throw (plantRes.reason || cropRes.reason);

  const out = merge(plantData ? interpret(plantData) : null, cropData ? interpretCrop(cropData) : null);
  out.warnings = [plantRes, cropRes].filter((r) => r.status === "rejected" && r.reason instanceof ApiError).map((r) => ({ key: r.reason.key, vars: r.reason.vars }));
  if (keyMoves.length) out.keyMoved = keyMoves[0][1];
  return out;
}

/* ---------- shared helpers ---------- */

const CHEMICAL_WORDS = /(fungicid|insecticid|pesticid|herbicid|bactericid|miticid|acaricid|nematicid|fertili[sz]|chemical|copper|sulph|sulfur|mancozeb|carbendazim|propiconazole|tebuconazole|hexaconazole|chlorpyrifos|imidacloprid|glyphosate|urea|npk|dap\b|potash|spray|dose|ml\/|g\/l|per litre|per liter)/i;

function splitAdvice(list) {
  const safe = [], needsExpert = [];
  for (const item of list || []) {
    if (typeof item !== "string" || /^\s*(none|n\/a|no\b.*known)/i.test(item)) continue;
    (CHEMICAL_WORDS.test(item) ? needsExpert : safe).push(item);
  }
  return { safe, needsExpert };
}

const textOf = (v) => (typeof v === "string" ? v : v?.value || "");
const genusOf = (name) => String(name || "").trim().split(/\s+/)[0];

function emptyResult() {
  return {
    verdict: "plant",
    plant: { status: "unsure" },
    health: { status: "unsure" },
    diseases: [],
    uncertainDiseaseCount: 0,
    plantCandidates: [],
    diseaseCandidates: [],
    sources: []
  };
}

function diseaseFrom(name, scientific, probability, d, source) {
  const treatment = d.treatment || {};
  const bio = splitAdvice(treatment.biological);
  const prevention = splitAdvice(treatment.prevention);
  const label = `${name} ${scientific}`;
  return {
    name,
    scientific: scientific !== name ? scientific : "",
    probability,
    description: textOf(d.description) || textOf(d.wiki_description),
    symptoms: d.symptoms ? Object.values(d.symptoms).filter((x) => typeof x === "string").slice(0, 3) : [],
    cause: d.cause || "",
    url: d.url || d.wiki_url || "",
    classification: d.classification || (d.type ? [d.type] : []),
    primaryFix: [...bio.safe, ...prevention.safe],
    hasChemicalOptions: (treatment.chemical || []).length > 0 || bio.needsExpert.length > 0 || prevention.needsExpert.length > 0,
    deficiency: /deficien/i.test(label) ? label : null,
    source
  };
}

/* ---------- Plant.id ---------- */

export function interpret(data) {
  const r = data.result || {};
  const out = emptyResult();
  out.sources.push("plant.id");

  const isPlant = r.is_plant || {};
  out.isPlantProbability = isPlant.probability ?? null;
  if (isPlant.probability != null && isPlant.probability < 0.5) { out.verdict = "not_plant"; return out; }
  if (isPlant.probability != null && isPlant.probability < THRESHOLDS.isPlant) { out.verdict = "unclear"; return out; }

  // --- Species, then genus if close species split the score ---
  const suggestions = r.classification?.suggestions || [];
  const top = suggestions[0];
  const plantFrom = (s, extra = {}) => {
    const d = s.details || {};
    return {
      status: "sure",
      name: s.name,
      probability: s.probability,
      commonNames: d.common_names || [],
      description: textOf(d.description),
      url: d.url || "",
      watering: d.watering || null,
      light: d.best_light_condition || "",
      soil: d.best_soil_type || "",
      toxicity: d.toxicity || "",
      family: d.taxonomy?.family || "",
      ...extra
    };
  };
  if (top && top.probability >= THRESHOLDS.species) {
    out.plant = plantFrom(top);
  } else if (suggestions.length) {
    const genera = {};
    for (const s of suggestions) {
      const g = genusOf(s.name);
      (genera[g] = genera[g] || { sum: 0, best: s }).sum += s.probability;
    }
    const [genus, info] = Object.entries(genera).sort((a, b) => b[1].sum - a[1].sum)[0];
    if (info.sum >= THRESHOLDS.species) {
      out.plant = plantFrom(info.best, { level: "genus", genus, probability: Math.min(info.sum, 1) });
    }
  }
  out.plantCandidates = suggestions
    .filter((s) => s.probability >= CANDIDATE_MIN)
    .slice(0, 3)
    .map((s) => ({ name: s.name, common: s.details?.common_names?.[0] || "", probability: s.probability }));

  // --- Health ---
  const healthy = r.is_healthy || {};
  out.healthyProbability = healthy.probability ?? null;
  for (const s of r.disease?.suggestions || []) {
    const d = s.details || {};
    if (s.probability >= THRESHOLDS.disease) {
      out.diseases.push(diseaseFrom(d.local_name || s.name, s.name, s.probability, d, "plant.id"));
    } else if (s.probability >= CANDIDATE_MIN) {
      out.diseaseCandidates.push({ name: d.local_name || s.name, probability: s.probability });
      if (s.probability >= 0.3) out.uncertainDiseaseCount++;
    }
  }
  return finishHealth(out);
}

/* ---------- crop.health ---------- */

export function interpretCrop(data) {
  const r = data.result || {};
  const out = emptyResult();
  out.sources.push("crop.health");

  const isPlant = r.is_plant || {};
  out.isPlantProbability = isPlant.probability ?? null;
  if (isPlant.probability != null && isPlant.probability < 0.5) { out.verdict = "not_plant"; return out; }
  if (isPlant.probability != null && isPlant.probability < THRESHOLDS.isPlant) { out.verdict = "unclear"; return out; }

  const crops = r.crop?.suggestions || [];
  const top = crops[0];
  if (top && top.probability >= THRESHOLDS.species) {
    out.plant = {
      status: "sure",
      name: top.scientific_name || top.name,
      probability: top.probability,
      commonNames: top.details?.common_names?.length ? top.details.common_names : [top.name],
      description: textOf(top.details?.description),
      url: top.details?.wiki_url || "",
      isCrop: true
    };
  }
  out.plantCandidates = crops
    .filter((s) => s.probability >= CANDIDATE_MIN)
    .slice(0, 3)
    .map((s) => ({ name: s.scientific_name || s.name, common: s.name, probability: s.probability }));

  for (const s of r.disease?.suggestions || []) {
    const d = s.details || {};
    const name = d.common_names?.[0] || s.name;
    // "healthy" is a class in crop.health
    if (/^healthy$/i.test(s.name)) {
      if (s.probability >= THRESHOLDS.healthy) out.cropHealthy = s.probability;
      continue;
    }
    if (s.probability >= THRESHOLDS.disease) {
      out.diseases.push(diseaseFrom(name, s.scientific_name || s.name, s.probability, d, "crop.health"));
    } else if (s.probability >= CANDIDATE_MIN) {
      out.diseaseCandidates.push({ name, probability: s.probability });
      if (s.probability >= 0.3) out.uncertainDiseaseCount++;
    }
  }
  if (out.cropHealthy && !out.diseases.length) out.healthyProbability = out.cropHealthy;
  return finishHealth(out);
}

function finishHealth(out) {
  const hp = out.healthyProbability;
  if (out.diseases.length) out.health = { status: "problem" };
  else if (hp != null && hp >= THRESHOLDS.healthy) out.health = { status: "healthy", probability: hp };
  else if (hp != null && hp <= 1 - THRESHOLDS.healthy) out.health = { status: "unhealthy_unsure" };
  else out.health = { status: "unsure" };
  return out;
}

/* ---------- combine both services ---------- */

export function merge(p, c) {
  if (!p) return c;
  if (!c) return p;
  // If either service is confident there is a plant, trust that.
  if (p.verdict !== "plant" && c.verdict === "plant") return c;
  if (c.verdict !== "plant") return p;

  const out = emptyResult();
  out.sources = [...p.sources, ...c.sources];

  // Plant name: keep the more confident sure answer (species beats genus at equal score).
  const sure = [p.plant, c.plant].filter((x) => x.status === "sure")
    .sort((a, b) => (b.level === "genus" ? b.probability - 0.05 : b.probability) - (a.level === "genus" ? a.probability - 0.05 : a.probability));
  out.plant = sure[0] || { status: "unsure" };
  if (out.plant.isCrop && p.plant.status === "sure" && genusOf(p.plant.name) === genusOf(out.plant.name)) {
    // Use Plant.id's richer care details for the same plant.
    out.plant = { ...p.plant, ...out.plant, level: undefined, genus: undefined, family: p.plant.family, description: out.plant.description || p.plant.description };
  }
  out.plantCandidates = [...c.plantCandidates, ...p.plantCandidates]
    .sort((a, b) => b.probability - a.probability).slice(0, 3);

  // Diseases: crop.health first (specialist), then Plant.id ones not already listed.
  const seen = new Set();
  for (const d of [...c.diseases, ...p.diseases]) {
    const key = (d.scientific || d.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.diseases.push(d);
  }
  out.diseaseCandidates = [...c.diseaseCandidates, ...p.diseaseCandidates]
    .filter((x) => !seen.has(x.name.toLowerCase()))
    .sort((a, b) => b.probability - a.probability).slice(0, 3);
  out.uncertainDiseaseCount = c.uncertainDiseaseCount + p.uncertainDiseaseCount;

  // Healthy only if no service found a confident problem.
  out.healthyProbability = Math.min(p.healthyProbability ?? 1, c.healthyProbability ?? 1);
  if (p.healthyProbability == null && c.healthyProbability == null) out.healthyProbability = null;
  return finishHealth(out);
}
