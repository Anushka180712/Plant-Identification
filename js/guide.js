// Reference content: nutrient deficiency signs, expert help in India.

export const HELP = {
  kcc: { label: "Kisan Call Centre (free, 6 AM to 10 PM, many Indian languages)", phone: "18001801551", display: "1800-180-1551" },
  links: [
    { label: "Find your nearest Krishi Vigyan Kendra (KVK)", url: "https://kvk.icar.gov.in/" },
    { label: "Soil Health Card: get your soil tested", url: "https://soilhealth.dac.gov.in/" },
    { label: "India Meteorological Department warnings", url: "https://mausam.imd.gov.in/" }
  ]
};

// Signs and the first, non-chemical step. Doses of any fertiliser are
// deliberately left to an agricultural expert.
export const NUTRIENTS = [
  {
    id: "nitrogen", name: "Nitrogen (N)", match: /nitrogen/i,
    signs: "Older, lower leaves turn evenly pale yellow first; the plant grows slowly and looks thin.",
    firstStep: "Mix well-rotted compost, cow-dung manure (FYM) or vermicompost into the soil. In fields, a legume or green-manure crop (like dhaincha or sunhemp) adds nitrogen."
  },
  {
    id: "phosphorus", name: "Phosphorus (P)", match: /phosph/i,
    signs: "Older leaves turn dark green with a purple or reddish tinge; weak roots and poor flowering.",
    firstStep: "Add compost or well-rotted manure and keep soil from becoming waterlogged or very cold. A soil test tells you if phosphorus is truly low."
  },
  {
    id: "potassium", name: "Potassium (K)", match: /potass/i,
    signs: "Edges and tips of older leaves turn yellow, then brown and dry (scorched look); weak stems.",
    firstStep: "Add compost and mulch, and water evenly. Ask an expert before adding any potash."
  },
  {
    id: "magnesium", name: "Magnesium (Mg)", match: /magnes/i,
    signs: "Yellowing between the veins of older leaves while the veins stay green.",
    firstStep: "Add compost; avoid overusing potash, which can block magnesium. Ask an expert about a magnesium supplement."
  },
  {
    id: "iron", name: "Iron (Fe)", match: /\biron\b/i,
    signs: "Yellowing between the veins of young, top leaves; veins stay green. Common in alkaline or waterlogged soil.",
    firstStep: "Improve drainage and avoid overwatering. Adding compost helps. Ask an expert about iron supplements."
  },
  {
    id: "zinc", name: "Zinc (Zn)", match: /\bzinc\b/i,
    signs: "Small, narrow new leaves bunched at the tip; pale stripes or bronze patches (e.g. 'khaira' in rice).",
    firstStep: "Add organic matter. Zinc deficiency is common in Indian soils; a soil test and expert advice are the right next step."
  },
  {
    id: "calcium", name: "Calcium (Ca)", match: /calcium/i,
    signs: "New leaves are curled or have burnt tips; blossom-end rot (black bottom) on tomato, chilli or brinjal fruit.",
    firstStep: "Water regularly and evenly; dry-wet cycles cause most calcium problems. Mulch to keep moisture steady."
  },
  {
    id: "sulphur", name: "Sulphur (S)", match: /sul(ph|f)ur/i,
    signs: "Young leaves turn evenly pale yellow (like nitrogen deficiency, but on new leaves first).",
    firstStep: "Add compost or well-rotted manure. Ask an expert before adding any sulphur product."
  },
  {
    id: "boron", name: "Boron (B)", match: /\bboron\b/i,
    signs: "Growing tips die back; brittle, thick leaves; cracked or hollow stems and fruit.",
    firstStep: "Add organic matter and keep soil moist. Boron is needed in tiny amounts and too much is toxic, so only add it on expert advice."
  },
  {
    id: "manganese", name: "Manganese (Mn)", match: /mangan/i,
    signs: "Yellowing between veins on young leaves, often with small brown spots.",
    firstStep: "Check drainage and soil pH. Ask an expert before adding any supplement."
  }
];

export function matchNutrient(text) {
  return NUTRIENTS.find((n) => n.match.test(text || "")) || null;
}

export const PHOTO_TIPS = [
  "Daylight is best. Avoid flash, deep shade and harsh backlight.",
  "Tap the leaf on your screen so the camera focuses on it, and hold still.",
  "Fill most of the frame with the part you are checking.",
  "For disease: the top and underside of an affected leaf, plus the whole plant.",
  "For identification: whole plant + close-up of a leaf, flower or fruit.",
  "For roots: rinse soil off gently first.",
  "Plain background (paper or your palm) helps when leaves are against clutter."
];
