// Reference data: nutrient deficiencies and expert help in India.
// Text lives in js/lang/*.js under "nut.<id>.name|signs|step" and "help.*".

export const HELP = {
  kccPhone: "18001801551",
  kccDisplay: "1800-180-1551",
  links: [
    { key: "help.kvk", url: "https://kvk.icar.gov.in/" },
    { key: "help.soil", url: "https://soilhealth.dac.gov.in/" },
    { key: "help.imd", url: "https://mausam.imd.gov.in/" }
  ]
};

// Doses of any fertiliser are deliberately left to an agricultural expert.
export const NUTRIENTS = [
  { id: "nitrogen", match: /nitrogen/i },
  { id: "phosphorus", match: /phosph/i },
  { id: "potassium", match: /potass/i },
  { id: "magnesium", match: /magnes/i },
  { id: "iron", match: /\biron\b/i },
  { id: "zinc", match: /\bzinc\b/i },
  { id: "calcium", match: /calcium/i },
  { id: "sulphur", match: /sul(ph|f)ur/i },
  { id: "boron", match: /\bboron\b/i },
  { id: "manganese", match: /mangan/i }
];

export function matchNutrient(text) {
  return NUTRIENTS.find((n) => n.match.test(text || "")) || null;
}

export const PHOTO_TIP_KEYS = ["tip.1", "tip.2", "tip.3", "tip.4", "tip.5", "tip.6", "tip.7"];
