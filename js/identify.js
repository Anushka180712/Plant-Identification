// Talks to the Plant.id (Kindwise) API and turns its answer into a
// "sure / not sure" result. Nothing is shown as an answer unless it
// clears the thresholds below.

import { getSettings } from "./storage.js";

export const THRESHOLDS = {
  isPlant: 0.80,     // photo really shows a plant
  species: 0.80,     // plant name
  healthy: 0.80,     // "looks healthy"
  disease: 0.75      // disease / pest / deficiency
};

const API_URL = "https://plant.id/api/v3/identification";
const FULL_DETAILS = [
  "common_names", "url", "description", "taxonomy", "watering", "best_light_condition",
  "best_soil_type", "common_uses", "toxicity", "edible_parts",
  "local_name", "treatment", "classification", "cause"
].join(",");
const MIN_DETAILS = "common_names,url,description,treatment,cause";

export class ServiceNotConfigured extends Error {}

export function serviceMode() {
  const cfg = window.PAUDHA_CONFIG || {};
  if (cfg.proxyUrl) return "proxy";
  if (getSettings().apiKey) return "key";
  return "none";
}

async function callApi(body, details, language) {
  const cfg = window.PAUDHA_CONFIG || {};
  const mode = serviceMode();
  if (mode === "none") throw new ServiceNotConfigured();

  const params = new URLSearchParams({ details, language });
  const url = (mode === "proxy" ? cfg.proxyUrl : API_URL) + "?" + params.toString();
  const headers = { "Content-Type": "application/json" };
  if (mode === "key") headers["Api-Key"] = getSettings().apiKey;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 401) throw new Error("The identification service rejected the API key. Check it in Settings.");
  if (res.status === 429) throw new Error("The identification service has run out of credits for now. Try again later.");
  return res;
}

export async function identify(images, location) {
  const settings = getSettings();
  const body = {
    images,                       // data URLs (base64 JPEG)
    similar_images: true,
    health: "all",
    classification_level: "species"
  };
  if (location) {
    body.latitude = location.lat;
    body.longitude = location.lon;
  }
  const language = settings.nameLang || "en";

  let res = await callApi(body, FULL_DETAILS, language);
  if (res.status === 400) {
    // Some detail fields may not be available on every plan; retry with fewer.
    res = await callApi(body, MIN_DETAILS, language);
  }
  if (!res.ok) {
    let msg = "";
    try { msg = await res.text(); } catch { /* ignore */ }
    throw new Error(`The identification service failed (${res.status}). ${msg.slice(0, 160)}`);
  }
  const data = await res.json();
  return interpret(data);
}

const CHEMICAL_WORDS = /(fungicid|insecticid|pesticid|herbicid|bactericid|miticid|acaricid|nematicid|fertili[sz]|chemical|copper|sulph|sulfur|mancozeb|carbendazim|chlorpyrifos|imidacloprid|glyphosate|urea|npk|dap\b|potash|spray|dose|ml\/|g\/l|per litre|per liter)/i;

function splitAdvice(list) {
  const safe = [], needsExpert = [];
  for (const item of list || []) {
    if (typeof item !== "string") continue;
    (CHEMICAL_WORDS.test(item) ? needsExpert : safe).push(item);
  }
  return { safe, needsExpert };
}

export function interpret(data) {
  const r = data.result || {};
  const out = {
    raw: { accessToken: data.access_token, created: data.created },
    plant: { status: "unknown" },
    health: { status: "unknown" },
    diseases: [],
    uncertainDiseaseCount: 0
  };

  const isPlant = r.is_plant || {};
  out.isPlantProbability = isPlant.probability ?? null;
  if (isPlant.probability != null && isPlant.probability < 0.5) {
    out.verdict = "not_plant";
    return out;
  }
  if (isPlant.probability != null && isPlant.probability < THRESHOLDS.isPlant) {
    out.verdict = "unclear";
    return out;
  }
  out.verdict = "plant";

  // --- Species ---
  const suggestions = r.classification?.suggestions || [];
  const top = suggestions[0];
  if (top && top.probability >= THRESHOLDS.species) {
    const d = top.details || {};
    out.plant = {
      status: "sure",
      name: top.name,
      probability: top.probability,
      commonNames: d.common_names || [],
      description: d.description?.value || "",
      url: d.url || "",
      watering: d.watering || null,
      light: d.best_light_condition || "",
      soil: d.best_soil_type || "",
      uses: d.common_uses || "",
      toxicity: d.toxicity || "",
      family: d.taxonomy?.family || "",
      similarImage: top.similar_images?.[0]?.url_small || top.similar_images?.[0]?.url || ""
    };
  } else {
    out.plant = { status: "unsure", best: top ? top.probability : 0 };
  }

  // --- Health ---
  const healthy = r.is_healthy || {};
  const diseaseSuggestions = r.disease?.suggestions || [];
  for (const s of diseaseSuggestions) {
    if (s.probability >= THRESHOLDS.disease) {
      const d = s.details || {};
      const treatment = d.treatment || {};
      const bio = splitAdvice(treatment.biological);
      const prevention = splitAdvice(treatment.prevention);
      out.diseases.push({
        name: d.local_name || s.name,
        scientific: s.name,
        probability: s.probability,
        description: d.description || "",
        cause: d.cause || "",
        url: d.url || "",
        classification: d.classification || [],
        primaryFix: [...bio.safe, ...prevention.safe],
        hasChemicalOptions: (treatment.chemical || []).length > 0 || bio.needsExpert.length > 0 || prevention.needsExpert.length > 0,
        deficiency: /deficien/i.test(`${s.name} ${d.local_name || ""}`) ? `${s.name} ${d.local_name || ""}` : null
      });
    } else if (s.probability >= 0.3) {
      out.uncertainDiseaseCount++;
    }
  }

  if (out.diseases.length) {
    out.health = { status: "problem" };
  } else if (healthy.probability != null && healthy.probability >= THRESHOLDS.healthy) {
    out.health = { status: "healthy", probability: healthy.probability };
  } else if (healthy.probability != null && healthy.probability <= 1 - THRESHOLDS.healthy) {
    out.health = { status: "unhealthy_unsure" };
  } else {
    out.health = { status: "unsure" };
  }
  return out;
}
