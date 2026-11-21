# Paudha – Indian Plant Doctor

A mobile-friendly web app for identifying Indian plants and checking their health from phone photos, with weather warnings for the places where your plants grow.

**Live app:** https://anushka180712.github.io/Plant-Identification/

## What it does

- **Identify plants** from photos of the leaf, stem, root, flower/fruit or whole plant (up to 5 photos per check).
- **Detect diseases, pests and mineral deficiencies**, with the mineral needed and a first, non-chemical fix.
- **No guessing.** A plant name, disease or deficiency is only shown when the analysis is confident:
  - photo shows a plant: 80%
  - plant name: 80%
  - "looks healthy": 80%
  - disease / pest / deficiency: 75%
  Below that, the app says it is not sure and asks for better photos or an expert.
- **Chemicals and fertilisers are never prescribed.** The app points to an agricultural scientist instead (Kisan Call Centre 1800-180-1551 and the nearest Krishi Vigyan Kendra).
- **Photo checks on the phone** before anything is sent: too small, too dark, too bright, low detail and blurry photos are rejected with tips. Non-plant photos are rejected.
- **Saved plant places** (search by name or use GPS), with a 10-day forecast and **warnings 7, 5, 3, 2 and 1 day before** heavy rain (IMD thresholds), heatwave, cold/frost, thunderstorm/hail, strong wind and long hot dry spells, plus what to do for your plants.
- **Alerts** as phone notifications when the app is opened, and in the background on Android Chrome when installed.
- Scan history, plant list and notes per place, plant names in 10 Indian languages, deficiency guide, share results, export data, works offline as an installable app, dark mode.

## Setup

The app is static (HTML/CSS/JS, no build step) and is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

Identification uses the [Plant.id API](https://www.kindwise.com/plant-id) (identification + health assessment). Weather uses [Open-Meteo](https://open-meteo.com/) (free, no key).

Choose one way to provide the Plant.id key:

1. **Server function (recommended for public use).** Deploy this repo to Vercel, set `PLANT_ID_API_KEY` (and optionally `ALLOWED_ORIGIN=https://anushka180712.github.io`) in the project's environment variables, then set `proxyUrl` in `config.js` to `https://<your-vercel-app>.vercel.app/api/identify`.
2. **Key on the phone.** Open Settings in the app and paste a Plant.id key. It is stored only on that device.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Privacy

Scan history, places and settings are stored only in the browser on the phone. Photos are sent to Plant.id only when you tap Analyse; place coordinates are sent to Open-Meteo for forecasts.

## Disclaimer

Results are a guide, not a lab diagnosis. Always confirm serious problems, and any chemical or fertiliser use, with an agricultural expert.
