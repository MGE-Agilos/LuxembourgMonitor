let state = null;

export function norm(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

export async function loadData(base = "data/") {
  const names = ["meta", "communes", "carte", "faits", "suggestions"];
  const [meta, communes, carte, faits, suggestions] = await Promise.all(names.map((n) =>
    fetch(`${base}${n}.json`).then((r) => { if (!r.ok) throw new Error(`${n}.json ${r.status}`); return r.json(); })));
  state = {
    meta, communes, carte, faits, suggestions,
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

export function findCommune(q) {
  const n = norm(q);
  if (!n) return null;
  return state.communes.find((c) => norm(c.name) === n)
    || state.communes.find((c) => norm(c.name).startsWith(n)) || null;
}

export function sourceName(id) {
  return state.meta.sources[id]?.name || id;
}
