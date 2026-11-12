import { createAttract } from "./attract.js";
import { renderAssistant } from "./assistant.js";
import { renderCommune } from "./commune.js";
import { FACT_MS, IDLE_MS, KIOSK, VIDEO } from "./config.js";
import { displayName, findCommune, loadData } from "./data.js";
import { h } from "./dom.js";
import { createGrMap } from "./grmap.js";
import { applyStatic, getLang, setLang, t, tl } from "./i18n.js";
import { createMap } from "./map.js";
import { comparisons } from "./ouvivre.js";
import { ouvivreState, renderOuvivre, resetOuvivre } from "./ouvivre-ui.js";

const panel = document.getElementById("panel");
const lead = document.getElementById("lead");
const mainEl = document.getElementById("main");
const luSvg = document.getElementById("map");
const grSvg = document.getElementById("grmap");
const legend = document.getElementById("gr-legend");
if (KIOSK) document.body.classList.add("kiosk");

let st;
try {
  st = await loadData();
} catch (err) {
  console.error(err);
  applyStatic();
  panel.replaceChildren(h("p", "chip warn", t("err.load")));
  throw err;
}

const map = createMap(luSvg, st.carte, { onSelect: (lau) => go(`#/c/${lau}`), communes: st.communes });
let ovView = null;
const grmap = createGrMap(grSvg, { places: st.ouvivre.places, carte: st.carte, onSelect: (id) => ovView?.select(id) });
const attract = createAttract(document.getElementById("attract"), map, st.faits, { intervalMs: FACT_MS });

// Home attract: striking comparisons computed from ouvivre.json, interleaved with the existing facts.
function homeFacts() {
  const out = [];
  const fmtEur = (v, lang) => new Intl.NumberFormat(lang === "fr" ? "fr-LU" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const all = comparisons(st.ouvivre, { hub: "kirchberg", size_m2: 70, max: 50 });
  const fr = all.filter((c) => c.country === "FR").slice(0, 3);
  const lu = all.filter((c) => c.country === "LU").slice(0, 3);
  const text = (c, lang) => tl(lang, "cmp", {
    name: c.name, rent: fmtEur(c.rent_less, lang), h: Math.round(c.hours_more), size: c.size_m2, hub: tl(lang, `hub.${c.hub}`),
  });
  const cmps = [];
  for (let i = 0; i < Math.max(fr.length, lu.length); i += 1) for (const c of [fr[i], lu[i]]) if (c) cmps.push(c);
  const facts = st.faits.filter((f) => f.laus.length <= 5);
  for (let i = 0; i < Math.max(cmps.length, facts.length); i += 1) {
    if (cmps[i]) out.push({ en: text(cmps[i], "en"), fr: text(cmps[i], "fr"), laus: [cmps[i].id, cmps[i].ref] });
    if (facts[i]) out.push({ ...facts[i], laus: facts[i].laus.map((l) => `lu:${l}`) });
  }
  return out;
}
const homeAttract = createAttract(document.getElementById("attract"), grmap, homeFacts(), { intervalMs: FACT_MS, cta: "ov.q" });

const wide = matchMedia("(min-width: 900px)");
let assistant = null;

function go(hash) {
  if (location.hash !== hash) history.pushState(null, "", hash);
  route();
}

function renderCountry() {
  panel.replaceChildren();
  const hero = h("div", "lm-hero");
  hero.append(h("p", "eyebrow", t("eyebrow")), h("h1", null, t("tagline")), h("p", "lead", t("tap")));
  const ask = h("button", "btn primary lm-big", t("ask.title"));
  ask.type = "button";
  ask.onclick = () => go("#/ask");
  panel.append(hero, ask, h("p", "muted small", t("built")));
  map.clear();
}

function setView(home) {
  mainEl.classList.toggle("is-home", home);
  lead.hidden = !home;
  grSvg.toggleAttribute("hidden", !home); // SVG elements have no .hidden property: set the attribute
  legend.hidden = !home;
  luSvg.toggleAttribute("hidden", home);
  const cur = (id, on) => { const el = document.getElementById(id); if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); };
  cur("nav-where", home);
  cur("nav-ask", location.hash.startsWith("#/ask"));
}

function route() {
  attract.stop();
  homeAttract.stop();
  assistant?.dispose();
  assistant = null;
  const [, view, arg] = (location.hash || "#/").split("/");
  const home = !view;
  setView(home);
  if (view === "c" && st.byLau.has(arg)) {
    const c = st.byLau.get(arg);
    map.highlight({ focus: [c.lau], twins: c.twins });
    renderCommune(panel, c, { onSelect: (l) => go(`#/c/${l}`), onAsk: (l) => go(`#/ask/${l}`) });
  } else if (view === "ask") {
    map.clear();
    assistant = renderAssistant(panel, { lau: st.byLau.has(arg) ? arg : null, map, onSelect: (l) => go(`#/c/${l}`) });
  } else if (view === "pays") {
    renderCountry();
    if (!VIDEO && (KIOSK || wide.matches)) attract.start();
  } else {
    grmap.clear();
    ovView = renderOuvivre({
      lead, panel, legend, data: st, grmap,
      onCommune: (l) => go(`#/c/${l}`),
      onChange: () => { if (homeAttract.running()) { homeAttract.stop(); grmap.clear(); } },
    });
    if (!VIDEO && KIOSK && !ouvivreState().hub) homeAttract.start();
  }
  panel.scrollTop = 0;
  if (!wide.matches) window.scrollTo(0, 0);
}

// Search box: the datalist offers display names in the current language
const list = document.getElementById("commune-list");
function fillList() {
  list.replaceChildren(...st.communes.map((c) => { const o = document.createElement("option"); o.value = displayName(c, getLang()); return o; }));
}
const input = document.getElementById("search-input");
function search(exact) {
  const c = findCommune(input.value, { exact });
  if (c) { input.value = ""; input.blur(); go(`#/c/${c.lau}`); }
}
document.getElementById("search").addEventListener("submit", (e) => { e.preventDefault(); search(false); });
input.addEventListener("change", () => search(true)); // datalist pick = exact name only

// Language toggle
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
  setLang(b.dataset.lang);
  applyStatic();
  fillList();
  map.relabel(getLang());
  grmap.relabel(getLang());
  route();
}));

// Kiosk: back to the attract screen after IDLE_MS without interaction
if (KIOSK && !VIDEO) {
  let last = Date.now();
  for (const ev of ["pointerdown", "keydown", "touchstart", "wheel", "scroll"]) addEventListener(ev, () => { last = Date.now(); }, { passive: true, capture: true });
  setInterval(() => {
    const home = !location.hash || location.hash === "#/";
    if (Date.now() - last <= IDLE_MS) return;
    if (!home) { resetOuvivre(); go("#/"); } else if (ouvivreState().hub || !homeAttract.running()) { resetOuvivre(); route(); }
  }, 5000);
}

addEventListener("hashchange", route); // go() routes directly; back/forward between hash entries fires hashchange
applyStatic();
fillList();
route();

// Automation hooks for the promo video (task 22) and checks (task 15)
window.LM = {
  go,
  attract: () => attract.start(),
  async ask(question, suggestionId) {
    if (!location.hash.startsWith("#/ask")) go("#/ask");
    return assistant.typeAndAsk(question, suggestionId);
  },
  ready: true,
};
