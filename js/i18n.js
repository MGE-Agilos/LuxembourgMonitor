const DICT = {
  en: {
    byline: "by Beyond Data",
    "search.label": "Find a commune",
    "search.placeholder": "Find your commune…",
    "err.load": "The data could not be loaded. Please reload the page.",
    "ask.title": "Ask the data",
    "ask.placeholder": "Ask about any of the 100 communes…",
    "ask.send": "Ask",
    "ask.thinking": "Reading the open data…",
    "ask.offline": "Live AI offline — try a suggestion",
    "ask.figures": "Figures used",
    "ask.sources": "Sources",
    "ask.intro": "Ask a question in your own words. The answer comes only from public data, and the map lights up.",
    "ask.about": "About {name}",
    eyebrow: "Data Summit Luxembourg 2026 · Open data",
    tagline: "Find your commune — Ask the data",
    tap: "Touch the map or search for your commune.",
    built: "Built from open data by AI agents.",
    "foot.sources": "Open data: STATEC · RNPP national register · Observatoire de l'Habitat · ACT",
    canton: "Canton {c}",
    rank: "#{r} of {n}",
    growth: "{g} in 10 years",
    fewads: "Fewer than 30 listings",
    twins: "Communes most like {name}",
    strength: "Stands out",
    attention: "To watch",
    vs: "{v} vs {t} in similar communes",
    scan: "Scan to take {name} home",
    open_ask: "Ask the data about {name}",
  },
  fr: {
    byline: "par Beyond Data",
    "search.label": "Trouver une commune",
    "search.placeholder": "Trouvez votre commune…",
    "err.load": "Les données n'ont pas pu être chargées. Rechargez la page.",
    "ask.title": "Interroger les données",
    "ask.placeholder": "Posez une question sur l'une des 100 communes…",
    "ask.send": "Demander",
    "ask.thinking": "Lecture des données ouvertes…",
    "ask.offline": "IA en direct indisponible — essayez une suggestion",
    "ask.figures": "Chiffres utilisés",
    "ask.sources": "Sources",
    "ask.intro": "Posez votre question avec vos mots. La réponse vient uniquement des données publiques, et la carte s'allume.",
    "ask.about": "À propos de {name}",
    eyebrow: "Data Summit Luxembourg 2026 · Données ouvertes",
    tagline: "Trouvez votre commune — Interrogez les données",
    tap: "Touchez la carte ou cherchez votre commune.",
    built: "Construit à partir des données ouvertes par des agents IA.",
    "foot.sources": "Données ouvertes : STATEC · RNPP · Observatoire de l'Habitat · ACT",
    canton: "Canton de {c}",
    rank: "{r}ᵉ sur {n}",
    growth: "{g} en 10 ans",
    fewads: "Moins de 30 annonces",
    twins: "Les communes les plus proches de {name}",
    strength: "Point fort",
    attention: "Point d'attention",
    vs: "{v} contre {t} dans les communes comparables",
    scan: "Scannez pour emporter {name}",
    open_ask: "Interroger les données sur {name}",
  },
};

function initial() {
  const p = new URLSearchParams(location.search).get("lang");
  if (p === "en" || p === "fr") return p;
  try {
    const s = localStorage.getItem("lm-lang");
    if (s === "en" || s === "fr") return s;
  } catch { /* storage unavailable */ }
  return "en";
}

let lang = initial();
document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(l) {
  lang = l;
  try { localStorage.setItem("lm-lang", l); } catch { /* ignore */ }
  document.documentElement.lang = l;
}

export function t(key, vars = {}) {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, () => String(v));
  return s;
}

export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
}
