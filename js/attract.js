import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";

export function createAttract(el, map, facts, { intervalMs }) {
  let timer = null;
  let i = 0;
  function show() {
    const f = facts[i % facts.length];
    i += 1;
    el.replaceChildren(h("p", "lm-attract-fact", getLang() === "fr" ? f.fr : f.en), h("p", "lm-attract-cta", t("tagline")));
    if (f.laus.length > 5) map.clear(); // country-wide fact: no single commune to light up
    else map.highlight({ focus: f.laus });
  }
  return {
    start() {
      if (timer || !facts.length) return;
      el.hidden = false;
      show();
      timer = setInterval(show, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      el.hidden = true;
    },
    running: () => timer !== null,
  };
}
