// Comparator #/compare/<id1>/<id2>[/<id3>] (plan B3). Ids: LU LAU code ("0304") or ouvivre place id ("fr:insee:57672").
// Side-by-side tables grouped by theme; best value highlighted using the indicator's `sens`.
import { TABS, rankText, srcOf, valueText } from "./commune.js";
import { data, displayName, label, norm } from "./data.js";
import { h } from "./dom.js";
import { placeName } from "./grmap.js";
import { getLang, t } from "./i18n.js";
import { HUBS, computePlaces } from "./ouvivre.js";
import { ouvivreState } from "./ouvivre-ui.js";
import { btn, eur, num, srcToggle } from "./ui.js";

export const MAX = 3;
let hub = null;

export function resolvePlace(id) {
  const st = data();
  const ov = st.ouvivre.places;
  if (/^\d{4}$/.test(id) && st.byLau.has(id)) {
    const c = st.byLau.get(id);
    return { id, lau: id, c, p: ov.find((x) => x.id === `lu:${id}`) || null, country: "LU" };
  }
  const p = ov.find((x) => x.id === id);
  if (!p) return null;
  if (p.lau && st.byLau.has(p.lau)) return { id: p.lau, lau: p.lau, c: st.byLau.get(p.lau), p, country: "LU" };
  return { id: p.id, lau: null, c: null, p, country: p.country };
}

const nameOf = (r, lang) => (r.c ? displayName(r.c, lang) : placeName(r.p, lang));

// Search over LU communes and cross-border places ("Thionville (FR)").
export function pickerOptions(lang) {
  const st = data();
  const opts = st.communes.map((c) => ({ text: displayName(c, lang), id: c.lau }));
  for (const p of st.ouvivre.places) if (!p.lau) opts.push({ text: `${p.name} (${p.country})`, id: p.id });
  return opts;
}

export function findPlaceId(q, lang) {
  const n = norm(q);
  if (!n) return null;
  const opts = pickerOptions(lang);
  const hit = opts.find((o) => norm(o.text) === n) || opts.find((o) => norm(o.text.replace(/ \([A-Z]{2}\)$/, "")) === n)
    || opts.find((o) => norm(o.text).startsWith(n));
  return hit ? hit.id : null;
}

// Best index among numeric values: sens 1 = highest, -1 = lowest, 0 = none; needs 2+ values and no tie for first.
export function bestIndex(values, sens) {
  if (!sens) return -1;
  const nums = values.map((v, i) => [v, i]).filter(([v]) => typeof v === "number" && Number.isFinite(v));
  if (nums.length < 2) return -1;
  nums.sort((a, b) => (sens > 0 ? b[0] - a[0] : a[0] - b[0]));
  return nums[0][0] === nums[1][0] ? -1 : nums[0][1];
}

function table(cols, rows, lang) {
  const wrap = h("div", "tbl-wrap");
  const tbl = h("table", "cmp-table");
  tbl.style.setProperty("--n", String(cols.length));
  const cg = h("colgroup");
  cg.append(h("col", "cmp-c0"));
  for (let i = 0; i < cols.length; i += 1) cg.append(h("col", "cmp-cv"));
  const hr = h("tr");
  hr.append(h("th", "cmp-rl cmp-corner", ""));
  for (const r of cols) hr.append(h("th", "cmp-colname", nameOf(r, lang)));
  const thead = h("thead");
  thead.append(hr);
  tbl.append(cg, thead);
  const tb = h("tbody");
  for (const r of rows) {
    const tr = h("tr");
    const th = h("th", "cmp-rl");
    th.scope = "row";
    th.append(h("span", null, r.label));
    if (r.sources?.length) {
      const [b, line] = srcToggle(r.sources, r.label);
      th.append(b, line);
    }
    tr.append(th);
    const best = bestIndex(r.values.map((v) => v.raw), r.sens);
    r.values.forEach((v, i) => {
      const td = h("td", v.cls || null);
      td.append(h("span", "cmp-v", v.text));
      if (v.sub) td.append(h("span", "cmp-sub", v.sub));
      if (i === best) {
        td.classList.add("is-best");
        td.append(h("span", "cmp-best", t("cmp.best")));
      }
      tr.append(td);
    });
    tb.append(tr);
  }
  tbl.append(tb);
  wrap.append(tbl);
  return wrap;
}

