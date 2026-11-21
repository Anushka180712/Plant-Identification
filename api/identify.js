// Optional server functions (Vercel) that keep the Kindwise API keys secret.
// Set PLANT_ID_API_KEY (and CROP_HEALTH_API_KEY for /api/crop) in the Vercel
// project, and optionally ALLOWED_ORIGIN (e.g. https://anushka180712.github.io).
// Then put the function URLs in config.js.

const MAX_BODY = 12 * 1024 * 1024;

export function makeHandler(API_URL, keyName) {
 return async function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", allowed === "*" ? "*" : (allowed.split(",").map((s) => s.trim()).includes(origin) ? origin : "null"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env[keyName]) return res.status(500).json({ error: `Server is missing ${keyName}` });

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (body.length > MAX_BODY) return res.status(413).json({ error: "Photos too large" });

  let parsed;
  try { parsed = JSON.parse(body); } catch { return res.status(400).json({ error: "Bad JSON" }); }
  if (!Array.isArray(parsed.images) || parsed.images.length < 1 || parsed.images.length > 5) {
    return res.status(400).json({ error: "Send 1 to 5 images" });
  }

  const params = new URLSearchParams();
  if (req.query.details) params.set("details", String(req.query.details));
  if (req.query.language) params.set("language", String(req.query.language));

  const upstream = await fetch(`${API_URL}?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Api-Key": process.env[keyName] },
    body
  });
  const text = await upstream.text();
  res.status(upstream.status).setHeader("Content-Type", "application/json").send(text);
 };
}

export default makeHandler("https://plant.id/api/v3/identification", "PLANT_ID_API_KEY");

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
