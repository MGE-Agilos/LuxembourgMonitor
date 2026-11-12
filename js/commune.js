/* global QRCode */
import { PUBLIC_URL } from "./config.js";
import { data, displayName, fmt, label } from "./data.js";
import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";

const TILES = ["pop", "under20_share", "over65_share", "unemployment_rate", "appt_price_m2", "dist_lux_km"];

function tile(c, id, lang) {
  const card = h("div", "card lm-tile");
  const v = c.values[id];
  card.append(h("div", "kpi-value", v ? fmt(v.v, id, lang) : "–"), h("div", "kpi-label", label(id, lang)));
  const sub = h("div", "lm-sub");
  if (id === "pop" && c.values.pop_growth_10y) {
    const g = c.values.pop_growth_10y.v;
    sub.textContent = t("growth", { g: (g >= 0 ? "+" : "") + fmt(g, "pop_growth_10y", lang) });
  } else if (!v && id === "appt_price_m2") {
    sub.textContent = t("fewads");
  } else if (v && c.ranks[id]) {
    const n = data().meta.counts[id], r = c.ranks[id];
    const k = r > n / 2 ? n - r + 1 : r;
    const key = (r > n / 2 ? "rankLow" : "rank") + (k === 1 ? "1" : "");
    sub.textContent = `${t(key, { r: k, n })} · ${v.y}`;
  }
  card.append(sub);
  return card;
}

function note(kind, rec, lang) {
  const p = h("p", "lm-note");
  p.append(h("b", null, `${t(kind)} · `),
    document.createTextNode(`${label(rec.ind, lang)} : ${t("vs", { v: fmt(rec.v, rec.ind, lang), t: fmt(rec.twins_avg, rec.ind, lang) })}`));
  return p;
}

export function renderCommune(el, c, { onSelect, onAsk }) {
  const lang = getLang();
  const name = displayName(c, lang);
  const head = h("div");
  head.append(h("p", "eyebrow", t("canton", { c: c.canton })), h("h1", "lm-title", name));

  const tiles = h("div", "lm-tiles");
  for (const id of TILES) tiles.append(tile(c, id, lang));

  const twins = h("div");
  twins.append(h("p", "section-title", t("twins", { name })));
  const row = h("div", "lm-row");
  for (const lau of c.twins) {
    const b = h("button", "btn small", displayName(data().byLau.get(lau), lang));
    b.type = "button";
    b.onclick = () => onSelect(lau);
    row.append(b);
  }
  twins.append(row);

  const notes = h("div");
  if (c.strength) notes.append(note("strength", c.strength, lang));
  if (c.attention) notes.append(note("attention", c.attention, lang));

  const ask = h("button", "btn primary lm-big", t("open_ask", { name }));
  ask.type = "button";
  ask.onclick = () => onAsk(c.lau);

  const qrbox = h("div", "lm-qrbox");
  const qr = h("div", "lm-qr");
  let qrOk = false;
  try {
    if (typeof QRCode !== "undefined") {
      new QRCode(qr, { text: `${PUBLIC_URL}#/c/${c.lau}`, width: 120, height: 120, colorDark: "#030649", colorLight: "#ffffff" });
      qrOk = true;
    }
  } catch (err) { console.warn("QR unavailable", err); }
  qrbox.append(qr, h("p", "muted small", t("scan", { name })));

  el.replaceChildren(head, tiles, twins, notes, ask, ...(qrOk ? [qrbox] : []));
}