function dailyRows(places, lang) {
  const st = data(), ov = st.ouvivre;
  const size = ouvivreState().size || 70;
  const calc = (tenure) => {
    const all = computePlaces({ ...ov, places: places.map((r) => r.p).filter(Boolean) }, { hub, size_m2: size, tenure });
    return places.map((r) => (r.p ? all.find((q) => q.id === r.p.id) : null));
  };
  const rent = calc("rent"), buy = calc("buy");
  const src = (key) => {
    const ids = new Set(places.map((r) => r.p?.src?.[key]).filter(Boolean));
    return [...ids].map((id) => ov.sources[id]).filter(Boolean).map((s) => ({ name: s.name, url: s.url }));
  };
  const cell = (v, text, sub) => (v === null || v === undefined ? { raw: null, text: t("np"), cls: "np" } : { raw: v, text, sub });
  const hubName = t(`hub.${hub}`);
  const salary = ov.reference.sources?.[0];
  const fuel = ov.sources[ov.assumptions?.fuel_price_source];
  return [
    { label: t("d.workers"), sens: 0, sources: [...src("lu_workers"), ...src("residents_employed")],
      values: rent.map((q) => cell(q?.workers, q?.workers == null ? "" : num(q.workers))) },
    { label: t("d.dist"), sens: 0, sources: src("coords"),
      values: rent.map((q) => cell(q?.dist_lux_km, q?.dist_lux_km == null ? "" : `${num(q.dist_lux_km, 1)} km`)) },
    { label: t("d.rent_m2"), sens: -1, sources: src("rent_m2"),
      values: rent.map((q) => cell(q?.rent_m2, q?.rent_m2 == null ? "" : `${num(q.rent_m2, 1)} €/m²`)) },
    { label: t("cmp.rent_size", { s: size }), sens: -1, sources: src("rent_m2"),
      values: rent.map((q) => cell(q?.rent_month, q?.rent_month == null ? "" : eur(q.rent_month))) },
    { label: t("d.sale_m2"), sens: -1, sources: src("sale_price_m2"),
      values: buy.map((q) => cell(q?.sale_price_m2, q?.sale_price_m2 == null ? "" : `${num(q.sale_price_m2)} €/m²`)) },
    { label: t("cmp.car", { hub: hubName }), sens: -1, sources: src("commute"),
      values: rent.map((q) => cell(q?.car_min, `${q?.car_min} min`, q?.car_km == null ? null : `${num(q.car_km, 1)} km`)) },
    { label: t("cmp.tc", { hub: hubName }), sens: -1, sources: src("commute"),
      values: rent.map((q) => cell(q?.transit_min, `${q?.transit_min} min`)) },
    { label: t("cmp.tc80"), sens: -1, sources: src("commute"),
      values: rent.map((q) => cell(q?.transit_p80, `${q?.transit_p80} min`)) },
    { label: t("cmp.left_size", { s: size }), sens: 1,
      sources: [...src("rent_m2"), ...(salary ? [{ name: salary.name, url: salary.url, year: ov.reference.net_year_lu }] : []),
        ...(fuel ? [{ name: fuel.name, url: fuel.url, year: ov.assumptions.fuel_price_period }] : [])],
      values: rent.map((q) => cell(q?.left_month, q?.left_month == null ? "" : eur(q.left_month), t("s.left"))) },
  ];
}

function themeRows(places, theme, lang) {
  const inds = data().meta.indicators.filter((m) => m.theme === theme && m.id !== "school_shared");
  return inds.map((m) => {
    const years = places.map((r) => r.c?.values[m.id]?.y).filter(Boolean);
    return {
      label: label(m.id, lang),
      sens: m.sens,
      sources: [srcOf(m.id, years.length ? Math.max(...years) : null)].filter(Boolean),
      values: places.map((r) => {
        if (!r.c) return { raw: null, text: t("cmp.lu_only"), cls: "na" };
        const v = r.c.values[m.id];
        if (!v) return { raw: null, text: t("np"), cls: "np" };
        return { raw: v.v, text: valueText(m.id, v.v, lang), sub: rankText(r.c, m.id) };
      }),
    };
  });
}

