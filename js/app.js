import { createAttract } from "./attract.js";
import { renderAssistant } from "./assistant.js";
import { renderCommune } from "./commune.js";
import { FACT_MS, IDLE_MS, KIOSK, VIDEO } from "./config.js";
import { displayName, findCommune, loadData } from "./data.js";
import { h } from "./dom.js";
import { applyStatic, getLang, setLang, t } from "./i18n.js";
import { createMap } from "./map.js";

const panel = document.getElementById("panel");
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

const map = createMap(document.getElementById("map"), st.carte, { onSelect: (lau) => go(`#/c/${lau}`), communes: st.communes });
const attract = createAttract(document.getElementById("attract"), map, st.faits, { intervalMs: FACT_MS });
const wide = matchMedia("(min-width: 900px)");
let assistant = null;

function go(hash) {
  if (location.hash !== hash) history.pushState(null, "", hash);
  route();
}

function renderHome() {
  panel.replaceChildren();
  const hero = h("div", "lm-hero");
  hero.append(h("p", "eyebrow", t("eyebrow")), h("h1", null, t("tagline")), h("p", "lead", t("tap")));
  const ask = h("button", "btn primary lm-big", t("ask.title"));
  ask.type = "button";
  ask.onclick = () => go("#/ask");
  panel.append(hero, ask, h("p", "muted small", t("built")));
  map.clear();
}

function route() {
  attract.stop();
  assistant = null;
  const [, view, arg] = (location.hash || "#/").split("/");
  if (view === "c" && st.byLau.has(arg)) {
    const c = st.byLau.get(arg);
    map.highlight({ focus: [c.lau], twins: c.twins });
    renderCommune(panel, c, { onSelect: (l) => go(`#/c/${l}`), onAsk: (l) => go(`#/ask/${l}`) });
  } else if (view === "ask") {
    map.clear();
    assistant = renderAssistant(panel, { lau: st.byLau.has(arg) ? arg : null, map, onSelect: (l) => go(`#/c/${l}`) });
  } else {
    renderHome();
    if (!VIDEO && (KIOSK || wide.matches)) attract.start();
  }
  panel.scrollTop = 0;
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
  route();
}));

// Kiosk: back to the attract screen after IDLE_MS without interaction
if (KIOSK) {
  let last = Date.now();
  for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, () => { last = Date.now(); }, { passive: true });
  setInterval(() => {
    const home = !location.hash || location.hash === "#/";
    if (!home && Date.now() - last > IDLE_MS) go("#/");
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
