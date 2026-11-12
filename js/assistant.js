import { ASK_TIMEOUT_MS, ASK_URL, VIDEO } from "./config.js";
import { data, displayName, fmt, label, sourceName } from "./data.js";
import { h, sleep } from "./dom.js";
import { getLang, t } from "./i18n.js";
import { extLink } from "./ui.js";

const UNIT_FR = { "€/month": "€/mois", "€/inh.": "€/hab.", places: "places", h: "h" };
const UNIT_EN = { places: "places" };

// Figure of the v2 answer (cross-border place, canton or national): the server sends its label, unit and year.
export function figureText(f, lang, { communeName = (l) => l } = {}) {
  if (!f.label) return null;
  const name = f.place === "national" ? t("ask.national") : f.commune ? communeName(f.commune) : f.name || f.place;
  const d = Number.isInteger(f.value) ? 0 : 1;
  const s = new Intl.NumberFormat(lang === "fr" ? "fr-LU" : "en-GB", { maximumFractionDigits: d }).format(f.value);
  const u = (lang === "fr" ? UNIT_FR[f.unit] : UNIT_EN[f.unit]) ?? f.unit ?? "";
  const v = !u ? s : u === "%" ? (lang === "fr" ? `${s} %` : `${s}%`) : `${s} ${u}`;
  const label = f.label[lang] || f.label.en;
  return `${name} — ${label} : ${v}${f.year != null && f.year !== "" ? ` (${f.year})` : ""}`;
}

let fallback = null;
async function loadFallback() {
  if (fallback) return fallback;
  try {
    const r = await fetch("fallback/answers.json");
    if (!r.ok) return {};
    fallback = await r.json();
  } catch {
    return {};
  }
  return fallback;
}

export function isValid(res) {
  return !!res && typeof res.text === "string"
    && (res.communes === undefined || (Array.isArray(res.communes) && res.communes.every((x) => typeof x === "string")))
    && (res.places === undefined || (Array.isArray(res.places) && res.places.every((x) => typeof x === "string")))
    && (res.figures === undefined || (Array.isArray(res.figures) && res.figures.every((f) => f && typeof f.value === "number"
      && (f.label === undefined || (f.label && typeof f.label === "object")))));
}

export async function askApi(question, lang, lau, { url = ASK_URL, timeoutMs = ASK_TIMEOUT_MS, signal } = {}) {
  if (!url) throw new Error("offline");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, lang, lau }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const j = await r.json();
    if (!isValid(j)) throw new Error("bad response");
    return j;
  } finally {
    clearTimeout(timer);
  }
}

export function renderAssistant(el, { lau, map, onSelect }) {
  const lang = getLang();
  const st = data();
  const title = h("div");
  title.append(h("p", "eyebrow", t("eyebrow")), h("h1", "lm-title", t("ask.title")));
  if (lau && st.byLau.has(lau)) title.append(h("p", "chip emph", t("ask.about", { name: displayName(st.byLau.get(lau), lang) })));
  const intro = h("p", "lead", t("ask.intro"));

  const sugg = h("div", "lm-sugg");
  for (const [id, q] of Object.entries(st.suggestions)) {
    const b = h("button", "btn", q[lang]);
    b.type = "button";
    b.onclick = () => run(q[lang], id);
    sugg.append(b);
  }

  const form = h("form", "lm-askform");
  const input = h("input");
  input.placeholder = t("ask.placeholder");
  input.maxLength = 300;
  input.setAttribute("aria-label", t("ask.placeholder"));
  const send = h("button", "btn primary", t("ask.send"));
  send.type = "submit";
  form.append(input, send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value.trim().length >= 3) run(input.value.trim(), null);
  });

  const answer = h("div");
  const privacy = h("p", "lm-sub", t("ask.privacy"));
  el.replaceChildren(title, intro, sugg, form, privacy, answer);

  let seq = 0;
  let disposed = false;
  const abort = new AbortController();
  async function run(question, suggestionId) {
    const my = ++seq;
    answer.replaceChildren(h("p", "muted lm-thinking", t("ask.thinking")));
    let res = null;
    if (!VIDEO) {
      try { res = await askApi(question, lang, lau, { signal: abort.signal }); } catch { res = null; }
    }
    if (!res && suggestionId) {
      const fb = await loadFallback();
      res = fb?.[lang]?.[suggestionId] || null;
      if (!isValid(res)) res = null;
      if (VIDEO && res) await sleep(1800);
    }
    if (my !== seq || disposed) return; // a newer question was asked meanwhile
    if (!res) {
      answer.replaceChildren(h("p", "chip warn", t("ask.offline")));
      return;
    }
    show(res);
  }

  function show(res) {
    const box = h("div", "lm-answer");
    box.append(h("p", "lm-answer-text", res.text));
    map.highlight({ answer: res.communes || [] });

    if (res.communes?.length) {
      const row = h("div", "lm-row");
      for (const l of res.communes) {
        const c = st.byLau.get(l);
        if (!c) continue;
        const b = h("button", "btn small", displayName(c, lang));
        b.type = "button";
        b.onclick = () => onSelect(l);
        row.append(b);
      }
      box.append(row);
    }
    const ovPlaces = new Map((st.ouvivre?.places || []).map((p) => [p.id, p]));
    const cross = (res.places || []).map((id) => ovPlaces.get(id)).filter(Boolean);
    if (cross.length) {
      const row = h("div", "lm-row lm-places");
      row.append(h("span", "muted small", `${t("ask.places")} :`));
      for (const p of cross) {
        const b = h("button", "btn small", `${p.name} (${p.country})`);
        b.type = "button";
        b.onclick = () => { location.hash = `#/p/${encodeURIComponent(p.id)}`; };
        row.append(b);
      }
      box.append(row);
    }
    if (res.figures?.length) {
      box.append(h("p", "section-title", t("ask.figures")));
      const ul = h("ul", "lm-figs");
      const communeName = (l) => { const c = st.byLau.get(l); return c ? displayName(c, lang) : l; };
      for (const f of res.figures) {
        const v2 = figureText(f, lang, { communeName });
        ul.append(h("li", null, v2 ?? `${communeName(f.commune)} — ${label(f.indicator, lang)} : ${fmt(f.value, f.indicator, lang)} (${f.year})`));
      }
      box.append(ul);
    }
    if (res.sources?.length) {
      const row = h("div", "lm-row");
      row.append(h("span", "muted small", `${t("ask.sources")} :`));
      const details = new Map((res.source_details || []).map((x) => [x.id, x]));
      for (const id of res.sources) {
        const d = details.get(id);
        const known = st.meta.sources[id] || st.ouvivre?.sources?.[id];
        const name = known?.name || d?.name || sourceName(id);
        const chip = h("span", "chip");
        chip.append(extLink(name, known?.url || d?.url || ""));
        row.append(chip);
      }
      box.append(row);
    }
    if (res.followup) {
      const b = h("button", "btn ghost", `→ ${res.followup}`);
      b.type = "button";
      b.onclick = () => { input.value = res.followup; run(res.followup, null); };
      box.append(b);
    }
    answer.replaceChildren(box);
  }

  async function typeAndAsk(question, suggestionId, cps = 18) {
    input.value = "";
    for (const ch of question) {
      input.value += ch;
      await sleep(1000 / cps);
    }
    return run(question, suggestionId);
  }

  function dispose() { disposed = true; abort.abort(); }
  return { run, typeAndAsk, dispose };
}
