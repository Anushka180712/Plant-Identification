// Everything is stored on the phone (localStorage). Nothing is uploaded
// except the photos sent for analysis and place coordinates sent for weather.

const KEYS = {
  settings: "paudha.settings",
  places: "paudha.places",
  history: "paudha.history",
  notified: "paudha.notified",
  forecasts: "paudha.forecasts"
};
const MAX_HISTORY = 40;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Settings
export const getSettings = () => read(KEYS.settings, { apiKey: "", nameLang: "en" });
export const saveSettings = (patch) => write(KEYS.settings, { ...getSettings(), ...patch });

// Places
export const getPlaces = () => read(KEYS.places, []);
export const savePlaces = (places) => write(KEYS.places, places);
export function addPlace(place) {
  const places = getPlaces();
  const p = { id: uid(), plants: [], notes: "", ...place };
  places.push(p);
  savePlaces(places);
  return p;
}
export function updatePlace(id, patch) {
  savePlaces(getPlaces().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}
export function removePlace(id) {
  savePlaces(getPlaces().filter((p) => p.id !== id));
  const f = getForecasts();
  delete f[id];
  write(KEYS.forecasts, f);
}

// Cached forecasts (so alerts still show offline)
export const getForecasts = () => read(KEYS.forecasts, {});
export function saveForecast(placeId, forecast) {
  const f = getForecasts();
  f[placeId] = forecast;
  write(KEYS.forecasts, f);
}

// Scan history
export const getHistory = () => read(KEYS.history, []);
export function addHistory(entry) {
  const list = [{ id: uid(), at: new Date().toISOString(), ...entry }, ...getHistory()].slice(0, MAX_HISTORY);
  // If storage is full, drop the oldest entries until it fits.
  while (list.length && !write(KEYS.history, list)) list.pop();
}
export const removeHistory = (id) => write(KEYS.history, getHistory().filter((h) => h.id !== id));
export const clearHistory = () => write(KEYS.history, []);

// Which weather alerts were already sent as notifications
export const getNotified = () => read(KEYS.notified, {});
export function markNotified(key) {
  const n = getNotified();
  n[key] = Date.now();
  // forget entries older than 30 days
  const cutoff = Date.now() - 30 * 864e5;
  for (const k of Object.keys(n)) if (n[k] < cutoff) delete n[k];
  write(KEYS.notified, n);
}

export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    places: getPlaces(),
    history: getHistory().map(({ thumb, ...rest }) => rest)
  };
}
