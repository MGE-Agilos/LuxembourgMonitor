// "Vous travaillez au Luxembourg. Où vivre ?" — choices, ranked cards and Greater Region map state.
import { KIOSK } from "./config.js";
import { h } from "./dom.js";
import { placeName } from "./grmap.js";
import { getLang, t } from "./i18n.js";
import { COUNTRIES, HUBS, SIZES, computePlaces, rank, referenceHourlyWage, sortValue } from "./ouvivre.js";

const PAGE = 10;
const TOP = 10;
const LIMITS_FR = {
  "Advertised rents are not rents paid; French rents are charges included (52 m2 reference apartment)":
    "Loyers annoncés, pas loyers payés ; les loyers français sont charges comprises (appartement de référence de 52 m²)",
  "Third-party commute model, morning of a weekday: underestimates border queues":
    "Modèle de trajet tiers, matin de semaine : il sous-estime les files aux frontières",
  "No sale prices in Moselle (DVF does not cover Alsace-Moselle)":
    "Pas de prix de vente en Moselle (DVF ne couvre pas l'Alsace-Moselle)",
  "No commute times and no rents for Belgium; German rents not comparable":
    "Ni temps de trajet ni loyers pour la Belgique ; loyers allemands non comparables",
  "Belgian prices are medians per sale (not per m2)": "Prix belges : médianes par vente (pas au m²)",
  [`Commute cost = fuel only (monthly average pump price, 6.5 L/100 km, 220 days); cross-border transit fares, parking and car wear are not counted`]:
    "Coût du trajet = carburant seulement (prix moyen mensuel à la pompe, 6,5 L/100 km, 220 jours) ; titres de transport "
    + "transfrontaliers, parking et usure de la voiture non comptés",
  [`Rent per m2 is multiplied by the chosen size without size correction: Luxembourg advertised flats average about 42 m2, so rents for 70 and 90 m2 may be overstated (per-m2 rent is usually lower for larger flats)`]:
    "Le loyer au m² est multiplié par la surface choisie sans correction : les appartements annoncés au Luxembourg font "
    + "en moyenne environ 42 m², les loyers de 70 et 90 m² peuvent donc être surestimés (le loyer au m² baisse en général "
    + "avec la surface)",
};

const fresh = () => ({ hub: null, size: 70, tenure: "rent", sort: "left", timeValue: 0, countries: new Set(COUNTRIES), selected: null, shown: PAGE });
let S = fresh();
export function resetOuvivre() { S = fresh(); }
// "Où vivre depuis ici ?": open the home with this place selected (its country kept in the filter).
export function preselectOuvivre(id) {
  S.selected = id;
  const c = id.slice(0, 2).toUpperCase();
  if (COUNTRIES.includes(c)) S.countries = new Set([...S.countries, c]);
}
export const ouvivreState = () => S;
// Context of the "Ask the data" bubble: the visitor's situation on this page (no hub = nothing chosen yet).
export function ouvivreContext() {
  if (!S.hub) return {};
  const ctx = { hub: S.hub, size_m2: S.size, tenure: S.tenure, time_value: S.tenure === "rent" ? S.timeValue : 0 };
  if (S.selected) ctx.place = S.selected;
  return ctx;
}

