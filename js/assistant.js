import { ASK_TIMEOUT_MS, ASK_URL, VIDEO } from "./config.js";
import { data, displayName, fmt, label, sourceName } from "./data.js";
import { h, sleep } from "./dom.js";
import { getLang, t } from "./i18n.js";

let fallback = null;
async function loadFallback() {
  if (fallback) return fallback;
  try {
    const r = await fetch("fallback/answers.json");
    fallback = r.ok ? await r.json() : {};
  } catch {
    fallback = {};
  }
  return fallback;
}

export async function askApi(question, lang, lau, { url = ASK_URL, timeoutMs = ASK_TIMEOUT_MS } = {}) {
  if (!url) throw new Error("offline");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, lang, lau }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const j = await r.json();
    if (!j || typeof j.text !== "string") throw new Error("bad response");
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
  el.replaceChildren(title, intro, sugg, form, answer);

  let seq = 0;
  async function run(question, suggestionId) {
    const my = ++seq;
    answer.replaceChildren(h("p", "muted lm-thinking", t("ask.thinking")));
    let res = null;
    if (!VIDEO) {
      try { res = await askApi(question, lang, lau); } catch { res = null; }
    }
    if (!res && suggestionId) {
      const fb = await loadFallback();
      res = fb?.[lang]?.[suggestionId] || null;
      if (VIDEO && res) await sleep(1800);
    }
    if (my !== seq) return; // a newer question was asked meanwhile
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
    if (res.figures?.length) {
      box.append(h("p", "section-title", t("ask.figures")));
      const ul = h("ul", "lm-figs");
      for (const f of res.figures) {
        const fc = st.byLau.get(f.commune);
        const name = fc ? displayName(fc, lang) : f.commune;
        ul.append(h("li", null, `${name} — ${label(f.indicator, lang)} : ${fmt(f.value, f.indicator, lang)} (${f.year})`));
      }
      box.append(ul);
    }
    if (res.sources?.length) {
      const row = h("div", "lm-row");
      row.append(h("span", "muted small", `${t("ask.sources")} :`));
      for (const s of res.sources) row.append(h("span", "chip", sourceName(s)));
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

  return { run, typeAndAsk };
}
