// Weather hazard rules shared by the app and the service worker.
// Loaded as a classic script (window / self global), so the service worker
// can use it with importScripts().
(function (root) {
  "use strict";

  // Translate with the loaded language files (js/lang/*.js), English fallback.
  function makeT(lang) {
    return function (key, vars) {
      const all = root.PAUDHA_LANG || {};
      let str = (all[lang] && all[lang][key]) || (all.en && all.en[key]) || key;
      if (vars) str = str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
      return str;
    };
  }

  // Days before an event on which an alert is raised.
  const MILESTONES = [7, 5, 3, 2, 1];

  // Thresholds follow India Meteorological Department (IMD) terms where they exist.
  const RULES = [
    {
      id: "rain_extreme", group: "rain", severe: true,
      test: (d) => d.rain >= 204.5,
      detail: (d, t) => t("wd.rain", { mm: d.rain.toFixed(0) }),
      advice: [
        "wa.drains_now",
        "wa.move_pots_raised",
        "wa.stake_harvest",
        "wa.no_fert_rain"
      ]
    },
    {
      id: "rain_very_heavy", group: "rain", severe: true,
      test: (d) => d.rain >= 115.6 && d.rain < 204.5,
      detail: (d, t) => t("wd.rain", { mm: d.rain.toFixed(0) }),
      advice: [
        "wa.clear_drains",
        "wa.stake_tie",
        "wa.harvest_early",
        "wa.no_fert_rain"
      ]
    },
    {
      id: "rain_heavy", group: "rain", severe: false,
      test: (d) => d.rain >= 64.5 && d.rain < 115.6,
      detail: (d, t) => t("wd.rain", { mm: d.rain.toFixed(0) }),
      advice: [
        "wa.standing_water",
        "wa.skip_water",
        "wa.fungal_watch"
      ]
    },
    {
      id: "heat_severe", group: "heat", severe: true,
      test: (d) => d.tmax >= 45,
      detail: (d, t) => t("wd.tmax", { t: d.tmax.toFixed(0) }),
      advice: [
        "wa.water_cool",
        "wa.shade_net",
        "wa.mulch_cool",
        "wa.pots_off_concrete"
      ]
    },
    {
      id: "heat", group: "heat", severe: false,
      test: (d) => d.tmax >= 40 && d.tmax < 45,
      detail: (d, t) => t("wd.tmax", { t: d.tmax.toFixed(0) }),
      advice: [
        "wa.water_morning",
        "wa.mulch",
        "wa.afternoon_shade"
      ]
    },
    {
      id: "frost", group: "cold", severe: true,
      test: (d) => d.tmin <= 2,
      detail: (d, t) => t("wd.tmin", { t: d.tmin.toFixed(0) }),
      advice: [
        "wa.cover_night",
        "wa.evening_soil_water",
        "wa.pots_indoors"
      ]
    },
    {
      id: "cold", group: "cold", severe: false,
      test: (d) => d.tmin > 2 && d.tmin <= 6,
      detail: (d, t) => t("wd.tmin", { t: d.tmin.toFixed(0) }),
      advice: [
        "wa.protect_tropical",
        "wa.no_evening_leaf_water"
      ]
    },
    {
      id: "hail", group: "storm", severe: true,
      test: (d) => d.code === 96 || d.code === 99,
      detail: (d, t) => t("wd.hail"),
      advice: [
        "wa.cover_beds",
        "wa.pots_under_roof",
        "wa.harvest_ready"
      ]
    },
    {
      id: "thunder", group: "storm", severe: false,
      test: (d) => d.code === 95,
      detail: (d, t) => t("wd.thunder"),
      advice: [
        "wa.stake_climbers",
        "wa.lightning"
      ]
    },
    {
      id: "wind_severe", group: "wind", severe: true,
      test: (d) => d.gust >= 90,
      detail: (d, t) => t("wd.gust", { v: d.gust.toFixed(0) }),
      advice: [
        "wa.tie_trees",
        "wa.baskets_down",
        "wa.secure_nets"
      ]
    },
    {
      id: "wind", group: "wind", severe: false,
      test: (d) => d.gust >= 60 && d.gust < 90,
      detail: (d, t) => t("wd.gust", { v: d.gust.toFixed(0) }),
      advice: [
        "wa.stake_climbers",
        "wa.light_pots"
      ]
    }
  ];

  const WX = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"],
    51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Drizzle"],
    61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Snow"], 73: ["🌨️", "Snow"], 75: ["🌨️", "Snow"], 77: ["🌨️", "Snow"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"],
    85: ["🌨️", "Snow showers"], 86: ["🌨️", "Snow showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Storm with hail"], 99: ["⛈️", "Storm with hail"]
  };

  function forecastUrl(lat, lon) {
    const p = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max",
      timezone: "auto",
      forecast_days: "16"
    });
    return "https://api.open-meteo.com/v1/forecast?" + p.toString();
  }

  async function fetchForecast(lat, lon) {
    const res = await fetch(forecastUrl(lat, lon));
    if (!res.ok) throw new Error("Weather service error " + res.status);
    const j = await res.json();
    const d = j.daily;
    const days = d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      tmax: d.temperature_2m_max[i] ?? NaN,
      tmin: d.temperature_2m_min[i] ?? NaN,
      rain: d.precipitation_sum[i] ?? 0,
      rainChance: d.precipitation_probability_max?.[i] ?? null,
      gust: d.wind_gusts_10m_max[i] ?? 0
    }));
    return { fetchedAt: new Date().toISOString(), timezone: j.timezone, days };
  }

  // Today's date in the place's own timezone, as YYYY-MM-DD.
  function todayIn(timezone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  }

  // Strongest hazard per group per day.
  function hazardsForDay(day) {
    const found = {};
    for (const rule of RULES) {
      if ([day.tmax, day.tmin, day.rain, day.gust].some((v) => typeof v !== "number")) continue;
      if (!found[rule.group] && rule.test(day)) found[rule.group] = rule;
    }
    return Object.values(found);
  }

  // Dry spell: 7+ days in a row without meaningful rain, mostly hot.
  function dryspell(days, today) {
    const upcoming = days.filter((d) => daysBetween(today, d.date) >= 0);
    let run = 0, start = null;
    for (const d of upcoming) {
      if (d.rain < 1 && d.tmax >= 35) { run++; if (run === 1) start = d.date; if (run >= 7) return { start, length: run }; }
      else { run = 0; start = null; }
    }
    return null;
  }

  // All hazards in the forecast with days-ahead info.
  function analyse(forecast, t) {
    t = t || makeT("en");
    const today = todayIn(forecast.timezone);
    const events = [];
    for (const day of forecast.days) {
      const ahead = daysBetween(today, day.date);
      if (ahead < 0) continue;
      for (const rule of hazardsForDay(day)) {
        events.push({
          key: `${rule.id}|${day.date}`,
          rule: rule.id, group: rule.group, severe: rule.severe,
          title: t("w." + rule.id), detail: rule.detail(day, t), advice: rule.advice.map((a) => t(a)),
          date: day.date, daysAhead: ahead,
          milestone: MILESTONES.includes(ahead) ? ahead : null,
          lowConfidence: ahead > 7
        });
      }
    }
    const dry = dryspell(forecast.days, today);
    if (dry) {
      const ahead = daysBetween(today, dry.start);
      events.push({
        key: `dry|${dry.start}`, rule: "dry", group: "dry", severe: false,
        title: t("w.dry"),
        detail: t("wd.dry", { n: dry.length }),
        advice: ["wa.plan_water", "wa.mulch_beds", "wa.store_water"].map((a) => t(a)),
        date: dry.start, daysAhead: ahead,
        milestone: MILESTONES.includes(ahead) ? ahead : null,
        lowConfidence: ahead > 7
      });
    }
    events.sort((a, b) => a.daysAhead - b.daysAhead || Number(b.severe) - Number(a.severe));
    return events;
  }

  function whenText(daysAhead, t) {
    t = t || makeT("en");
    if (daysAhead === 0) return t("when.0");
    if (daysAhead === 1) return t("when.1");
    return t("when.n", { n: daysAhead });
  }

  // Alerts that should go out as notifications right now.
  function dueNotifications(places, forecasts, notified, t) {
    t = t || makeT("en");
    const out = [];
    for (const place of places) {
      const f = forecasts[place.id];
      if (!f) continue;
      for (const e of analyse(f, t)) {
        if (e.milestone == null && e.daysAhead !== 0) continue;
        const key = `${place.id}|${e.key}|${e.daysAhead}`;
        if (notified[key]) continue;
        out.push({
          key,
          title: t("notify.title", { title: e.title, when: whenText(e.daysAhead, t), place: place.name }),
          body: t("notify.body", { detail: e.detail, date: e.date, advice: e.advice[0] }),
          severe: e.severe
        });
      }
    }
    return out;
  }

  root.PaudhaWeather = { makeT, MILESTONES, RULES, WX, fetchForecast, analyse, todayIn, daysBetween, whenText, dueNotifications };
})(typeof self !== "undefined" ? self : window);
