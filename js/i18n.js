// App language: loads js/lang/<code>.js on demand and translates the page.
import { getSettings, saveSettings } from "./storage.js";

const ALL_LANGS = [
  { code: "en", name: "English", en: "English" },
  { code: "hi", name: "हिन्दी", en: "Hindi" },
  { code: "bn", name: "বাংলা", en: "Bengali" },
  { code: "mr", name: "मराठी", en: "Marathi" },
  { code: "te", name: "తెలుగు", en: "Telugu" },
  { code: "ta", name: "தமிழ்", en: "Tamil" },
  { code: "gu", name: "ગુજરાતી", en: "Gujarati" },
  { code: "kn", name: "ಕನ್ನಡ", en: "Kannada" },
  { code: "ml", name: "മലയാളം", en: "Malayalam" },
  { code: "or", name: "ଓଡ଼ିଆ", en: "Odia" },
  { code: "pa", name: "ਪੰਜਾਬੀ", en: "Punjabi" }
];
// Languages whose translation file is ready.
const READY = ["en", "hi", "bn", "mr", "gu", "pa", "or", "ta", "te", "kn", "ml"];
export const LANGS = ALL_LANGS.filter((l) => READY.includes(l.code));

let current = "en";
let translate = window.PaudhaWeather.makeT("en");

export const t = (key, vars) => translate(key, vars);
export const getLang = () => current;
export const hasChosenLang = () => Boolean(getSettings().lang);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function setLang(code, { save = true } = {}) {
  if (!LANGS.some((l) => l.code === code)) code = "en";
  if (!window.PAUDHA_LANG?.[code]) {
    try { await loadScript(`js/lang/${code}.js`); } catch { code = "en"; }
  }
  current = code;
  translate = window.PaudhaWeather.makeT(code);
  document.documentElement.lang = code;
  if (save) saveSettings({ lang: code });
  applyStatic();
}

export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}

// Locale for dates and numbers (Indian English for "en").
export const locale = () => (current === "en" ? "en-IN" : `${current}-IN`);
