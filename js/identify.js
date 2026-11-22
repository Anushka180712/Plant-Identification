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
// Two independent checks that each rank the same answer first, each with at
// least this score, confirm it even when neither alone clears the bar above.
const AGREE_MIN = 0.25;
const GEMINI_MIN = 0.70;      // the AI second opinion must itself be this confident

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

/* ---------- Gemini second opinion (never used on its own) ---------- */

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];
const GEMINI_PROMPT = `You are a plant pathologist in India. Look at these photos of one plant.
Answer in JSON only. Use English scientific and common names.
- plant_scientific: species binomial (e.g. "Triticum aestivum"), or genus only if unsure of species, or "" if you cannot tell.
- plant_common: common English name, or "".
- plant_confidence: 0 to 1, how sure you are of the plant.
- problem_type: one of "disease", "pest", "deficiency", "abiotic", "healthy", "unknown".
- problem_common: common English name of the main problem (e.g. "yellow rust"), or "".
- problem_scientific: scientific name of the pathogen or pest (e.g. "Puccinia striiformis"), or "".
- problem_confidence: 0 to 1, how sure you are of the problem.
Be honest: if the photos do not show enough, give a low confidence instead of guessing.`;

export const geminiEnabled = () => Boolean(cleanKey(getSettings().geminiKey) || window.PAUDHA_CONFIG?.geminiProxyUrl);

async function callGemini(images) {
  const cfg = window.PAUDHA_CONFIG || {};
  const key = cleanKey(getSettings().geminiKey);
  const parts = [{ text: GEMINI_PROMPT }, ...images.map((img) => ({
    inline_data: { mime_type: "image/jpeg", data: img.replace(/^data:[^,]+,/, "") }
  }))];
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } });
  let res;
  for (const model of GEMINI_MODELS) {
    const url = cfg.geminiProxyUrl || `${GEMINI_URL}${model}:generateContent`;
    const headers = { "Content-Type": "application/json" };
    if (!cfg.geminiProxyUrl) headers["x-goog-api-key"] = key;
    res = await fetch(url, { method: "POST", headers, body });
    if (res.status !== 404 || cfg.geminiProxyUrl) break;
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const txt = await res.text().catch(() => "");
    if (res.status !== 400 || /api.?key/i.test(txt)) throw new ApiError("err.geminiKey", { status: res.status });
  }
  if (res.status === 429) throw new ApiError("err.creditsFor", { service: "Gemini" });
  if (!res.ok) throw new ApiError("err.service", { status: res.status });
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("");
  return parseOpinion(text);
}

export function parseOpinion(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const num = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    return {
      plantScientific: String(o.plant_scientific || ""),
      plantCommon: String(o.plant_common || ""),
      plantConfidence: num(o.plant_confidence),
      problemType: String(o.problem_type || "unknown").toLowerCase(),
      problemCommon: String(o.problem_common || ""),
      problemScientific: String(o.problem_scientific || ""),
      problemConfidence: num(o.problem_confidence)
    };
  } catch { return null; }
}

// Uses the AI opinion only to confirm what a Kindwise service already ranked first.
export function corroborate(out, op) {
  if (!op || out.verdict !== "plant") return out;
  out.sources = [...out.sources, "Gemini"];

  if (out.plant.status !== "sure" && (op.plantScientific || op.plantCommon) && op.plantConfidence >= GEMINI_MIN) {
    const g = genusOf(op.plantScientific).toLowerCase();
    const common = norm(op.plantCommon);
    const match = findAgreeing(out.plantCandidates, op.plantConfidence, (c) =>
      (g && genusOf(c.name).toLowerCase() === g) || (common && norm(c.common) === common));
    if (match) out.plant = confirmedPlant(match, { name: op.plantScientific || match.name }, [match.source, "Gemini"]);
  }

  if (!out.diseases.length && op.problemConfidence >= GEMINI_MIN && /disease|pest|deficiency/.test(op.problemType)) {
    const ai = { name: op.problemCommon, scientific: op.problemScientific };
    const match = findAgreeing(out.diseaseCandidates, op.problemConfidence, (c) => sameProblem(c, ai));
    if (match) {
      out.diseases.push(confirmedDisease(match, [match.source, "Gemini"]));
      out.diseaseCandidates = out.diseaseCandidates.filter((c) => c !== match);
      out.health = { status: "problem" };
    }
  }
  if (!out.diseases.length && op.problemType === "healthy" && op.problemConfidence >= 0.85
      && out.healthyProbability != null && out.healthyProbability >= 0.6 && !out.diseaseCandidates.some((c) => c.probability >= 0.3)) {
    out.health = { status: "healthy", probability: out.healthyProbability, confirmedBy: ["Kindwise", "Gemini"] };
  }
  return out;
}