const loc = (lang) => (lang === "fr" ? "fr-LU" : "en-GB");
const eur = (v, lang) => new Intl.NumberFormat(loc(lang), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const num = (v, lang, d = 0) => new Intl.NumberFormat(loc(lang), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
// Prices of a million or more are written compactly ("1.03 M€") so three figures fit side by side on a phone.
const eurBig = (v, lang) => (v >= 1e6
  ? new Intl.NumberFormat(loc(lang), { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 2 }).format(v)
  : eur(v, lang));
const pct = (v, lang) => new Intl.NumberFormat(loc(lang), { style: "percent", maximumFractionDigits: 0 }).format(v);

function btn(cls, text, onClick) {
  const b = h("button", cls, text);
  b.type = "button";
  b.onclick = onClick;
  return b;
}
function pressed(b, on) { b.setAttribute("aria-pressed", String(on)); return b; }

export function effectiveSort() { return S.tenure === "buy" && S.sort === "left" ? "housing" : S.sort; }

export function renderOuvivre({ lead, panel, legend, data, grmap, onCommune, onChange, teaser }) {
  const lang = getLang();
  const ov = data.ouvivre;
  const srcName = (id) => ov.sources[id]?.name || id;
  const srcUrl = (id) => ov.sources[id]?.url || null;
  const salarySrc = ov.reference.sources?.[0];

  function changed(patch) {
    Object.assign(S, patch);
    onChange?.();
    draw();
  }

  // ---- "what is 1 hour of your time worth?" slider: built once, never replaced, so a drag survives redraws
  const refWage = referenceHourlyWage(ov);
  const SLIDER_MAX = 40;
  const timeRow = h("div", "ov-time");
  const timeHead = h("p", "ov-label ov-time-head");
  const timeVal = h("span", "ov-time-val");
  const timeTipBtn = btn("ov-i ov-time-tip", "?", () => { timeTip.hidden = !timeTip.hidden; timeTipBtn.setAttribute("aria-expanded", String(!timeTip.hidden)); });
  const timeTip = h("p", "ov-src ov-time-tipbox", t("ov.time.tip"));
  const slider = h("input", "ov-slider");
  const timeRef = h("p", "ov-time-ref");
  let timer = null;
  function buildSlider() {
    timeHead.replaceChildren(h("span", null, t("ov.time.q")), timeVal, timeTipBtn);
    timeTipBtn.setAttribute("aria-label", t("ov.time.q"));
    timeTipBtn.setAttribute("aria-expanded", "false");
    timeTip.hidden = true;
    timeTipBtn.title = t("ov.time.tip");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(SLIDER_MAX);
    slider.step = "1";
    slider.value = String(S.timeValue);
    slider.setAttribute("aria-label", t("ov.time.q"));
    slider.oninput = () => {
      S.timeValue = Number(slider.value);
      showTimeValue();
      clearTimeout(timer);
      timer = setTimeout(() => { onChange?.(); draw(); }, 100);
    };
    const track = h("div", "ov-slider-wrap");
    track.append(slider);
    if (refWage !== null && refWage <= SLIDER_MAX) {
      const tick = h("i", "ov-tick");
      tick.style.setProperty("--p", String(refWage / SLIDER_MAX));
      tick.setAttribute("aria-hidden", "true");
      track.append(tick);
      timeRef.textContent = t("ov.time.ref", { w: num(refWage, lang, 1) });
      timeRef.style.setProperty("--p", String(refWage / SLIDER_MAX));
    }
    timeRow.replaceChildren(timeHead, timeTip, track, timeRef);
    showTimeValue();
  }
  function showTimeValue() { timeVal.textContent = t("ov.time.val", { v: S.timeValue }); }
  buildSlider();

  // ---- lead: question and the two choices
  function drawLead() {
    const hubs = h("div", "ov-opts");
    hubs.setAttribute("role", "group");
    hubs.setAttribute("aria-label", t("ov.hub"));
    for (const id of HUBS) hubs.append(pressed(btn("ov-opt", t(`hub.${id}`), () => { changed({ hub: id, shown: PAGE }); if (S.selected) select(S.selected, true); }), S.hub === id));
    const sizes = h("div", "ov-opts");
    sizes.setAttribute("role", "group");
    sizes.setAttribute("aria-label", t("ov.situation"));
    for (const s of SIZES) sizes.append(pressed(btn("ov-opt", t(`size.${s}`), () => changed({ size: s })), S.size === s));
    const ten = h("div", "seg ov-seg");
    ten.setAttribute("role", "group");
    ten.setAttribute("aria-label", `${t("ten.rent")} / ${t("ten.buy")}`);
    for (const k of ["rent", "buy"]) ten.append(pressed(btn("", t(`ten.${k}`), () => changed({ tenure: k })), S.tenure === k));
    sizes.append(ten);
    slider.disabled = S.tenure === "buy";
    timeRow.classList.toggle("is-off", slider.disabled);
    // keep the slider node in place (do not detach it mid-drag): swap only the other children
    for (const c of [...lead.children]) if (c !== timeRow) c.remove();
    lead.prepend(
      h("p", "eyebrow", t("eyebrow")),
      h("h1", "ov-q", t("ov.q")),
      h("p", "ov-label", t("ov.hub")), hubs,
      h("p", "ov-label", t("ov.situation")), sizes,
    );
    if (timeRow.parentNode !== lead) lead.append(timeRow);
  }

  // ---- one number of a card, with its source on tap
  function figure(card, key, value, subs, sources) {
    const box = h("div", "ov-num");
    box.append(h("span", "ov-k", key));
    box.append(value === null ? h("span", "ov-v np", t("np")) : h("span", "ov-v", value));
    for (const s of subs.filter(Boolean)) box.append(h("span", "ov-s", s));
    const srcs = sources.filter((s) => s && s.name);
    if (srcs.length) {
      const i = btn("ov-i", "i", () => {
        const out = card.querySelector(".ov-src");
        const same = out.dataset.k === key && !out.hidden;
        out.replaceChildren();
        out.hidden = same;
        out.dataset.k = key;
        if (same) return;
        out.append(document.createTextNode(`${key} — `));
        srcs.forEach((s, n) => {
          if (n) out.append(document.createTextNode(" · "));
          if (s.url && !KIOSK) {
            const a = h("a", null, s.name);
            a.href = s.url;
            a.target = "_blank";
            a.rel = "noopener";
            out.append(a);
          } else out.append(document.createTextNode(s.name));
        });
      });
      i.setAttribute("aria-label", `${t("src.btn")} : ${key}`);
      box.append(i);
    }
    return box;
  }

  function detailRow(dl, k, v) {
    if (v === null || v === undefined) return;
    dl.append(h("dt", null, k), h("dd", null, v));
  }

  function card(p, idx) {
    const el = h("article", "card ov-card");
    el.dataset.id = p.id;
    if (S.selected === p.id) el.dataset.sel = "";
    const name = placeName(p, lang);
    const head = btn("ov-head", null, () => select(S.selected === p.id ? null : p.id, false));
    head.setAttribute("aria-pressed", String(S.selected === p.id));
    head.append(h("span", "ov-rank", idx === null ? "–" : String(idx + 1)), h("span", "ov-name", name), h("span", "chip", p.country));
    el.append(head);

    const sal = salarySrc ? { name: salarySrc.name, url: salarySrc.url } : null;
    const housingSrcId = S.tenure === "rent" ? p.src.rent_m2 : p.src.sale_price_m2;
    const housingSrc = housingSrcId ? { name: srcName(housingSrcId), url: srcUrl(housingSrcId) } : null;
    const commuteSrc = p.src.commute ? { name: srcName(p.src.commute), url: srcUrl(p.src.commute) } : null;
    const A = ov.assumptions;
    const fuelSrc = p.fuel_cost_month === null ? null : {
      name: `${t("d.fuel")} : ${eur(p.fuel_cost_month, lang)} (${t("d.fuel_basis", {
        l: num(A.consumption_l_per_100km, lang, 1), d: A.working_days_per_year, p: num(A.fuel_price_eur_per_l, lang, 3), m: A.fuel_price_period })}) — ${srcName(A.fuel_price_source)}`,
      url: srcUrl(A.fuel_price_source) };
    const nums = h("div", "ov-nums");
    if (S.tenure === "rent") {
      nums.append(figure(el, t("k.rent"), p.rent_month === null ? null : eur(p.rent_month, lang),
        [p.share_of_lu_net === null ? null : t("s.share", { p: pct(p.share_of_lu_net, lang) })], [housingSrc, p.share_of_lu_net === null ? null : sal]));
    } else {
      nums.append(figure(el, t("k.price"), p.price_total === null ? null : eurBig(p.price_total, lang),
        [p.years_of_lu_net === null ? null : t("s.years", { y: num(p.years_of_lu_net, lang, 1) })], [housingSrc, p.years_of_lu_net === null ? null : sal]));
    }
    nums.append(figure(el, t("k.time"), p.car_min === null ? null : `${p.car_min} min`, p.car_min === null
      ? [p.dist_lux_km === null ? null : t("s.dist", { km: num(p.dist_lux_km, lang, 0) })]
      : [p.transit_min === null ? t("s.transit_none") : t("s.transit", { m: p.transit_min, p: p.transit_p80 ?? "–" }),
        t("s.hours", { h: num(p.hours_month_car, lang, 0) })], [commuteSrc]));
    if (S.tenure === "rent") {
      nums.append(figure(el, t("k.left"), p.left_month === null ? null : eur(p.left_month, lang),
        [p.left_month === null ? null : t("s.left"), p.left_month === null || p.hours_month_car === null ? null : t("s.hours", { h: num(p.hours_month_car, lang, 0) }),
          p.time_cost_month === null ? null : t("s.time", { c: eur(p.time_cost_month, lang), h: num(p.time_hours_month, lang, 0), v: S.timeValue }),
          p.time_cost_month === null || p.balance_month === null ? null : t("s.balance", { b: eur(p.balance_month, lang) })],
        [p.left_month === null ? null : housingSrc, p.left_month === null ? null : sal, p.left_month === null ? null : fuelSrc]));
    } else {
      const f = figure(el, t("k.left"), "—", [t("s.left_buy")], []);
      nums.append(f);
    }
    el.append(nums);
    const src = h("p", "ov-src");
    src.hidden = true;
    el.append(src);

    const more = h("details", "ov-more");
    more.append(h("summary", null, t("details")));
    const dl = h("dl", "ov-dl");
    detailRow(dl, t("d.workers"), p.workers === null ? null : num(p.workers, lang));
    detailRow(dl, t("d.dist"), p.dist_lux_km === null ? null : `${num(p.dist_lux_km, lang, 1)} km`);
    detailRow(dl, t("d.road", { hub: t(`hub.${S.hub}`) }), p.car_km === null ? null : `${num(p.car_km, lang, 1)} km`);
    detailRow(dl, t("d.fuel"), p.fuel_cost_month === null ? null : `${eur(p.fuel_cost_month, lang)} (${t("d.fuel_basis", {
      l: num(A.consumption_l_per_100km, lang, 1), d: A.working_days_per_year, p: num(A.fuel_price_eur_per_l, lang, 3), m: A.fuel_price_period })})`);
    detailRow(dl, t("d.hours_car"), p.hours_month_car === null ? null : `${num(p.hours_month_car, lang, 0)} h`);
    detailRow(dl, t("d.hours_tc"), p.hours_month_transit === null ? null
      : `${num(p.hours_month_transit, lang, 0)} h (${p.hours_month_transit_p80 === null ? "–" : num(p.hours_month_transit_p80, lang, 0)} h)`);
    detailRow(dl, t("d.rent_m2"), p.rent_m2 === null ? null : `${num(p.rent_m2, lang, 1)} €/m²`);
    detailRow(dl, t("d.rent_range"), p.rent_range ? `${num(p.rent_range[0], lang, 1)} – ${num(p.rent_range[1], lang, 1)} €/m²` : null);
    detailRow(dl, t("d.sale_m2"), p.sale_price_m2 === null ? null : `${num(p.sale_price_m2, lang)} €/m²`);
    detailRow(dl, t("d.house_lu"), p.house_price === null ? null : eur(p.house_price, lang));
    detailRow(dl, t("d.house_be"), p.house_price_median === null ? null : eur(p.house_price_median, lang));
    detailRow(dl, t("d.appt_be"), p.appt_price_median === null ? null : eur(p.appt_price_median, lang));
    more.append(dl);
    if (p.notes.length) {
      const ul = h("ul", "ov-notes");
      for (const n of p.notes) ul.append(h("li", null, t(`note.${n}`)));
      more.append(ul);
    }
    if (p.lau && data.byLau.has(p.lau)) more.append(btn("btn small", t("d.page"), () => onCommune(p.lau)));
    el.append(more);
    return el;
  }

  // ---- results
  let current = [];
  function computeRanked() {
    const by = effectiveSort();
    const places = computePlaces(ov, { hub: S.hub, size_m2: S.size, tenure: S.tenure, timeValue: S.timeValue });
    const ranked = rank(places.filter((p) => S.countries.has(p.country)), by);
    return { by, places, ranked };
  }

  function drawMap(places, ranked, by) {
    const status = new Map();
    for (const p of places) status.set(p.id, "out");
    let k = 0;
    const labels = [];
    for (const p of ranked) {
      if (sortValue(p, by) === null) { status.set(p.id, "nodata"); continue; }
      status.set(p.id, k < TOP ? "top" : "ranked");
      if (k < 3) labels.push(p.id);
      k += 1;
    }
    if (S.selected && !labels.includes(S.selected)) labels.push(S.selected);
    grmap.update({ status, labels });
    grmap.select(S.selected);
  }

  function drawIdleMap() {
    const status = new Map(ov.places.map((p) => [p.id, "ranked"]));
    grmap.update({ status, labels: S.selected ? [S.selected] : [] });
    grmap.select(S.selected);
  }

  function drawLegend() {
    legend.hidden = false;
    const row = h("div", "gr-legend-row");
    for (const [st, key] of [["top", "map.top"], ["ranked", "map.ranked"], ["nodata", "map.nodata"]]) {
      const it = h("span", "gr-key");
      const sw = h("i", `gr-sw gr-sw-${st}`);
      sw.setAttribute("aria-hidden", "true");
      it.append(sw, document.createTextNode(t(key)));
      row.append(it);
    }
    legend.replaceChildren(row, h("p", "gr-legend-size", t("map.size")));
  }

  function draw() {
    drawLead();
    drawLegend();
    if (!S.hub) {
      drawIdleMap();
      panel.replaceChildren(h("p", "lead ov-pick", t("ov.pick")), footer());
      current = [];
      return;
    }
    const { by, places, ranked } = computeRanked();
    current = ranked;
    drawMap(places, ranked, by);

    const bar = h("div", "ov-bar");
    bar.append(h("p", "ov-count", t("ov.count", { n: ranked.length, hub: t(`hub.${S.hub}`), size: S.size })));
    const sortRow = h("div", "ov-sortrow");
    sortRow.append(h("span", "ov-label small", t("ov.sort")));
    const seg = h("div", "seg ov-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("ov.sort"));
    for (const k of ["left", "time", "housing"]) {
      const label = k === "housing" && S.tenure === "buy" ? t("sort.housing_buy")
        : k === "left" && S.timeValue > 0 && S.tenure === "rent" ? t("sort.balance") : t(`sort.${k}`);
      const b = pressed(btn("", label, () => changed({ sort: k, shown: PAGE })), by === k);
      if (k === "left" && S.tenure === "buy") b.disabled = true;
      seg.append(b);
    }
    sortRow.append(seg);
    const chips = h("div", "ov-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Countries");
    for (const c of COUNTRIES) {
      chips.append(pressed(btn("ov-chip", c, () => {
        const next = new Set(S.countries);
        if (next.has(c)) next.delete(c); else next.add(c);
        changed({ countries: next, shown: PAGE });
      }), S.countries.has(c)));
      chips.lastChild.setAttribute("title", t(`country.${c}`));
    }
    sortRow.append(chips);
    bar.append(sortRow);

    const list = h("div", "ov-list");
    let n = 0;
    ranked.slice(0, S.shown).forEach((p) => {
      const has = sortValue(p, by) !== null;
      list.append(card(p, has ? n : null));
      if (has) n += 1;
    });
    if (!ranked.length) list.append(h("p", "muted", t("ov.none")));
    const parts = [bar, list];
    if (ranked.length > S.shown) {
      const rest = Math.min(PAGE * 2, ranked.length - S.shown);
      parts.push(btn("btn ov-moreall", t("ov.more", { n: rest }), () => changed({ shown: S.shown + rest })));
    }
    parts.push(footer());
    panel.replaceChildren(...parts);
  }

  function footer() {
    const f = h("div", "ov-foot");
    f.append(h("p", "section-title", t("ov.limits")));
    const ul = h("ul", "ov-limits");
    for (const l of ov.assumptions.limits || []) ul.append(h("li", null, lang === "fr" ? (LIMITS_FR[l] || l) : l));
    f.append(ul);
    f.append(h("p", "ov-salary", t("ov.salary", { y: ov.reference.net_year_lu, v: eur(ov.reference.net_monthly_lu, lang) })));
    const det = h("details", "ov-sources");
    det.append(h("summary", null, t("ov.sources")));
    const sl = h("ul");
    const all = [...Object.values(ov.sources), ...(ov.reference.sources || [])];
    for (const s of all) {
      const li = h("li");
      if (s.url && !KIOSK) {
        const a = h("a", null, s.name);
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener";
        li.append(a);
      } else li.textContent = s.name;
      sl.append(li);
    }
    det.append(sl);
    f.append(det);
    if (teaser) f.append(teaser());
    return f;
  }

  // Select a place from a card (fromMap = false) or from the map (scroll its card into view).
  function select(id, fromMap) {
    S.selected = id;
    if (fromMap && id && S.hub) {
      const i = current.findIndex((p) => p.id === id);
      if (i < 0 && !S.countries.has(id.slice(0, 2).toUpperCase())) {
        const p = ov.places.find((x) => x.id === id);
        if (p) S.countries = new Set([...S.countries, p.country]);
      }
      draw();
      const j = current.findIndex((p) => p.id === id);
      if (j >= S.shown) { S.shown = j + 1; draw(); }
      const el = panel.querySelector(`.ov-card[data-id="${CSS.escape(id)}"]`);
      if (el) {
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
      }
    } else draw();
    onChange?.();
  }

  draw();
  return { select: (id) => select(id, true), redraw: draw };
}
