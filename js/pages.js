// Cross-border place page #/p/<id>, "everyday problems" (#/pays and home teaser) and sources #/sources (plan B3).
import { CAT, groupBars, hbars, lineChart } from "./charts.js";
import { data } from "./data.js";
import { h } from "./dom.js";
import { placeName } from "./grmap.js";
import { getLang, t } from "./i18n.js";
import { HUBS, computePlaces } from "./ouvivre.js";
import { block, btn, eur, eurBig, extLink, link, num, pct, signed, srcToggle } from "./ui.js";

const ovSrc = (id, year) => {
  const s = data().ouvivre.sources[id];
  return s ? { name: s.name, url: s.url, year } : null;
};
const metaSrc = (id, year) => {
  const s = data().meta.sources[id];
  return s ? { name: s.name, url: s.url, year } : null;
};
const refSrc = (id, year) => {
  const s = (data().ouvivre.reference.sources || []).find((x) => x.id === id);
  return s ? { name: s.name, url: s.url, year } : null;
};
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const igssDate = () => {
  const d = data().ouvivre.workers_total?.date || "";
  const m = d.match(/^(\d{4})\.(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : d;
};
const pctUnit = (v, d, lang) => (lang === "fr" ? `${num(v, d)} %` : `${num(v, d)}%`);

// A figure tile with its source on tap.
function figTile(value, labelText, sub, sources) {
  const card = h("div", "card lm-tile");
  card.append(value === null ? h("div", "kpi-value np", t("np")) : h("div", "kpi-value", value), h("div", "kpi-label", labelText));
  if (sub) card.append(h("div", "lm-sub", sub));
  const [b, line] = srcToggle(sources.filter(Boolean), labelText);
  b.classList.add("lm-tile-i");
  card.append(b, line);
  return card;
}

// ---------------------------------------------------------------- cross-border place
export function renderPlace(el, p, { go }) {
  const lang = getLang();
  const name = placeName(p, lang);
  const head = h("div", "cm-head");
  head.append(h("p", "eyebrow", t("p.eyebrow", { country: t(`country.${p.country}`) })), h("h1", "lm-title", name));

  const tiles = h("div", "lm-tiles");
  tiles.append(figTile(p.lu_workers == null ? null : num(p.lu_workers), t("p.workers"), igssDate(), [ovSrc(p.src?.lu_workers || "igss_emploi", igssDate())]));
  if (p.rent_m2 != null) {
    tiles.append(figTile(`${num(p.rent_m2, 1)} €/m²`, t("p.rent"),
      p.rent_range ? `${num(p.rent_range[0], 1)} – ${num(p.rent_range[1], 1)} €/m²` : null, [ovSrc(p.src?.rent_m2)]));
  } else if (p.sale_price_m2 != null) {
    tiles.append(figTile(`${num(p.sale_price_m2)} €/m²`, t("p.sale"), null, [ovSrc(p.src?.sale_price_m2)]));
  } else if (p.house_price_median != null) {
    tiles.append(figTile(eur(p.house_price_median), t("d.house_be"), p.appt_price_median != null ? `${t("d.appt_be")} : ${eur(p.appt_price_median)}` : null,
      [ovSrc(p.src?.house_price_median || "statbel_immo")]));
  } else tiles.append(figTile(null, t("p.housing"), p.country === "DE" ? t("note.rent_not_comparable") : t("note.rent_not_published"), []));
  if (p.sale_price_m2 != null && p.rent_m2 != null) tiles.append(figTile(`${num(p.sale_price_m2)} €/m²`, t("p.sale"), null, [ovSrc(p.src?.sale_price_m2)]));
  tiles.append(figTile(p.dist_lux_km == null ? null : `${num(p.dist_lux_km, 1)} km`, t("p.dist"), null, [ovSrc(p.src?.coords || "coords_manual")]));

  // commute table
  const { sec, body } = block(t("p.commutes"), [ovSrc(p.src?.commute || "chathome")]);
  const hubs = [...HUBS, "lux-city"];
  if (!p.commute) body.append(h("p", "muted", t("note.commute_not_published")));
  else {
    const wrap = h("div", "tbl-wrap");
    const tbl = h("table", "cm-table");
    const thr = h("tr");
    for (const k of ["p.hub", "p.car", "p.tc", "p.tc80", "p.km"]) thr.append(h("th", null, k === "p.hub" ? t(k) : `${t(k)} (${k === "p.km" ? "km" : "min"})`));
    const thead = h("thead");
    thead.append(thr);
    const tb = h("tbody");
    const cell = (v, u) => (v == null ? h("td", "np", t("np")) : h("td", null, num(v, u === "km" ? 1 : 0)));
    for (const hub of hubs) {
      const c = p.commute[hub];
      const tr = h("tr");
      tr.append(h("th", null, t(`hub.${hub}`)));
      tr.append(cell(c?.driving, "min"), cell(c?.transit, "min"), cell(c?.transit_p80, "min"), cell(c?.driving_km, "km"));
      tb.append(tr);
    }
    tbl.append(thead, tb);
    wrap.append(tbl);
    body.append(wrap);
  }

  // limits: notes of the place (rent and buy) + general limits about the cross-border data
  const notes = new Set();
  for (const tenure of ["rent", "buy"]) {
    const q = computePlaces({ ...data().ouvivre, places: [p] }, { hub: "kirchberg", size_m2: 70, tenure })[0];
    for (const n of q.notes) if (!["left_rent_only", "no_car_route"].includes(n)) notes.add(n);
  }
  const lim = block(t("p.limits"), []);
  const ul = h("ul", "ov-notes");
  for (const n of notes) ul.append(h("li", null, t(`note.${n}`)));
  lim.body.append(ul);

  const acts = h("div", "lm-row cm-acts");
  acts.append(btn("btn primary", t("p.compare"), () => go(`#/compare/${p.id}/0304`)), btn("btn", t("c.from"), () => go(`#/from/${p.id}`)));
  el.replaceChildren(head, tiles, sec, lim.sec, acts);
}

// ---------------------------------------------------------------- everyday problems
function crossBorderSeries() {
  const s = data().ouvivre.workers_total?.series || {};
  const years = (s.FR || []).map((d) => d[0]);
  return years.map((y, i) => [y, ["FR", "BE", "DE"].reduce((a, k) => a + (s[k]?.[i]?.[1] ?? 0), 0)]);
}

function problemCard(id, title, value, text, sources) {
  const card = h("article", "card pr-card");
  card.dataset.pr = id;
  const head = h("div", "cm-bhead");
  head.append(h("h3", "cm-btitle", title));
  card.append(head);
  card.append(value === null ? h("div", "kpi-value np", t("np")) : h("div", "kpi-value", value));
  if (text) card.append(h("p", "pr-text", text));
  if (sources?.length) {
    const [b, line] = srcToggle(sources, title);
    head.append(b);
    card.append(line);
  }
  const body = h("div", "pr-body");
  card.append(body);
  return { card, body };
}

export function problems({ compact = false } = {}) {
  const lang = getLang();
  const st = data(), ov = st.ouvivre, ref = ov.reference, rel = ov.reliability || {};
  const draws = [];
  const grid = h("div", `pr-grid${compact ? " is-compact" : ""}`);

  // 1 housing
  const rent = st.national?.rent_appt;
  const share = rent && ref.net_monthly_lu ? rent.v / ref.net_monthly_lu : null;
  grid.append(problemCard("housing", t("pr.housing"), share === null ? null : t("pr.housing.v", { p: pct(share) }),
    compact || !rent ? null : t("pr.housing.s", { r: eur(rent.v), y: rent.y, n: eur(ref.net_monthly_lu) }),
    [metaSrc("habitat_rents", rent?.y), refSrc("eurostat_earn_nt_net", ref.net_year_lu)]).card);

  // 2 cross-border workers
  const cb = ov.workers_total?.latest?.cross_border ?? null;
  const ser = crossBorderSeries();
  const g = ser.length > 1 && ser[0][1] ? ser[ser.length - 1][1] / ser[0][1] - 1 : null;
  const w = problemCard("workers", t("pr.workers"), cb === null ? null : num(cb),
    t("pr.workers.s", { d: igssDate(), g: g === null ? "–" : signed(pct(g), g) }), [ovSrc("igss_emploi", igssDate())]);
  if (!compact && ser.length > 1) {
    w.body.append(h("p", "pr-sub", t("pr.workers.chart")));
    const box = h("div");
    w.body.append(box);
    draws.push(() => lineChart(box, ser, { fmtV: (v) => num(v), fmtTick: (v) => `${num(v / 1000)}k`, label: t("pr.workers.chart"), zero: true }));
  }
  grid.append(w.card);

  // 3 trains
  const cfl = rel.cfl_punctuality, tgt = rel.cfl_punctuality_target;
  const relSrc = (k) => (rel[k] ? { name: `${rel[k].label[lang]} — ${host(rel[k].source)}`, url: rel[k].source, year: rel[k].period } : null);
  const tr = problemCard("trains", t("pr.trains"), cfl ? pctUnit(cfl.v, 1, lang) : null,
    cfl && tgt ? t("pr.trains.s", { y: cfl.period, t: pctUnit(tgt.v, 0, lang) }) : null,
    ["cfl_punctuality", "cfl_punctuality_target", "cfl_lux_trier_punctuality", "ter_grand_est_regularity", "ter_grand_est_cancelled"].map(relSrc).filter(Boolean));
  if (!compact) {
    const rows = [];
    for (const [k, emph] of [["cfl_punctuality", true], ["cfl_lux_trier_punctuality", false], ["ter_grand_est_regularity", false]]) {
      if (rel[k]) rows.push({ label: rel[k].label[lang], v: rel[k].v, display: pctUnit(rel[k].v, 1, lang), emph, color: emph ? undefined : "var(--mark-2)" });
    }
    if (tgt) rows.push({ label: tgt.label[lang], v: tgt.v, display: pctUnit(tgt.v, 0, lang), color: "var(--mark)" });
    hbars(tr.body, rows, { max: 100 });
    if (rel.ter_grand_est_cancelled) tr.body.append(h("p", "pr-sub", `${rel.ter_grand_est_cancelled.label[lang]} : ${pctUnit(rel.ter_grand_est_cancelled.v, 1, lang)}`));
  }
  grid.append(tr.card);

  // 4 childcare: not published per commune (no number in our data)
  const cr = problemCard("creches", t("pr.creches"), t("pr.creches.v"), t("pr.creches.s"), []);
  cr.card.querySelector(".kpi-value").classList.add("pr-word");
  cr.body.append(link(t("pr.creches.link"), "#/sources", "pr-link"));
  grid.append(cr.card);

  // 5 wages
  const wg = problemCard("wages", t("pr.wages"), ref.min_wage_lu ? `${eur(ref.min_wage_lu)} / ${eur(ref.min_wage_fr)}` : null,
    t("pr.wages.s", { p: ref.min_wage_period_lu }), [refSrc("eurostat_earn_nt_net", ref.net_year_lu), refSrc("eurostat_earn_mw_cur", ref.min_wage_period_lu)]);
  if (!compact) {
    wg.body.append(h("p", "pr-sub", t("pr.wages.chart")));
    const keys = [{ key: "net", label: t("pr.net", { y: ref.net_year_lu }), color: CAT[0] }, { key: "min", label: t("pr.min", { p: ref.min_wage_period_lu }), color: CAT[1] }];
    groupBars(wg.body, ["lu", "fr", "be", "de"].map((c) => ({
      label: t(`country.${c.toUpperCase()}`),
      values: {
        net: ref[`net_monthly_${c}`] == null ? null : { v: ref[`net_monthly_${c}`], display: eur(ref[`net_monthly_${c}`]) },
        min: ref[`min_wage_${c}`] == null ? null : { v: ref[`min_wage_${c}`], display: eur(ref[`min_wage_${c}`]) },
      },
    })), keys);
  }
  grid.append(wg.card);

  if (compact) {
    for (const c of grid.children) {
      c.classList.add("is-link");
      c.tabIndex = 0;
      c.setAttribute("role", "link");
      const goTo = (e) => { if (e.target.closest("button, a")) return; location.hash = "#/pays"; };
      c.addEventListener("click", goTo);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter") goTo(e); });
    }
  }
  return { el: grid, draw: () => draws.forEach((f) => f()) };
}

// Home teaser below the results.
export function problemsTeaser() {
  const box = h("section", "pr-teaser");
  box.append(h("p", "section-title", t("pr.title")));
  const p = problems({ compact: true });
  box.append(p.el, link(t("pr.more"), "#/pays", "btn small pr-morebtn"));
  return box;
}

export function renderCountry(el, { onAsk }) {
  const lang = getLang();
  const st = data(), n = st.national || {};
  const hero = h("div", "lm-hero");
  hero.append(h("p", "eyebrow", t("eyebrow")), h("h1", null, t("pr.big")), h("p", "lead", t("pr.lead")));
  const tiles = h("div", "lm-tiles pr-big");
  if (n.population) tiles.append(figTile(num(n.population.v), t("pr.big.pop", { y: n.population.y }),
    n.population.growth_10y == null ? null : t("pr.big.growth", { g: signed(pctUnit(n.population.growth_10y, 1, lang), n.population.growth_10y) }), [metaSrc("statec_pop", n.population.y)]));
  if (n.fdgc_total) tiles.append(figTile(eurBig(n.fdgc_total.v), t("pr.big.fdgc", { y: n.fdgc_total.y }), null, [metaSrc("qp3720_fdgc", n.fdgc_total.y)]));
  if (n.debt) tiles.append(figTile(eurBig(n.debt.v), t("pr.big.debt", { y: n.debt.y }),
    n.debt_pc ? t("pr.big.debt_pc", { v: eur(n.debt_pc.v) }) : null, [metaSrc("qp3719_debt", n.debt.y)]));
  if (n.sale_price_m2) tiles.append(figTile(`${num(n.sale_price_m2.v)} €/m²`, t("pr.big.sale", { y: n.sale_price_m2.y }), null, [metaSrc("habitat_sales", n.sale_price_m2.y)]));
  if (n.rent_appt) tiles.append(figTile(eur(n.rent_appt.v), t("pr.big.rent", { y: n.rent_appt.y }), null, [metaSrc("habitat_rents", n.rent_appt.y)]));

  const prTitle = h("h2", "pr-h2", t("pr.title"));
  const pr = problems();

  const parts = [hero, tiles, prTitle, pr.el];
  let crimeDraw = null;
  const cr = n.crime;
  if (cr?.years?.length > 1) {
    const pts = cr.years.map((y, i) => [y, cr.total[i]]);
    const b = block(t("pr.crime"), [metaSrc("statec_crime", `${cr.years[0]}-${cr.years[cr.years.length - 1]}`)]);
    const last = pts[pts.length - 1], first = pts[0];
    const gr = last[1] / first[1] - 1;
    b.body.append(h("p", "pr-text", t("pr.crime.s", { v: num(last[1]), y: last[0], g: signed(pct(gr), gr), y0: first[0] })));
    const box = h("div");
    b.body.append(box);
    b.body.append(h("p", "chip warn cm-note", t("pr.crime.note")));
    b.body.append(link(t("pr.creches.link"), "#/sources", "pr-link"));
    crimeDraw = () => lineChart(box, pts, { fmtV: (v) => num(v), fmtTick: (v) => `${num(v / 1000)}k`, label: t("pr.crime"), zero: true });
    parts.push(b.sec);
  }
  parts.push(btn("btn primary lm-big", t("ask.title"), onAsk), h("p", "muted small", t("built")));
  el.replaceChildren(...parts);
  pr.draw();
  crimeDraw?.();
}

// ---------------------------------------------------------------- sources
function maxYearBySource() {
  const st = data();
  const out = new Map();
  for (const m of st.meta.indicators) {
    let y = null;
    for (const c of st.communes) { const v = c.values[m.id]; if (v && (y === null || v.y > y)) y = v.y; }
    if (y !== null) out.set(m.source_id, Math.max(out.get(m.source_id) ?? 0, y));
  }
  return out;
}

const OV_LEVEL = { igss_emploi: "crossborder", chathome: "crossborder", anil_loyers_2025: "crossborder", dvf_stats: "crossborder",
  statbel_immo: "crossborder", coords_manual: "point", lu_fuel: "national", habitat_rents: "commune", habitat_sales: "commune", habitat: "commune" };

export function sourceList() {
  const st = data(), ov = st.ouvivre, ref = ov.reference;
  const years = maxYearBySource();
  const seen = new Set();
  const list = [];
  const add = (s) => {
    if (!s.url || seen.has(s.url)) return;
    seen.add(s.url);
    list.push(s);
  };
  const crimeYears = st.national?.crime?.years;
  for (const [id, s] of Object.entries(st.meta.sources)) {
    let date = years.get(id) ?? null;
    if (id === "statec_crime" && crimeYears?.length) date = `${crimeYears[0]}-${crimeYears[crimeYears.length - 1]}`;
    add({ id, name: s.name, url: s.url, level: id === "statec_crime" ? "national" : "commune", date });
  }
  for (const [id, s] of Object.entries(ov.sources)) {
    const date = id === "igss_emploi" ? igssDate() : id === "lu_fuel" ? ov.assumptions?.fuel_price_period : null;
    add({ id, name: s.name, url: s.url, level: OV_LEVEL[id] || "crossborder", date });
  }
  for (const s of ref.sources || []) add({ id: s.id, name: s.name, url: s.url, level: "country", date: s.id === "eurostat_earn_mw_cur" ? ref.min_wage_period_lu : ref.net_year_lu });
  const byUrl = new Map();
  for (const [, r] of Object.entries(ov.reliability || {})) {
    const e = byUrl.get(r.source) || { name: host(r.source), url: r.source, level: "line", date: r.period, labels: [] };
    e.labels.push(r.label);
    byUrl.set(r.source, e);
  }
  for (const e of byUrl.values()) add(e);
  return list;
}

export function renderSources(el) {
  const lang = getLang();
  const head = h("div");
  head.append(h("p", "eyebrow", t("eyebrow")), h("h1", "lm-title", t("src.title")), h("p", "lead", t("src.lead")));
  const grid = h("div", "src-grid");
  for (const s of sourceList()) {
    const card = h("article", "card src-card");
    const name = h("h3", "cm-btitle");
    name.append(extLink(s.labels ? `${host(s.url)}` : s.name, s.url));
    card.append(name);
    if (s.labels) card.append(h("p", "src-pub", s.labels.map((l) => l[lang]).join(" · ")));
    else {
      const pub = s.name.split(/ - | – /)[0];
      if (pub && pub !== s.name) card.append(h("p", "src-pub", `${t("src.publisher")} : ${pub}`));
    }
    const chips = h("div", "lm-row");
    chips.append(h("span", "chip emph", `${t("src.level")} : ${t(`lvl.${s.level}`)}`));
    if (s.date) chips.append(h("span", "chip", `${t("src.date")} : ${s.date}`));
    card.append(chips);
    grid.append(card);
  }
  const wish = h("section", "wish");
  wish.id = "wishlist";
  wish.append(h("h2", "pr-h2", t("wish.title")), h("p", "lead", t("wish.lead")));
  const wg = h("div", "src-grid");
  for (const it of data().wishlist?.items || []) {
    const card = h("article", "card wish-card");
    card.append(h("h3", "cm-btitle", it.title[lang]), h("p", "src-pub", t("wish.holder", { h: it.holder[lang] })), h("p", "pr-text", it.text[lang]));
    wg.append(card);
  }
  wish.append(wg);
  el.replaceChildren(head, grid, wish);
}
