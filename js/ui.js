// Small shared UI helpers for the B3 pages: formatting, buttons, "source on tap", not-published values.
import { KIOSK } from "./config.js";
import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";

export const loc = (lang = getLang()) => (lang === "fr" ? "fr-LU" : "en-GB");
export const num = (v, d = 0, lang = getLang()) =>
  new Intl.NumberFormat(loc(lang), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
export const eur = (v, lang = getLang()) =>
  new Intl.NumberFormat(loc(lang), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
// Large amounts in compact form: "3.34 bn €" / "3,34 Md €"
export const eurBig = (v, lang = getLang()) => (Math.abs(v) >= 1e6
  ? new Intl.NumberFormat(loc(lang), { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 2 }).format(v)
  : eur(v, lang));
export const pct = (v, d = 0, lang = getLang()) =>
  new Intl.NumberFormat(loc(lang), { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
export const signed = (s, v) => (v > 0 ? `+${s}` : s);

export function btn(cls, text, onClick) {
  const b = h("button", cls, text);
  b.type = "button";
  if (onClick) b.onclick = onClick;
  return b;
}

export function link(text, href, cls) {
  const a = h("a", cls, text);
  a.href = href;
  return a;
}

// External link (plain text in kiosk mode: no way to leave the app on the stand).
export function extLink(text, url) {
  if (!url || KIOSK) return document.createTextNode(text);
  const a = h("a", null, text);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

// Source line content: "Source: A (2026) · B".
export function sourceLine(items) {
  const p = h("p", "src-line");
  p.append(document.createTextNode(`${t("src.of", { s: "" }).trim()} `));
  items.filter((s) => s && s.name).forEach((s, i) => {
    if (i) p.append(document.createTextNode(" · "));
    p.append(extLink(s.name, s.url));
    if (s.year) p.append(document.createTextNode(` (${s.year})`));
  });
  return p;
}

// "i" button that reveals the source(s) of a figure; returns [button, hidden line]. The button sits in `host`.
export function srcToggle(items, what) {
  const line = sourceLine(items);
  line.hidden = true;
  const b = btn("src-i", "i", () => {
    line.hidden = !line.hidden;
    b.setAttribute("aria-expanded", String(!line.hidden));
  });
  b.setAttribute("aria-label", `${t("src.btn")} : ${what}`);
  b.setAttribute("aria-expanded", "false");
  return [b, line];
}

export function npSpan(cls = "np") {
  return h("span", cls, t("np"));
}

// A titled block (card) with an optional source button and a body for a chart.
export function block(title, sources, cls = "") {
  const sec = h("section", `card cm-block ${cls}`.trim());
  const head = h("div", "cm-bhead");
  head.append(h("h3", "cm-btitle", title));
  sec.append(head);
  const body = h("div", "cm-bbody");
  sec.append(body);
  if (sources && sources.length) {
    const [b, line] = srcToggle(sources, title);
    head.append(b);
    sec.append(line);
  }
  return { sec, body };
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
