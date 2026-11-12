import { createAttract } from "./attract.js";
import { createChat } from "./assistant.js";
import { TABS, renderCommune } from "./commune.js";
import { FACT_MS, IDLE_MS, KIOSK, VIDEO } from "./config.js";
import { displayName, findCommune, loadData } from "./data.js";
import { h } from "./dom.js";
import { createGrMap } from "./grmap.js";
import { applyStatic, getLang, setLang, t, tl } from "./i18n.js";
import { createMap } from "./map.js";
import { comparisons } from "./ouvivre.js";
import { ouvivreContext, ouvivreState, preselectOuvivre, renderOuvivre, resetOuvivre } from "./ouvivre-ui.js";
import { renderCompare } from "./compare.js";
import { renderCountry, renderPlace, renderSources } from "./pages.js";

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
const grmap = createGrMap(grSvg, {
  places: st.ouvivre.places, carte: st.carte, onSelect: (id) => ovView?.select(id), onHover: (id) => ovView?.hover(id),
  getHub: () => ouvivreState().hub,
  onUserMode: () => { if (homeAttract.running()) { homeAttract.stop(); grmap.clear(); } }, // a tap on km/minutes ends the attract loop
});
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
// Each attract step also alternates the map: km, minutes by car, minutes by public transport (plan B2).
const grAttract = {
  highlight: (g) => { grmap.attractStep(); grmap.highlight(g); },
  clear: () => { grmap.attractStep(); grmap.clear(); },
};
const homeAttract = createAttract(document.getElementById("attract"), grAttract, homeFacts(), { intervalMs: FACT_MS, cta: "ov.q" });

const wide = matchMedia("(min-width: 900px)");

// Page context sent with each question to the assistant (validated again by the server).
function getContext() {
  const [, view = "", arg = "", tab] = (location.hash || "#/").split("/");
  const id = decodeURIComponent(arg);
  if (view === "c" && st.byLau.has(arg)) return { page: "commune", lau: arg, tab: TABS.includes(tab) ? tab : "vivre" };
  if (view === "p" && st.ouvivre.places.some((p) => p.id === id)) return { page: "place", place: id };
  if (view === "compare") {
    const places = location.hash.split("/").slice(2).filter(Boolean).map(decodeURIComponent);
    return { page: "compare", places };
  }
  if (view === "pays") return { page: "pays" };
  if (view === "" || view === "from") return { page: "ouvivre", ...ouvivreContext() };
  return { page: "other" };
}
// Answers light up communes / places on whichever map is visible.
function highlightAnswer(ids) {
  if (mainEl.classList.contains("is-home")) grmap.highlightPlaces(ids);
  else if (!mainEl.classList.contains("is-full")) map.highlight({ answer: ids.map((x) => (/^lu:\d{4}$/.test(x) ? x.slice(3) : x)).filter((x) => /^\d{4}$/.test(x)) });
}
const chat = createChat({
  getContext, highlight: highlightAnswer, navigate: (hash) => go(hash),
  onOpen: () => { attract.stop(); if (homeAttract.running()) { homeAttract.stop(); grmap.clear(); } },
});
let lastPage = "#/";

function go(hash) {
  if (location.hash !== hash) history.pushState(null, "", hash);
  route();
}

// mode: "home" (Greater Region map + choices), "map" (LU map + panel), "full" (panel only, full width)
function setView(mode) {
  const home = mode === "home";
  mainEl.classList.toggle("is-home", home);
  mainEl.classList.toggle("is-full", mode === "full");
  lead.hidden = !home;
  grSvg.toggleAttribute("hidden", !home); // SVG elements have no .hidden property: set the attribute
  legend.hidden = !home;
  luSvg.toggleAttribute("hidden", home);
  const cur = (id, on) => { const el = document.getElementById(id); if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); };
  cur("nav-where", home);
  document.querySelectorAll(".lm-foot a[href]").forEach((a) => {
    if (location.hash.startsWith(a.getAttribute("href"))) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

let seq = 0;
function route() {
  attract.stop();
  homeAttract.stop();
  const my = ++seq;
  const isCurrent = () => my === seq;
  let parts = (location.hash || "#/").split("/");
  if (parts[1] === "from" && parts[2]) {
    // "Where to live from here?": home with this place selected
    preselectOuvivre(decodeURIComponent(parts[2]));
    history.replaceState(null, "", "#/");
    parts = ["#", ""];
  }
  if (parts[1] === "ask") {
    // "#/ask[/<lau>]" opens the bubble on top of the commune page (or the page the visitor came from)
    const l = st.byLau.has(parts[2]) ? parts[2] : null;
    history.replaceState(null, "", l ? `#/c/${l}` : lastPage);
    route();
    chat.open();
    return;
  }
  lastPage = location.hash || "#/";
  const [, view, arg] = parts;
  const place = view === "p" ? st.ouvivre.places.find((x) => x.id === decodeURIComponent(arg || "")) : null;
  if (place?.lau && st.byLau.has(place.lau)) { history.replaceState(null, "", `#/c/${place.lau}`); route(); return; }
  if (view === "c" && st.byLau.has(arg)) {
    setView("map");
    const c = st.byLau.get(arg);
    map.highlight({ focus: [c.lau], twins: c.twins });
    renderCommune(panel, c, {
      tab: parts[3], go, isCurrent,
      onSelect: (l) => go(`#/c/${l}`), onAsk: () => chat.open(),
      onTab: (k) => history.replaceState(null, "", `#/c/${c.lau}/${k}`),
    });
  } else if (view === "pays") {
    setView("map");
    map.clear();
    renderCountry(panel, { onAsk: () => chat.open() });
    if (!VIDEO && (KIOSK || wide.matches)) attract.start();
  } else if (place) {
    setView("full");
    renderPlace(panel, place, { go });
  } else if (view === "compare") {
    setView("full");
    renderCompare(panel, parts.slice(2).filter(Boolean), { go });
  } else if (view === "sources") {
    setView("full");
    renderSources(panel);
  } else {
    setView("home");
    grmap.clear();
    ovView = renderOuvivre({
      lead, panel, legend, data: st, grmap,
      onCommune: (l) => go(`#/c/${l}`), go, onAsk: () => chat.open(),
      onChange: () => { if (homeAttract.running()) { homeAttract.stop(); grmap.clear(); grmap.setMode("km"); } chat.refresh(); },
    });
    if (!VIDEO && KIOSK && !ouvivreState().touched) { grmap.resetAttract(); homeAttract.start(); }
  }
  panel.scrollTop = 0;
  if (!wide.matches) window.scrollTo(0, 0);
  chat.refresh();
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

// The nav "Ask" link opens the bubble (its href #/ask still works without JS routing)
document.getElementById("nav-ask").addEventListener("click", (e) => { e.preventDefault(); chat.open(); });

// Kiosk: back to the attract screen after IDLE_MS without interaction
if (KIOSK && !VIDEO) {
  let last = Date.now();
  for (const ev of ["pointerdown", "keydown", "touchstart", "wheel", "scroll"]) addEventListener(ev, () => { last = Date.now(); }, { passive: true, capture: true });
  setInterval(() => {
    const home = !location.hash || location.hash === "#/";
    if (Date.now() - last <= IDLE_MS) return;
    if (chat.isOpen() || chat.hasThread()) { chat.close({ restoreFocus: false }); chat.reset(); }
    if (!home) { resetOuvivre(); go("#/"); } else if (ouvivreState().touched || !homeAttract.running()) { resetOuvivre(); route(); }
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
    return chat.typeAndAsk(question, suggestionId);
  },
  chat,
  ready: true,
};
