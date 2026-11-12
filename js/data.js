let state = null;

export function norm(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

export async function loadData(base = "data/") {
  const names = ["meta", "communes", "carte", "faits", "suggestions", "ouvivre"];
  const [meta, communes, carte, faits, suggestions, ouvivre] = await Promise.all(names.map((n) =>
    fetch(`${base}${n}.json`).then((r) => { if (!r.ok) throw new Error(`${n}.json ${r.status}`); return r.json(); })));
  state = {
    meta, communes, carte, faits, suggestions, ouvivre,
    byLau: new Map(communes.map((c) => [c.lau, c])),
    ind: new Map(meta.indicators.map((m) => [m.id, m])),
  };
  return state;
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
  const u = m?.unit || "";
  if (!u) return s;
  if (u === "%" || u === "‰") return lang === "fr" ? `${s} ${u}` : `${s}${u}`;
  return `${s} ${u}`;
}

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
