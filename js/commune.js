/* global QRCode */
// Commune page #/c/<lau>[/<tab>] (plan B3): header with the 200-year population line, six theme tabs
// (tiles for the headline indicators, expandable list for the others, charts per theme), twins, QR, ask button.
import { CAT, groupBars, hbars, lineChart, sparkline, stackBar } from "./charts.js";
import { PUBLIC_URL } from "./config.js";
import { data, displayName, extra, fmt, label } from "./data.js";
import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";
import { block, btn, eur, median, num, pct, srcToggle } from "./ui.js";

export const TABS = ["vivre", "logement", "mobilite", "education", "finances", "democratie"];
const HIDDEN = new Set(["school_shared"]); // shown as a note, not as a figure
const BOOL = new Set(["rail_station"]);
const COMMUTE_HUBS = [["kirchberg", "kirchberg"], ["lux_gare", "lux-gare"], ["belval", "belval"], ["findel", "findel"]];
const FDGC_PARTS = ["fdgc_forfait", "fdgc_population", "fdgc_emplois", "fdgc_socio_eco", "fdgc_logements_sociaux", "fdgc_superficie"];

const medians = new Map();
export function countryMedian(id) {
  if (!medians.has(id)) medians.set(id, median(data().communes.map((c) => c.values[id]?.v)));
  return medians.get(id);
}

