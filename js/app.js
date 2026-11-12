import { FACT_MS, IDLE_MS, KIOSK, VIDEO } from "./config.js";
import { findCommune, loadData } from "./data.js";
import { h } from "./dom.js";
import { applyStatic, setLang, t } from "./i18n.js";
import { createMap } from "./map.js";

const st = await loadData();
const panel = document.getElementById("panel");
if (KIOSK) document.body.classList.add("kiosk");

const map = createMap(document.getElementById("map"), st.carte, { onSelect: (lau) => go(`#/c/${lau}`) });

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
  const [, view, arg] = (location.hash || "#/").split("/");
  if (view === "c" && st.byLau.has(arg)) {
    const c = st.byLau.get(arg);
    map.highlight({ focus: [c.lau], twins: c.twins });
    panel.replaceChildren(h("h1", "lm-title", c.name)); // replaced by renderCommune in task 12
  } else {
    renderHome();
  }
}

// Search box
const list = document.getElementById("commune-list");
list.replaceChildren(...st.communes.map((c) => { const o = document.createElement("option"); o.value = c.name; return o; }));
const input = document.getElementById("search-input");
function search() {
  const c = findCommune(input.value);
  if (c) { input.value = ""; input.blur(); go(`#/c/${c.lau}`); }
}
document.getElementById("search").addEventListener("submit", (e) => { e.preventDefault(); search(); });
input.addEventListener("change", search);

// Language toggle
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
  setLang(b.dataset.lang);
  applyStatic();
  route();
}));

addEventListener("popstate", route);
addEventListener("hashchange", route);
applyStatic();
route();

window.LM = { go, ready: true };