export function renderCompare(el, ids, { go }) {
  const lang = getLang();
  if (!hub) hub = ouvivreState().hub || "kirchberg";
  const places = [];
  for (const id of ids) {
    const r = resolvePlace(decodeURIComponent(id));
    if (r && !places.some((x) => x.id === r.id)) places.push(r);
  }
  const hashOf = (list) => `#/compare/${list.map((r) => r.id).join("/")}`;

  const head = h("div");
  head.append(h("p", "eyebrow", t("eyebrow")), h("h1", "lm-title", t("cmp.title")), h("p", "lead", t("cmp.lead")));

  // place header cards
  const cards = h("div", "cmp-heads");
  for (const r of places) {
    const card = h("div", "card cmp-head");
    const nm = h("a", "cmp-name", nameOf(r, lang));
    nm.href = r.c ? `#/c/${r.lau}` : `#/p/${r.p.id}`;
    const top = h("div", "cmp-headtop");
    top.append(nm, h("span", "chip", r.country));
    card.append(top);
    if (places.length > 1) {
      const x = btn("cmp-x", "×", () => go(hashOf(places.filter((q) => q !== r))));
      x.setAttribute("aria-label", t("cmp.remove", { name: nameOf(r, lang) }));
      top.append(x);
    }
    if (r.c) card.append(h("span", "muted small", t("canton", { c: r.c.canton })));
    cards.append(card);
  }

  // picker
  const form = h("form", "cmp-pick");
  form.setAttribute("role", "search");
  const lab = h("label", "ov-label", t("cmp.add"));
  lab.htmlFor = "cmp-input";
  const input = h("input", "cmp-input");
  input.id = "cmp-input";
  input.autocomplete = "off";
  input.placeholder = t("cmp.add.ph");
  input.setAttribute("list", "cmp-list");
  const dl = h("datalist");
  dl.id = "cmp-list";
  for (const o of pickerOptions(lang)) { const op = document.createElement("option"); op.value = o.text; dl.append(op); }
  const addBtn = h("button", "btn", t("cmp.add.btn"));
  addBtn.type = "submit";
  const msg = h("p", "muted small cmp-msg");
  const row = h("div", "cmp-pickrow");
  row.append(input, addBtn);
  form.append(lab, row, dl, msg);
  const full = places.length >= MAX;
  input.disabled = full;
  addBtn.disabled = full;
  if (full) msg.textContent = t("cmp.max");
  const add = (id) => {
    const r = resolvePlace(id);
    if (!r) { msg.textContent = t("cmp.notfound"); return; }
    if (places.some((x) => x.id === r.id)) return;
    go(hashOf([...places, r]));
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); const id = findPlaceId(input.value, lang); if (id) add(id); else msg.textContent = t("cmp.notfound"); });
  input.addEventListener("change", () => { const n = norm(input.value); const o = pickerOptions(lang).find((x) => norm(x.text) === n); if (o) add(o.id); });

  const parts = [head, cards, form];
  if (places.length < 2) {
    parts.push(h("p", "lead", t("cmp.pick")));
    const sug = h("div", "lm-row");
    const cand = [];
    const first = places[0];
    if (first?.c) cand.push(...first.c.twins);
    for (const id of ["0304", "fr:insee:57672", "be:81001", "de:ags:07211000"]) if (!cand.includes(id)) cand.push(id);
    for (const id of cand.filter((x) => x !== first?.id).slice(0, 6)) {
      const r = resolvePlace(id);
      if (r) sug.append(btn("btn small", nameOf(r, lang), () => add(id)));
    }
    parts.push(h("p", "section-title", t("cmp.suggest")), sug);
  }

  if (places.length) {
    // hub choice for the commute rows
    const seg = h("div", "seg ov-seg cmp-hubs");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("cmp.hub"));
    for (const k of HUBS) {
      const b = btn("", t(`hub.${k}`), () => { hub = k; renderCompare(el, ids, { go }); });
      b.setAttribute("aria-pressed", String(k === hub));
      seg.append(b);
    }
    const hubRow = h("div", "cmp-hubrow");
    hubRow.append(h("span", "ov-label", t("cmp.hub")), seg);

    const group = (title, rows, open) => {
      const det = h("details", "cmp-group");
      det.open = open;
      det.append(h("summary", null, title));
      det.append(table(places, rows, lang));
      return det;
    };
    parts.push(hubRow, group(t("cmp.g.daily"), dailyRows(places, lang), true));
    if (places.some((r) => r.c)) {
      TABS.forEach((k, i) => parts.push(group(t(`tab.${k}`), themeRows(places, k, lang), i === 0)));
    }
  }
  el.replaceChildren(...parts);
}