export function twinsAvg(c, id) {
  const vals = c.twins.map((l) => data().byLau.get(l)?.values[id]?.v).filter((v) => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function srcOf(id, year) {
  const m = data().ind.get(id);
  const s = m && data().meta.sources[m.source_id];
  return s ? { name: s.name, url: s.url, year } : null;
}

export function valueText(id, v, lang) {
  if (BOOL.has(id)) return v ? t("c.yes") : t("c.no");
  return fmt(v, id, lang);
}

export function rankText(c, id) {
  const r = c.ranks[id];
  const n = data().meta.counts[id];
  if (!r || !n) return null;
  const k = r > n / 2 ? n - r + 1 : r;
  return t((r > n / 2 ? "rankLow" : "rank") + (k === 1 ? "1" : ""), { r: k, n });
}

function tile(c, id, lang) {
  const card = h("div", "card lm-tile");
  card.dataset.ind = id;
  const v = c.values[id];
  const lab = label(id, lang);
  card.append(v ? h("div", "kpi-value", valueText(id, v.v, lang)) : h("div", "kpi-value np", t("np")), h("div", "kpi-label", lab));
  if (v) {
    const sub = [rankText(c, id), String(v.y)].filter(Boolean).join(" · ");
    card.append(h("div", "lm-sub", sub));
    const cmp = [];
    const tw = twinsAvg(c, id);
    if (tw !== null) cmp.push(t("c.twins_avg", { v: fmt(tw, id, lang) }));
    const cn = data().cantons?.cantons.find((k) => k.id === c.canton)?.values[id]?.v;
    if (typeof cn === "number") cmp.push(t("c.canton", { v: fmt(cn, id, lang) }));
    const md = countryMedian(id);
    if (md !== null) cmp.push(t("c.country", { v: fmt(md, id, lang) }));
    if (cmp.length) card.append(h("div", "lm-cmp", cmp.join(" · ")));
  } else if (id === "appt_price_m2") card.append(h("div", "lm-sub", t("fewads")));
  const [b, line] = srcToggle([srcOf(id, v?.y)], lab);
  b.classList.add("lm-tile-i");
  card.append(b, line);
  return card;
}

function listRow(c, id, lang) {
  const v = c.values[id];
  const li = h("li", "cm-li");
  const row = btn("cm-row", null);
  row.append(h("span", "cm-rl", label(id, lang)), v ? h("span", "cm-rv", valueText(id, v.v, lang)) : h("span", "cm-rv np", t("np")));
  const extraLine = h("div", "cm-rx");
  extraLine.hidden = true;
  if (v) extraLine.append(h("span", null, [rankText(c, id), String(v.y)].filter(Boolean).join(" · ")));
  const s = srcOf(id, v?.y);
  if (s) {
    const p = h("p", "src-line");
    p.append(document.createTextNode(`${t("src.of", { s: "" }).trim()} `));
    p.append(document.createTextNode(s.name));
    extraLine.append(p);
  }
  row.setAttribute("aria-expanded", "false");
  row.onclick = () => { extraLine.hidden = !extraLine.hidden; row.setAttribute("aria-expanded", String(!extraLine.hidden)); };
  li.append(row, extraLine);
  return li;
}

// ---- theme extras (charts)
function seriesBlock(c, key, title, lang, ids) {
  const pts = data().series?.[c.lau]?.[key];
  const yr = pts?.length ? `${pts[0][0]}-${pts[pts.length - 1][0]}` : null;
  const { sec, body } = block(title, [srcOf(ids, yr)]);
  if (!pts || pts.length < 2) { body.append(h("p", "muted small", t("c.noseries"))); return { sec }; }
  return { sec, draw: () => lineChart(body, pts, { fmtV: (v) => fmt(v, ids, lang), fmtTick: (v) => num(v, 0, lang), label: title }) };
}

function extras(c, theme, lang) {
  const V = (id) => c.values[id]?.v ?? null;
  const out = []; // { sec, draw? }
  const name = displayName(c, lang);
  if (theme === "vivre") {
    const nat = data().nationalities?.[c.lau];
    if (nat?.length) {
      const { sec, body } = block(t("c.nat"), [{ name: data().meta.sources.rnpp_nationality.name, url: data().meta.sources.rnpp_nationality.url, year: t("src.latest") }]);
      hbars(body, nat.map(([n, p]) => ({ label: t(`nat.${n}`), v: p, display: lang === "fr" ? `${num(p, 1)} %` : `${num(p, 1)}%`, emph: true })));
      body.append(h("p", "muted small", t("c.nat.note")));
      out.push({ sec });
    }
  } else if (theme === "logement") {
    out.push(seriesBlock(c, "sale_price_m2", t("c.sale_series"), lang, "sale_price_m2"));
    out.push(seriesBlock(c, "rent_appt_m2", t("c.rent_series"), lang, "rent_appt_m2"));
  } else if (theme === "mobilite") {
    const { sec, body } = block(t("c.commute"), [srcOf("commute_kirchberg_driving", c.values.commute_kirchberg_driving?.y)]);
    const keys = [{ key: "car", label: t("c.car"), color: CAT[0] }, { key: "tc", label: t("c.transit"), color: CAT[1] }];
    groupBars(body, COMMUTE_HUBS.map(([m, hub]) => {
      const car = V(`commute_${m}_driving`), tc = V(`commute_${m}_transit`);
      return { label: t(`hub.${hub}`), values: { car: car === null ? null : { v: car, display: `${car} min` }, tc: tc === null ? null : { v: tc, display: `${tc} min` } } };
    }), keys);
    out.push({ sec });
    const dep = c.values.pt_departures_p1000;
    const b2 = block(t("c.departures"), [srcOf("pt_departures_p1000", dep?.y)]);
    const md = countryMedian("pt_departures_p1000");
    hbars(b2.body, [
      { label: name, v: V("pt_departures_p1000"), display: V("pt_departures_p1000") === null ? "" : num(V("pt_departures_p1000")), emph: true },
      { label: t("c.median"), v: md, display: md === null ? "" : num(md) },
    ]);
    out.push({ sec: b2.sec });
  } else if (theme === "education") {
    if (c.values.school_shared?.v === 1) out.push({ sec: h("p", "chip warn cm-note", t("c.shared")) });
  } else if (theme === "finances") {
    const y = c.values.fdgc_total?.y;
    const total = V("fdgc_total");
    const b1 = block(t("c.money"), [srcOf("fdgc_total", y)]);
    if (total === null) b1.body.append(h("p", "muted", t("np")));
    else {
      b1.body.append(h("p", "cm-total", t("c.money.total", { v: eur(total) })));
      stackBar(b1.body, FDGC_PARTS.map((id, i) => ({
        label: label(id, lang).replace(/^FDGC - /, ""), v: V(id), display: V(id) === null ? t("np") : eur(V(id)), color: CAT[i],
      })), { share: (p) => pct(p) });
    }
    out.push({ sec: b1.sec });
    const gen = V("icc_generated"), kept = V("icc_direct");
    const b2 = block(t("c.icc"), [srcOf("icc_generated", c.values.icc_generated?.y)]);
    hbars(b2.body, [
      { label: t("c.icc.gen"), v: gen, display: gen === null ? "" : eur(gen), color: "var(--mark-2)" },
      { label: t("c.icc.kept"), v: kept, display: kept === null ? "" : eur(kept), emph: true },
    ]);
    if (gen > 0 && kept !== null) b2.body.append(h("p", "muted small", t("c.icc.share", { p: pct(kept / gen) })));
    out.push({ sec: b2.sec });
    const dpc = V("debt_pc");
    const b3 = block(t("c.debt"), [srcOf("debt_pc", c.values.debt_pc?.y)]);
    const md = countryMedian("debt_pc"), nat = data().national?.debt_pc?.v ?? null;
    hbars(b3.body, [
      { label: name, v: dpc, display: dpc === null ? "" : eur(dpc), emph: true },
      { label: t("c.median"), v: md, display: md === null ? "" : eur(md) },
      { label: t("c.national"), v: nat, display: nat === null ? "" : eur(nat) },
    ]);
    out.push({ sec: b3.sec });
    const ser = data().series?.[c.lau]?.fdgc_icc_pc;
    if (ser?.length) {
      const b4 = block(t("c.fdgc_years"), [srcOf("fdgc_icc_pc", `${ser[0][0]}-${ser[ser.length - 1][0]}`)]);
      hbars(b4.body, ser.map(([yy, v], i) => ({ label: String(yy), v, display: eur(v), emph: i === ser.length - 1 })));
      out.push({ sec: b4.sec });
    }
    out.push({ sec: h("p", "muted small cm-note", t("c.finance_note")) });
  } else if (theme === "democratie") {
    const sys = data().electoral?.[c.lau];
    if (sys) {
      const { sec, body } = block(t("c.system"), [srcOf("turnout_2023", 2023)]);
      body.append(h("p", "cm-total", t(`c.system.${sys}`)));
      out.push({ sec });
    }
    const v = V("turnout_2023"), md = countryMedian("turnout_2023");
    const b = block(t("c.turnout_cmp"), [srcOf("turnout_2023", 2023)]);
    hbars(b.body, [
      { label: name, v, display: v === null ? "" : fmt(v, "turnout_2023", lang), emph: true },
      { label: t("c.median"), v: md, display: md === null ? "" : fmt(md, "turnout_2023", lang) },
    ], { max: 100 });
    out.push({ sec: b.sec });
  }
  return out;
}

function renderTab(box, c, theme, lang) {
  const inds = data().meta.indicators.filter((m) => m.theme === theme && !HIDDEN.has(m.id));
  const tiles = h("div", "lm-tiles");
  for (const m of inds.filter((x) => x.tile)) tiles.append(tile(c, m.id, lang));
  const parts = [tiles];
  const ex = extras(c, theme, lang);
  parts.push(...ex.map((e) => e.sec));
  const others = inds.filter((x) => !x.tile);
  if (others.length) {
    const det = h("details", "cm-more");
    det.append(h("summary", null, t("c.allfig", { n: others.length })));
    const ul = h("ul", "cm-list");
    for (const m of others) ul.append(listRow(c, m.id, lang));
    det.append(ul);
    parts.push(det);
  }
  box.replaceChildren(...parts);
  for (const e of ex) e.draw?.();
}

export async function renderCommune(el, c, { tab, onSelect, onAsk, onTab, go, isCurrent = () => true }) {
  const lang = getLang();
  const name = displayName(c, lang);
  el.replaceChildren(h("p", "muted", t("c.loading")));
  try { await extra("series", "nationalities", "cantons"); } catch (err) { console.warn("extra data unavailable", err); }
  if (!isCurrent()) return;
  const theme = TABS.includes(tab) ? tab : "vivre";

  // header
  const head = h("div", "cm-head");
  head.append(h("p", "eyebrow", t("canton", { c: c.canton })), h("h1", "lm-title", name));
  const pop = c.values.pop;
  const popLine = h("div", "cm-popline");
  popLine.append(h("span", "cm-pop", pop ? t("c.pop", { n: num(pop.v), y: pop.y }) : t("np")));
  const hist = data().series?.[c.lau]?.pop;
  const spark = h("div", "cm-spark");
  const [pb, pline] = srcToggle([srcOf("pop", hist ? `${hist[0][0]}-${hist[hist.length - 1][0]}` : pop?.y)], label("pop", lang));
  popLine.append(pb);
  head.append(popLine);
  if (hist?.length > 1) head.append(h("p", "cm-hist", t("c.history", { y0: hist[0][0] })), spark);
  head.append(pline);

  // tabs
  const bar = h("div", "cm-tabs");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", t("tabs.label"));
  const panelBox = h("div", "cm-tabpanel");
  panelBox.setAttribute("role", "tabpanel");
  const tabBtns = TABS.map((k) => {
    const b = btn("cm-tab", t(`tab.${k}`), () => select(k));
    b.setAttribute("role", "tab");
    b.dataset.tab = k;
    b.id = `tab-${k}`;
    return b;
  });
  bar.append(...tabBtns);
  function select(k) {
    for (const b of tabBtns) b.setAttribute("aria-selected", String(b.dataset.tab === k));
    panelBox.setAttribute("aria-labelledby", `tab-${k}`);
    renderTab(panelBox, c, k, lang);
    onTab?.(k);
  }

  // actions
  const acts = h("div", "lm-row cm-acts");
  acts.append(btn("btn", t("c.compare"), () => go(`#/compare/${c.lau}`)), btn("btn", t("c.from"), () => go(`#/from/lu:${c.lau}`)));

  const twins = h("div");
  twins.append(h("p", "section-title", t("twins", { name })));
  const row = h("div", "lm-row");
  for (const lau of c.twins) row.append(btn("btn small", displayName(data().byLau.get(lau), lang), () => onSelect(lau)));
  twins.append(row);

  const notes = h("div");
  const note = (kind, rec) => {
    const p = h("p", "lm-note");
    p.append(h("b", null, `${t(kind)} · `),
      document.createTextNode(`${label(rec.ind, lang)} : ${t("vs", { v: fmt(rec.v, rec.ind, lang), t: fmt(rec.twins_avg, rec.ind, lang) })}`));
    return p;
  };
  if (c.strength) notes.append(note("strength", c.strength));
  if (c.attention) notes.append(note("attention", c.attention));

  const ask = btn("btn primary lm-big", t("open_ask", { name }), () => onAsk(c.lau));

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

  el.replaceChildren(head, bar, panelBox, acts, twins, notes, ask, ...(qrOk ? [qrbox] : []));
  if (hist?.length > 1) sparkline(spark, hist, { fmtV: (v) => num(v), label: t("c.history", { y0: hist[0][0] }) });
  for (const b of tabBtns) b.setAttribute("aria-selected", String(b.dataset.tab === theme));
  panelBox.setAttribute("aria-labelledby", `tab-${theme}`);
  renderTab(panelBox, c, theme, lang);
}

