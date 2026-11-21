// Offline shell + background weather checks (where the browser supports it).
const LANGS = ["en", "hi", "bn", "mr", "gu", "pa", "or", "ta", "te", "kn", "ml"];
importScripts(...LANGS.map((l) => `js/lang/${l}.js`), "js/weather-core.js");

const VERSION = "paudha-v5";
const SHELL = [
  "./", "index.html", "css/styles.css", "config.js", "manifest.webmanifest",
  "js/app.js", "js/quality.js", "js/identify.js", "js/storage.js", "js/guide.js", "js/i18n.js", "js/weather-core.js",
  ...LANGS.map((l) => `js/lang/${l}.js`),
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "paudha-data").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network first, fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

async function backgroundCheck() {
  const cache = await caches.open("paudha-data");
  const res = await cache.match("data/state.json");
  if (!res) return;
  const state = await res.json();
  const forecasts = {};
  for (const p of state.places || []) {
    try { forecasts[p.id] = await self.PaudhaWeather.fetchForecast(p.lat, p.lon); } catch { /* skip */ }
  }
  const notified = state.notified || {};
  const t = self.PaudhaWeather.makeT(state.lang || "en");
  const due = self.PaudhaWeather.dueNotifications(state.places || [], forecasts, notified, t);
  for (const n of due) {
    await self.registration.showNotification(n.title, {
      body: n.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: n.key, data: { url: "./#places" }
    });
    notified[n.key] = Date.now();
  }
  await cache.put("data/state.json", new Response(JSON.stringify({ ...state, notified }), { headers: { "Content-Type": "application/json" } }));
  const clients = await self.clients.matchAll();
  clients.forEach((c) => c.postMessage({ type: "notified", keys: due.map((d) => d.key) }));
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "paudha-weather") e.waitUntil(backgroundCheck());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) { c.navigate(target); return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});