// The more sure the AI is, the lower a Kindwise candidate may score and still
// count as agreement. Only the top three candidates are considered, and the
// first-ranked one gets a little extra room.
function findAgreeing(candidates, aiConfidence, same) {
  const floor = aiConfidence >= 0.9 ? 0.15 : aiConfidence >= 0.8 ? 0.2 : AGREE_MIN;
  const top3 = [...candidates].sort((a, b) => b.probability - a.probability).slice(0, 3);
  return top3.find((c, i) => c.probability >= (i === 0 ? Math.min(floor, 0.125) : floor) && same(c));
}

/* ---------- matching answers from different checks ---------- */

// Names that mean the same problem across services.
const PROBLEM_GROUPS = [
  ["yellow_rust", /stripe rust|yellow rust|puccinia striiformis/],
  ["brown_rust", /leaf rust|brown rust|puccinia (triticina|recondita|hordei)/],
  ["stem_rust", /stem rust|black rust|puccinia graminis/],
  ["rust_other", /\brust\b|pucciniales|puccinia/],
  ["powdery", /powdery mildew|erysiph|blumeria|podosphaera|leveillula/],
  ["downy", /downy mildew|peronospor|plasmopara|sclerospora|pseudoperonospora/],
  ["late_blight", /late blight|phytophthora infestans/],
  ["early_blight", /early blight|alternaria solani/],
  ["blast", /\bblast\b|magnaporthe|pyricularia/],
  ["bacterial_blight", /bacterial (leaf )?blight|xanthomonas oryzae/],
  ["sheath_blight", /sheath blight|rhizoctonia solani/],
  ["brown_spot", /brown spot|bipolaris oryzae|helminthosporium oryzae|cochliobolus miyabeanus/],
  ["spot_blotch", /spot blotch|bipolaris sorokiniana|cochliobolus sativus/],
  ["loose_smut", /loose smut|ustilago/],
  ["karnal_bunt", /karnal bunt|tilletia indica/],
  ["leaf_curl", /leaf curl|begomovirus/],
  ["yellow_mosaic", /yellow mosaic/],
  ["mosaic", /mosaic/],
  ["anthracnose", /anthracnose|colletotrichum/],
  ["fusarium_wilt", /fusarium wilt|fusarium oxysporum/],
  ["bacterial_wilt", /bacterial wilt|ralstonia/],
  ["root_rot", /root rot/],
  ["red_rot", /red rot/],
  ["tikka", /tikka|cercospora arachidicola|late leaf spot|early leaf spot/],
  ["cercospora", /cercospora/],
  ["aphid", /aphid/],
  ["whitefly", /whitefl|bemisia/],
  ["mite", /\bmites?\b|tetranychus/],
  ["thrips", /thrips/],
  ["mealybug", /mealybug/],
  ["leaf_miner", /leaf ?miner/],
  ["bollworm", /bollworm|helicoverpa|pectinophora/],
  ["fall_armyworm", /fall armyworm|spodoptera frugiperda/],
  ["stem_borer", /stem borer|scirpophaga|chilo/],
  ["deficiency", /deficien/]
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const groupOf = (x) => {
  const text = norm(`${x.name} ${x.scientific || ""}`);
  return (PROBLEM_GROUPS.find(([, re]) => re.test(text)) || [])[0] || null;
};
const binomial = (s) => norm(s).split(" ").slice(0, 2).join(" ");

export function sameProblem(a, b) {
  const ga = groupOf(a), gb = groupOf(b);
  if (ga || gb) return ga === gb && ga !== "rust_other" && ga !== "mosaic";
  const ba = binomial(a.scientific), bb = binomial(b.scientific);
  if (ba.includes(" ") && ba === bb) return true;
  return Boolean(norm(a.name)) && norm(a.name) === norm(b.name);
}

function confirmedDisease(c, by) {
  const d = diseaseFrom(c.name, c.scientific || c.name, c.probability, c.d || {}, c.source);
  d.confirmedBy = by;
  return d;
}

function confirmedPlant(c, other, by) {
  const base = { ...(other?.plant || {}), ...c.plant };
  const sameSpecies = !other || binomial(other.name) === binomial(c.name);
  return { ...base, status: "sure", probability: c.probability, confirmedBy: by, level: sameSpecies ? undefined : "genus", genus: sameSpecies ? undefined : genusOf(c.name) };
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
  const geminiP = geminiEnabled() ? callGemini(images).then((v) => ({ status: "fulfilled", value: v }), (e) => ({ status: "rejected", reason: e })) : null;
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

  const geminiRes = geminiP ? await geminiP : null;
  const out = corroborate(merge(plantData ? interpret(plantData) : null, cropData ? interpretCrop(cropData) : null),
    geminiRes?.status === "fulfilled" ? geminiRes.value : null);
  if (geminiRes?.status === "fulfilled" && geminiRes.value) out.secondOpinion = geminiRes.value;
  out.warnings = [plantRes, cropRes, geminiRes].filter(Boolean).filter((r) => r.status === "rejected" && r.reason instanceof ApiError).map((r) => ({ key: r.reason.key, vars: r.reason.vars }));
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
    .map((s) => ({ name: s.name, common: s.details?.common_names?.[0] || "", probability: s.probability, plant: plantFrom(s), source: "Plant.id" }));

  // --- Health ---
  const healthy = r.is_healthy || {};
  out.healthyProbability = healthy.probability ?? null;
  for (const s of r.disease?.suggestions || []) {
    const d = s.details || {};
    if (s.probability >= THRESHOLDS.disease) {
      out.diseases.push(diseaseFrom(d.local_name || s.name, s.name, s.probability, d, "plant.id"));
    } else if (s.probability >= CANDIDATE_MIN) {
      out.diseaseCandidates.push({ name: d.local_name || s.name, scientific: s.name, probability: s.probability, d, source: "Plant.id" });
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
  const cropPlant = (s) => ({
    status: "sure",
    name: s.scientific_name || s.name,
    probability: s.probability,
    commonNames: s.details?.common_names?.length ? s.details.common_names : [s.name],
    description: textOf(s.details?.description),
    url: s.details?.wiki_url || "",
    isCrop: true
  });
  if (top && top.probability >= THRESHOLDS.species) out.plant = cropPlant(top);
  out.plantCandidates = crops
    .filter((s) => s.probability >= CANDIDATE_MIN)
    .slice(0, 3)
    .map((s) => ({ name: s.scientific_name || s.name, common: s.name, probability: s.probability, plant: cropPlant(s), source: "crop.health" }));

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
      out.diseaseCandidates.push({ name, scientific: s.scientific_name || s.name, probability: s.probability, d, source: "crop.health" });
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
  if (out.plant.status !== "sure") {
    const pc = p.plantCandidates[0], cc = c.plantCandidates[0];
    if (pc && cc && pc.probability >= AGREE_MIN && cc.probability >= AGREE_MIN && genusOf(pc.name).toLowerCase() === genusOf(cc.name).toLowerCase()) {
      out.plant = confirmedPlant(cc, pc, ["Plant.id", "crop.health"]);
    }
  }

  // Both services independently put the same problem on top: that counts as confirmed.
  const pd = p.diseaseCandidates[0], cd = c.diseaseCandidates[0];
  if (!c.diseases.length && !p.diseases.length && pd && cd && pd.probability >= AGREE_MIN && cd.probability >= AGREE_MIN && sameProblem(pd, cd)) {
    c.diseases.push(confirmedDisease(cd, ["crop.health", "Plant.id"]));
    c.diseaseCandidates.shift(); p.diseaseCandidates.shift();
  }

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
