let state = null;

export function norm(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

export async function loadData(base = "data/") {
  BASE = base;
  // Small files are loaded up front; heavy ones (series, cantons, nationalities) on the pages that need them (extra()).
  const names = ["meta", "communes", "carte", "faits", "suggestions", "ouvivre", "national", "wishlist", "electoral_system"];
  const [meta, communes, carte, faits, suggestions, ouvivre, national, wishlist, electoral] = await Promise.all(names.map(getJson));
  state = {
    meta, communes, carte, faits, suggestions, ouvivre, national, wishlist, electoral,
    byLau: new Map(communes.map((c) => [c.lau, c])),
    ind: new Map(meta.indicators.map((m) => [m.id, m])),
  };
  return state;
}

let BASE = "data/";
const getJson = (n) => fetch(`${BASE}${n}.json`).then((r) => { if (!r.ok) throw new Error(`${n}.json ${r.status}`); return r.json(); });
const lazy = new Map();
// Lazy JSON (series, cantons, nationalities): fetched once, cached on the state object.
export function extra(...names) {
  return Promise.all(names.map((n) => {
    if (!lazy.has(n)) lazy.set(n, getJson(n).then((j) => { state[n] = j; return j; }).catch((e) => { lazy.delete(n); throw e; }));
    return lazy.get(n);
  }));
}

export const data = () => state;

export function label(id, lang) {
  const m = state.ind.get(id);
  return m ? (lang === "fr" ? m.label_fr : m.label_en) : id;
}

export function fmt(v, id, lang) {
  const m = state.ind.get(id);
  const d = m ? m.decimals : 0;
  const s = new Intl.NumberFormat(lang === "fr" ? "fr-LU" : "en-GB",
    { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const u = (lang === "fr" ? UNIT_FR[m?.unit] : null) || m?.unit || "";
  if (!u) return s;
  if (u === "%" || u === "‰") return lang === "fr" ? `${s} ${u}` : `${s}${u}`;
  return `${s} ${u}`;
}

const UNIT_FR = { years: "ans", "€/month": "€/mois", "€/inh.": "€/hab." };

// The City of Luxembourg (LAU 0304) is shown as "Luxembourg City" / "Luxembourg-Ville", never just the country name.
export function displayName(c, lang) {
  if (c.lau === "0304") return lang === "fr" ? "Luxembourg-Ville" : "Luxembourg City";
  return c.name;
}

const CITY_ALIASES = new Set(["luxembourgcity", "luxembourgville", "villedeluxembourg"]);

export function findCommune(q, { exact = false } = {}) {
  const n = norm(q);
  if (!n) return null;
  if (CITY_ALIASES.has(n)) return state.byLau.get("0304") || null;
  const exactHit = state.communes.find((c) => norm(c.name) === n);
  if (exactHit || exact) return exactHit || null;
  return state.communes.find((c) => norm(c.name).startsWith(n)) || null;
}

export function sourceName(id) {
  return state.meta.sources[id]?.name || id;
}
