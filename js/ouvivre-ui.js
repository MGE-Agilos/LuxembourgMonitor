// "Vous travaillez au Luxembourg. Où vivre ?" — one compact controls bar, then tabs: Ranking (dense sortable table on
// wide screens, compact cards on phones), Compare (ticked places side by side), Luxembourg in figures.
// Limits and sources sit behind a small dialog. The Greater Region map (left) follows the ranking.
import { KIOSK } from "./config.js";
import { compareTable } from "./compare.js";
import { h } from "./dom.js";
import { fmt, label } from "./data.js";
import { estMark, estText, officialOnly, setOfficialOnly } from "./estimate.js";
import { placeName } from "./grmap.js";
import { getLang, t } from "./i18n.js";
import { COUNTRIES, HUBS, SIZES, computePlaces, rank, referenceHourlyWage, sortValue } from "./ouvivre.js";
import { countryCompact } from "./pages.js";

const PAGE = 10;
const TOP = 10;
const MAX_CMP = 3;
const TABS = ["rank", "compare", "country"];
const WIDE = matchMedia("(min-width: 900px)");
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

const fresh = () => ({
  // Kirchberg (the largest business district) is shown by default so the map carries the ranking from the start;
  // `touched` tells whether the visitor has interacted (kiosk attract mode runs until then).
  hub: "kirchberg", touched: false, size: 70, tenure: "rent", sort: "left", timeValue: 0, countries: new Set(COUNTRIES), selected: null, shown: PAGE,
  tab: "rank", cmp: [], detail: null, colSrc: null, ctrlOpen: true, officialOnly: officialOnly(),
});
let S = fresh();
export function resetOuvivre() { S = fresh(); }
// "Où vivre depuis ici ?": open the home with this place selected (its country kept in the filter).
export function preselectOuvivre(id) {
  S.touched = true;
  S.selected = id;
  S.detail = id;
  S.tab = "rank";
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
// Prices of a million or more are written compactly ("1.03 M€") so they fit a table cell or a phone card.
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
// Button label "Couple · 70 m²" / "Findel (airport)": the qualifier goes in a span the wide bar hides when space is short.
function splitLabel(b, text) {
  const m = text.match(/^(.+?)( \(.+\))$/) || text.match(/^(.+ · )(.+)$/);
  if (!m) { b.textContent = text; return b; }
  if (text.includes(" · ")) b.append(h("span", "ov-x", m[1]), document.createTextNode(m[2]));
  else b.append(document.createTextNode(m[1]), h("span", "ov-x", m[2]));
  b.title = text;
  return b;
}
function sourceNodes(out, srcs) {
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
}
// Column headers may wrap on laptops: keep the last two words together ("Reste à vivre" -> "Reste / à vivre").
const glue = (s) => s.replace(/ (\S+)$/, "\u00a0$1");
const uniqSrc = (list) => {
  const seen = new Set();
  return list.filter((s) => s && s.name && !seen.has(s.name) && seen.add(s.name));
};

let escHandler = null;
// capture phase: runs before the chat bubble closes itself, so one Esc never closes both
addEventListener("keydown", (e) => { if (e.key === "Escape" && escHandler?.()) e.preventDefault(); }, { capture: true });

export function effectiveSort() { return S.tenure === "buy" && S.sort === "left" ? "housing" : S.sort; }

export function renderOuvivre({ lead, panel, legend, data, grmap, onCommune, onChange, onAsk, go = (hash) => { location.hash = hash; } }) {
  const lang = getLang();
  const ov = data.ouvivre;
  const A = ov.assumptions;
  const srcName = (id) => ov.sources[id]?.name || id;
  const srcUrl = (id) => ov.sources[id]?.url || null;
  const srcOf = (id) => (id ? { name: srcName(id), url: srcUrl(id) } : null);
  const salarySrc = ov.reference.sources?.[0];
  const sal = salarySrc ? { name: salarySrc.name, url: salarySrc.url } : null;
  const wide = () => WIDE.matches;

  function changed(patch, { resetScroll = true } = {}) {
    Object.assign(S, patch, { touched: true });
    onChange?.();
    draw({ resetScroll });
  }

  // ---- "what is 1 hour of your time worth?" slider: built once, never replaced, so a drag survives redraws
  const refWage = referenceHourlyWage(ov);
  const SLIDER_MAX = 40;
  const timeRow = h("div", "ov-time");
  const timeLabel = h("span", "ov-glabel");
  const timeVal = h("span", "ov-time-val");
  const timeTip = h("p", "ov-src ov-time-tipbox");
  const timeTipBtn = btn("ov-qbtn", "?", () => {
    timeTip.hidden = !timeTip.hidden;
    timeTipBtn.setAttribute("aria-expanded", String(!timeTip.hidden));
  });
  const slider = h("input", "ov-slider");
  const timeRef = h("span", "ov-time-ref");
  let timer = null;
  function buildSlider() {
    timeLabel.textContent = t("ov.time.short");
    timeLabel.title = t("ov.time.q");
    timeTipBtn.setAttribute("aria-label", t("ov.time.q"));
    timeTipBtn.setAttribute("aria-expanded", "false");
    timeTipBtn.setAttribute("aria-controls", "ov-time-tip");
    timeTip.id = "ov-time-tip";
    timeTip.hidden = true;
    timeTip.textContent = `${t("ov.time.q")} ${t("ov.time.tip")}${refWage === null ? "" : ` (${t("ov.time.ref", { w: num(refWage, lang, 1) })})`}`;
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
      timeRef.textContent = t("ov.ref.short", { w: `${num(refWage, lang, 1)} €/h` });
      timeRef.title = t("ov.time.ref", { w: num(refWage, lang, 1) });
      timeRef.style.setProperty("--p", String(refWage / SLIDER_MAX));
      track.append(tick, timeRef);
    }
    timeRow.replaceChildren(timeLabel, track, timeVal, timeTipBtn, timeTip);
    showTimeValue();
  }
  function showTimeValue() {
    timeVal.textContent = t("ov.time.val", { v: S.timeValue });
    slider.setAttribute("aria-valuetext", t("ov.time.val", { v: S.timeValue }));
  }
  buildSlider();

  // ---- lead: question + one compact controls bar (hub, size, rent/buy, time value)
  const summary = () => (S.hub ? `${t(`hub.${S.hub}`)} · ${S.size} m² · ${t(`ten.${S.tenure}`)}${S.tenure === "rent" && S.timeValue ? ` · ${t("ov.time.val", { v: S.timeValue })}` : ""}` : t("ov.hub"));
  function group(label, cls, items) {
    const g = h("div", `ov-opts ${cls}`);
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", label);
    for (const it of items) {
      const b = pressed(splitLabel(btn("ov-opt", null, it.onClick), it.text), it.on);
      b.dataset.fk = it.fk;
      g.append(b);
    }
    return g;
  }
  function drawLead() {
    const hubs = group(t("ov.hub"), "ov-hubs", HUBS.map((id) => ({
      text: t(`hub.${id}`), on: S.hub === id, fk: `hub:${id}`,
      onClick: () => { changed({ hub: id, shown: PAGE }); if (S.selected) select(S.selected, true); },
    })));
    const sizes = group(t("ov.situation"), "ov-sizes", SIZES.map((s) => ({
      text: t(`size.${s}`), on: S.size === s, fk: `size:${s}`, onClick: () => changed({ size: s }, { resetScroll: false }),
    })));
    const ten = group(`${t("ten.rent")} / ${t("ten.buy")}`, "ov-ten", ["rent", "buy"].map((k) => ({
      text: t(`ten.${k}`), on: S.tenure === k, fk: `ten:${k}`, onClick: () => changed({ tenure: k }),
    })));
    slider.disabled = S.tenure === "buy";
    timeRow.classList.toggle("is-off", slider.disabled);

    const gHub = h("div", "ov-grp ov-grp-hub");
    gHub.append(h("span", "ov-glabel", t("ov.hub")), hubs);
    const gSit = h("div", "ov-grp ov-grp-sit");
    gSit.append(h("span", "ov-glabel", t("ov.situation")), sizes, ten);
    // phone: the controls fold behind a "Settings" toggle once a hub is chosen
    const toggle = btn("ov-ctrl-toggle", null, () => { S.ctrlOpen = !S.ctrlOpen; drawLead(); });
    toggle.append(h("span", "ov-glabel", t("ov.settings")), h("span", "ov-sum", summary()), h("span", "ov-caret", S.ctrlOpen ? "▴" : "▾"));
    toggle.setAttribute("aria-expanded", String(S.ctrlOpen));
    toggle.setAttribute("aria-controls", "ov-ctrls");
    toggle.dataset.fk = "ctrl-toggle";
    toggle.hidden = !S.hub;
    const ctrls = lead.querySelector(".ov-ctrls") || h("div", "ov-ctrls");
    ctrls.id = "ov-ctrls";
    ctrls.classList.toggle("is-closed", Boolean(S.hub) && !S.ctrlOpen);
    // keep the slider node in place (do not detach it mid-drag): swap only the other children
    for (const c of [...ctrls.children]) if (c !== timeRow) c.remove();
    ctrls.prepend(gHub, gSit);
    if (timeRow.parentNode !== ctrls) ctrls.append(timeRow);
    for (const c of [...lead.children]) if (c !== ctrls) c.remove();
    lead.prepend(h("p", "eyebrow ov-eyebrow", t("eyebrow")), h("h1", "ov-q", t("ov.q")), toggle);
    if (ctrls.parentNode !== lead) lead.append(ctrls);
  }

  // ---- figures of a place (phone card and wide detail drawer), each with its source on tap
  function figure(host, key, value, subs, sources, estNote = null) {
    const box = h("div", "ov-num");
    box.append(h("span", "ov-k", key));
    if (value === null) box.append(h("span", "ov-v np", t("np")));
    else if (estNote) {
      const v = h("span", "ov-v is-est", value);
      v.append(estMark(estNote));
      box.append(v);
    } else box.append(h("span", "ov-v", value));
    for (const s of subs.filter(Boolean)) { const sp = h("span", "ov-s", s); sp.title = s; box.append(sp); }
    const srcs = sources.filter((s) => s && s.name);
    if (srcs.length || (estNote && value !== null)) {
      const i = btn("ov-i", "i", () => {
        const out = host.querySelector(".ov-src");
        const same = out.dataset.k === key && !out.hidden;
        out.replaceChildren();
        out.hidden = same;
        out.dataset.k = key;
        i.setAttribute("aria-expanded", String(!same));
        if (same) return;
        out.append(document.createTextNode(`${key} — `));
        if (estNote) out.append(h("strong", null, `${estNote}${srcs.length ? " — " : ""}`));
        sourceNodes(out, srcs);
      });
      i.setAttribute("aria-label", `${t("src.btn")} : ${key}`);
      i.setAttribute("aria-expanded", "false");
      box.append(i);
    }
    return box;
  }

  function figures(host, p, { compact }) {
    const estE = S.tenure === "rent" ? (p.rent_estimated ? p.rent_est : null) : (p.price_estimated ? p.sale_est : null);
    const estNote = estE ? estText(p, S.tenure === "rent" ? "rent" : "price") : null;
    const housingSrc = srcOf(S.tenure === "rent" ? p.src.rent_m2 : p.src.sale_price_m2) || (estE ? srcOf(estE.source_ids?.[0]) : null);
    const commuteSrc = srcOf(p.src.commute);
    const fuelSrc = p.fuel_cost_month === null ? null : {
      name: `${t("d.fuel")} : ${eur(p.fuel_cost_month, lang)} (${t("d.fuel_basis", {
        l: num(A.consumption_l_per_100km, lang, 1), d: A.working_days_per_year, p: num(A.fuel_price_eur_per_l, lang, 3), m: A.fuel_price_period })}) — ${srcName(A.fuel_price_source)}`,
      url: srcUrl(A.fuel_price_source) };
    const nums = h("div", "ov-nums");
    if (S.tenure === "rent") {
      nums.append(figure(host, t("k.rent"), p.rent_month === null ? null : eur(p.rent_month, lang),
        [p.share_of_lu_net === null ? null : t("s.share", { p: pct(p.share_of_lu_net, lang) })], [housingSrc, p.share_of_lu_net === null ? null : sal], estNote));
    } else {
      nums.append(figure(host, t("k.price"), p.price_total === null ? null : eurBig(p.price_total, lang),
        [p.years_of_lu_net === null ? null : t("s.years", { y: num(p.years_of_lu_net, lang, 1) })], [housingSrc, p.years_of_lu_net === null ? null : sal], estNote));
    }
    nums.append(figure(host, t("k.time"), p.car_min === null ? null : `${p.car_min} min`, p.car_min === null
      ? [p.dist_lux_km === null ? null : t("s.dist", { km: num(p.dist_lux_km, lang, 0) })]
      : [p.transit_min === null ? t("s.transit_none") : t("s.transit", { m: p.transit_min, p: p.transit_p80 ?? "–" }),
        compact ? null : t("s.hours", { h: num(p.hours_month_car, lang, 0) })], [commuteSrc]));
    if (S.tenure === "rent") {
      const timed = p.time_cost_month !== null;
      // compact (phone card, drawer) with a time value: the balance is the headline, the time cost its sub-line
      const bal = compact && timed && p.balance_month !== null;
      nums.append(figure(host, bal ? t("sort.balance") : t("k.left"), bal ? eur(p.balance_month, lang) : p.left_month === null ? null : eur(p.left_month, lang),
        [p.left_month === null || compact ? null : t("s.left"),
          compact || p.left_month === null || p.hours_month_car === null ? null : t("s.hours", { h: num(p.hours_month_car, lang, 0) }),
          !timed ? null : t("s.time", { c: eur(p.time_cost_month, lang), h: num(p.time_hours_month, lang, 0), v: S.timeValue }),
          !timed || compact || p.balance_month === null ? null : t("s.balance", { b: eur(p.balance_month, lang) })],
        [p.left_month === null ? null : housingSrc, p.left_month === null ? null : sal, p.left_month === null ? null : fuelSrc], p.left_month === null ? null : estNote));
    } else {
      nums.append(figure(host, t("k.left"), "—", [t("s.left_buy")], []));
    }
    return nums;
  }

  function detailRow(dl, k, v) {
    if (v === null || v === undefined) return;
    dl.append(h("dt", null, k), h("dd", null, v));
  }
  function details(p) {
    const dl = h("dl", "ov-dl");
    detailRow(dl, t("d.workers"), p.workers === null ? null : num(p.workers, lang));
    detailRow(dl, t("d.dist"), p.dist_lux_km === null ? null : `${num(p.dist_lux_km, lang, 1)} km`);
    detailRow(dl, t("d.road", { hub: t(`hub.${S.hub}`) }), p.car_km === null ? null : `${num(p.car_km, lang, 1)} km`);
    detailRow(dl, t("d.fuel"), p.fuel_cost_month === null ? null : `${eur(p.fuel_cost_month, lang)} (${t("d.fuel_basis", {
      l: num(A.consumption_l_per_100km, lang, 1), d: A.working_days_per_year, p: num(A.fuel_price_eur_per_l, lang, 3), m: A.fuel_price_period })})`);
    detailRow(dl, t("d.hours_car"), p.hours_month_car === null ? null : `${num(p.hours_month_car, lang, 0)} h`);
    detailRow(dl, t("d.hours_tc"), p.hours_month_transit === null ? null
      : `${num(p.hours_month_transit, lang, 0)} h (${p.hours_month_transit_p80 === null ? "–" : num(p.hours_month_transit_p80, lang, 0)} h)`);
    detailRow(dl, t("d.rent_m2"), p.rent_m2 !== null ? `${num(p.rent_m2, lang, 1)} €/m²`
      : p.rent_estimated && p.rent_m2_est !== null ? `${num(p.rent_m2_est, lang, 1)} €/m² (${t("est.short")})` : null);
    detailRow(dl, t("d.rent_range"), p.rent_range ? `${num(p.rent_range[0], lang, 1)} – ${num(p.rent_range[1], lang, 1)} €/m²` : null);
    detailRow(dl, t("d.sale_m2"), p.sale_price_m2 !== null ? `${num(p.sale_price_m2, lang)} €/m²`
      : p.price_estimated && p.sale_price_m2_est !== null ? `${num(p.sale_price_m2_est, lang)} €/m² (${t("est.short")})` : null);
    detailRow(dl, t("d.house_lu"), p.house_price === null ? null : eur(p.house_price, lang));
    detailRow(dl, t("d.house_be"), p.house_price_median === null ? null : eur(p.house_price_median, lang));
    detailRow(dl, t("d.appt_be"), p.appt_price_median === null ? null : eur(p.appt_price_median, lang));
    const out = [dl];
    if (p.notes.length) {
      const ul = h("ul", "ov-notes");
      for (const n of p.notes) {
        const m = /^(rent|price)_estimate_/.exec(n);
        ul.append(h("li", m ? "ov-estnote" : null, m ? estText(p, m[1]) : t(`note.${n}`)));
      }
      out.push(ul);
    }
    return out;
  }
  const openPage = (p) => (p.lau && data.byLau.has(p.lau) ? onCommune(p.lau) : go(`#/p/${p.id}`));

  function cmpBox(p, name) {
    const lab = h("label", "ov-cbx");
    const cb = h("input");
    cb.type = "checkbox";
    cb.checked = S.cmp.includes(p.id);
    cb.disabled = !cb.checked && S.cmp.length >= MAX_CMP;
    cb.setAttribute("aria-label", t("ov.cmp.tick", { name }));
    cb.dataset.fk = `cmp:${p.id}`;
    cb.onchange = () => toggleCmp(p.id);
    lab.title = cb.disabled ? t("cmp.max") : t("ov.cmp.tick", { name });
    lab.append(cb);
    return lab;
  }
  function toggleCmp(id) {
    S.cmp = S.cmp.includes(id) ? S.cmp.filter((x) => x !== id) : [...S.cmp, id].slice(0, MAX_CMP);
    draw();
  }

  // ---- phone: compact card (2 lines: name, then the 3 figures)
  function card(p, idx) {
    const el = h("article", "card ov-card");
    el.dataset.id = p.id;
    if (S.selected === p.id) el.dataset.sel = "";
    const name = placeName(p, lang);
    const top = h("div", "ov-headrow");
    const head = btn("ov-head", null, () => select(S.selected === p.id ? null : p.id, false));
    head.setAttribute("aria-pressed", String(S.selected === p.id));
    head.dataset.fk = `card:${p.id}`;
    head.append(h("span", "ov-rank", idx === null ? "–" : String(idx + 1)), h("span", "ov-name", name), h("span", "chip", p.country));
    top.append(head, cmpBox(p, name));
    el.append(top, figures(el, p, { compact: true }));
    const src = h("p", "ov-src");
    src.hidden = true;
    el.append(src);
    const more = h("details", "ov-more");
    more.append(h("summary", null, t("details")), ...details(p));
    more.append(btn("btn small", t("ov.fiche"), () => openPage(p)));
    el.append(more);
    return el;
  }

  // ---- wide: dense sortable table
  function cellOf(td, v) {
    if (v === null) {
      const na = h("span", "ov-na");
      na.title = t("np");
      na.append(h("span", null, "–"));
      na.firstChild.setAttribute("aria-hidden", "true");
      na.append(h("span", "sr-only", t("np")));
      td.append(na);
    } else if (Array.isArray(v)) {
      td.append(document.createTextNode(v[0]));
      if (v[1] !== null) td.append(h("span", "ov-sub", ` ${v[1]}`));
    } else td.append(document.createTextNode(v));
  }

  function columns(ranked) {
    const rent = S.tenure === "rent";
    const tv = rent && S.timeValue > 0;
    const pick = (key) => uniqSrc(ranked.map((p) => srcOf(p.src?.[key])));
    const estIds = ranked.filter((p) => (rent ? p.rent_estimated : p.price_estimated)).flatMap((p) => (rent ? p.rent_est : p.sale_est)?.source_ids || []);
    const housingS = uniqSrc([...pick(rent ? "rent_m2" : "sale_price_m2"), ...[...new Set(estIds)].map(srcOf)]);
    const commuteS = pick("commute");
    const salS = sal ? [sal] : [];
    const fuelS = A.fuel_price_source ? [srcOf(A.fuel_price_source)] : [];
    const cols = [
      { k: "housing", label: rent ? t("k.rent") : t("k.price"), sort: "housing", src: housingS,
        est: (p) => (rent ? p.rent_estimated : p.price_estimated),
        v: (p) => (rent ? (p.rent_month === null ? null : eur(p.rent_month, lang)) : (p.price_total === null ? null : eurBig(p.price_total, lang))) },
      { k: "share", label: rent ? t("col.share") : t("col.years"), sort: "housing", src: uniqSrc([...housingS, ...salS]),
        est: (p) => (rent ? p.rent_estimated : p.price_estimated),
        v: (p) => (rent ? (p.share_of_lu_net === null ? null : pct(p.share_of_lu_net, lang)) : (p.years_of_lu_net === null ? null : num(p.years_of_lu_net, lang, 1))) },
      { k: "car", label: t("col.car"), sort: "time", src: commuteS, v: (p) => (p.car_min === null ? null : t("ov.min", { m: p.car_min })) },
      { k: "tc", label: t("col.tc"), sub: t("col.tc80"), src: commuteS,
        v: (p) => (p.transit_min === null ? null : [t("ov.min", { m: p.transit_min }), p.transit_p80 ?? null]) },
      { k: "hours", label: t("col.hours"), sort: "time", src: commuteS,
        v: (p) => (p.hours_month_car === null ? null : t("ov.h", { h: num(p.hours_month_car, lang, 0) })) },
    ];
    if (rent) {
      cols.push({ k: "left", label: tv ? t("sort.balance") : t("k.left"), sort: "left", src: uniqSrc([...housingS, ...salS, ...fuelS]),
        est: (p) => p.rent_estimated,
        v: (p) => { const x = tv ? p.balance_month : p.left_month; return x === null ? null : eur(x, lang); },
        title: (p) => (tv && p.time_cost_month !== null && p.left_month !== null
          ? `${t("k.left")} ${eur(p.left_month, lang)} · ${t("s.time", { c: eur(p.time_cost_month, lang), h: num(p.time_hours_month, lang, 0), v: S.timeValue })}`
          : null) });
    }
    return cols;
  }

  function tableView(ranked, by) {
    const cols = columns(ranked);
    const box = h("div", "ov-rankbox");
    const wrap = h("div", "ov-tblwrap");
    const tbl = h("table", "ov-table");
    tbl.append(h("caption", "sr-only", t("ov.count", { n: ranked.length, hub: t(`hub.${S.hub}`), size: S.size })));
    const hr = h("tr");
    const thC = h("th", "ov-thc");
    thC.scope = "col";
    thC.append(h("span", "sr-only", t("col.cmp")));
    const thR = h("th", "ov-thr");
    thR.scope = "col";
    thR.append(h("span", "ov-hl", "#"));
    thR.title = t("col.rank");
    const thN = h("th", "ov-thn");
    thN.scope = "col";
    thN.append(h("span", "ov-hl", t("col.place")));
    hr.append(thC, thR, thN);
    for (const c of cols) {
      const th = h("th", by === c.sort ? "is-sort" : null);
      th.scope = "col";
      th.dataset.col = c.k;
      const inner = h("span", "ov-thin");
      if (c.sort) {
        const b = btn("ov-sortbtn", null, () => { if (by !== c.sort) changed({ sort: c.sort, shown: PAGE }); });
        b.append(h("span", "ov-hl", glue(c.label)));
        const arrow = h("span", "ov-arrow", by === c.sort ? "▼" : "");
        arrow.setAttribute("aria-hidden", "true");
        b.append(arrow);
        b.title = t("ov.sortby", { c: c.label });
        b.dataset.fk = `sort:${c.k}`;
        th.setAttribute("aria-sort", by === c.sort ? (c.sort === "left" ? "descending" : "ascending") : "none");
        inner.append(b);
      } else {
        const l = h("span", "ov-hl ov-hplain", glue(c.label));
        if (c.sub) l.append(h("span", "ov-hsub", c.sub));
        inner.append(l);
      }
      if (c.src.length) {
        const i = btn("ov-hi", "i", () => { S.colSrc = S.colSrc === c.k ? null : c.k; draw(); });
        i.setAttribute("aria-label", `${t("src.btn")} : ${c.label}`);
        i.setAttribute("aria-expanded", String(S.colSrc === c.k));
        i.dataset.fk = `src:${c.k}`;
        inner.append(i);
      }
      th.append(inner);
      hr.append(th);
    }
    const thead = h("thead");
    thead.append(hr);
    const tb = h("tbody");
    let n = 0;
    for (const p of ranked) {
      const has = sortValue(p, by) !== null;
      const name = placeName(p, lang);
      const tr = h("tr");
      tr.dataset.id = p.id;
      if (S.selected === p.id) tr.classList.add("is-sel");
      if (!has) tr.classList.add("is-nodata");
      const tdc = h("td", "ov-tdc");
      tdc.append(cmpBox(p, name));
      const tdr = h("td", "ov-tdr", has ? String(++n) : "–");
      const th = h("th", "ov-tdn");
      th.scope = "row";
      const b = btn("ov-place", null, () => openDetail(p.id));
      b.append(h("span", "ov-pname", name), h("span", "ov-cc", p.country));
      b.title = `${name} (${t(`country.${p.country}`)})`;
      b.dataset.fk = `row:${p.id}`;
      b.setAttribute("aria-expanded", String(S.detail === p.id));
      th.append(b);
      tr.append(tdc, tdr, th);
      for (const c of cols) {
        const td = h("td", by === c.sort ? "is-sort" : null);
        const cv = c.v(p);
        cellOf(td, cv);
        const tt = c.title?.(p);
        if (tt) td.title = tt;
        if (cv !== null && c.est?.(p)) {
          td.classList.add("is-est");
          td.append(estMark(estText(p, S.tenure === "rent" ? "rent" : "price")));
        }
        tr.append(td);
      }
      tr.onclick = (e) => { if (!e.target.closest("label, input, button")) openDetail(p.id); };
      tr.onmouseenter = () => hover(p.id);
      tr.onmouseleave = () => hover(null);
      tb.append(tr);
    }
    // keyboard: arrows move between the place buttons, Esc closes the detail drawer
    tb.addEventListener("keydown", (e) => {
      const cur = e.target.closest(".ov-place");
      if (!cur) return;
      const all = [...tb.querySelectorAll(".ov-place")];
      const i = all.indexOf(cur);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const el = all[Math.max(0, Math.min(all.length - 1, to))];
      el.focus();
      hover(el.closest("tr").dataset.id);
    });
    tbl.append(thead, tb);
    if (!ranked.length) wrap.append(h("p", "muted ov-none", t("ov.none")));
    wrap.append(tbl);
    box.append(wrap);
    if (S.colSrc) {
      const c = cols.find((x) => x.k === S.colSrc);
      if (c) {
        const pop = h("div", "ov-colsrc");
        pop.setAttribute("role", "status");
        const line = h("p", "ov-src");
        line.append(document.createTextNode(`${t("ov.colsrc", { c: c.label })} — `));
        sourceNodes(line, c.src);
        const x = btn("ov-x-btn", "×", () => { S.colSrc = null; draw(); });
        x.setAttribute("aria-label", t("ov.close"));
        pop.append(line, x);
        box.append(pop);
      }
    }
    const dp = S.detail && ranked.find((p) => p.id === S.detail);
    if (dp) box.append(drawer(dp, ranked));
    return box;
  }

  // Detail of a place: drawer over the right of the table (wide) or bottom sheet (phone, opened from the map).
  const PROFILE = ["pop", "salary_month", "pupils_per_class", "debt_pc", "pt_departures_p1000", "foreign_share"];
  function kfig(k, v, sub) {
    const el = h("div", "ov-kf");
    el.dataset.fig = "";
    el.append(h("span", "ov-k", k), v === null ? h("span", "ov-kv np", t("np")) : h("span", "ov-kv", v));
    if (sub) el.append(h("span", "ov-s", sub));
    return el;
  }
  function drawer(p, ranked) {
    const name = placeName(p, lang);
    const d = h("aside", `card ov-drawer${wide() ? "" : " is-sheet"}`);
    d.id = "ov-drawer";
    d.setAttribute("aria-label", name);
    const head = h("div", "ov-dhead");
    const x = btn("ov-x-btn", "×", () => closeDetail());
    x.setAttribute("aria-label", t("ov.close"));
    x.dataset.fk = "drawer-close";
    const by = effectiveSort();
    const idx = ranked.filter((q) => sortValue(q, by) !== null).findIndex((q) => q.id === p.id);
    head.append(h("span", "ov-drank", idx < 0 ? "–" : `#${idx + 1}`), h("h2", "ov-dname", name), h("span", "chip", t(`country.${p.country}`)), x);
    d.append(head);
    if (idx < 0) d.append(h("p", "chip warn ov-missing", t("ov.notranked")));
    const nums = figures(d, p, { compact: true });
    for (const f of nums.children) f.dataset.fig = "";
    const src = h("p", "ov-src");
    src.hidden = true;
    d.append(nums, src);
    const kfs = h("div", "ov-kfs");
    kfs.append(
      kfig(t("ov.workers.k"), p.workers === null ? null : num(p.workers, lang)),
      kfig(t("ov.hours.k"), p.hours_month_car === null ? null : `${num(p.hours_month_car, lang, 0)} h`),
      kfig(t("ov.fuel.k"), p.fuel_cost_month === null ? null : eur(p.fuel_cost_month, lang)),
      kfig(t("ov.dist.k"), p.dist_lux_km === null ? null : `${num(p.dist_lux_km, lang, 0)} km`),
    );
    d.append(kfs);
    // minutes to every work hub, the chosen one emphasised
    const raw = ov.places.find((q) => q.id === p.id);
    if (raw?.commute) {
      const tbl = h("table", "ov-hubtbl");
      tbl.append(h("caption", "ov-hubcap", t("ov.hubs")));
      const hr = h("tr");
      for (const txt of ["", t("ov.hubs.car"), t("ov.hubs.tc")]) { const th = h("th", null, txt); th.scope = "col"; hr.append(th); }
      const thead = h("thead");
      thead.append(hr);
      const tb = h("tbody");
      for (const hb of HUBS) {
        const c = raw.commute[hb];
        const tr = h("tr", hb === S.hub ? "is-cur" : null);
        const th = h("th", null, t(`hub.${hb}`));
        th.scope = "row";
        const td1 = h("td");
        cellOf(td1, typeof c?.driving === "number" ? t("ov.min", { m: c.driving }) : null);
        const td2 = h("td");
        cellOf(td2, typeof c?.transit === "number" ? [t("ov.min", { m: c.transit }), c.transit_p80 ?? null] : null);
        tr.append(th, td1, td2);
        tb.append(tr);
      }
      tbl.append(thead, tb);
      d.append(tbl);
    }
    // LU communes: key profile figures
    const c = p.lau ? data.byLau.get(p.lau) : null;
    if (c) {
      d.append(h("p", "section-title ov-dsec", t("ov.profile")));
      const pf = h("div", "ov-kfs");
      for (const id of PROFILE) {
        const v = c.values[id];
        const g = id === "pop" ? c.values.pop_growth_10y : null;
        pf.append(kfig(label(id, lang), v ? fmt(v.v, id, lang) : null,
          g ? t("ov.years10", { g: `${g.v > 0 ? "+" : ""}${fmt(g.v, "pop_growth_10y", lang)}` }) : (v?.y ? String(v.y) : null)));
      }
      d.append(pf);
    }
    const [dl, notes] = details(p);
    if (notes) d.append(notes);
    const more = h("details", "ov-more");
    more.append(h("summary", null, t("ov.moredet")), dl);
    d.append(more);
    const acts = h("div", "ov-dacts");
    const inCmp = S.cmp.includes(p.id);
    const cmpB = pressed(btn("btn", inCmp ? `✓ ${t("ov.compared")}` : t("ov.compare"), () => {
      toggleCmp(p.id);
      if (S.cmp.includes(p.id) && S.cmp.length >= 2) { S.tab = "compare"; draw(); }
    }), inCmp);
    cmpB.disabled = !inCmp && S.cmp.length >= MAX_CMP;
    cmpB.dataset.fk = "drawer-cmp";
    const askB = btn("btn ghost ov-askbtn", t("ov.ask"), () => onAsk?.());
    askB.dataset.fk = "drawer-ask";
    acts.append(btn("btn primary", t("ov.fiche"), () => openPage(p)), cmpB, askB);
    d.append(acts);
    return d;
  }
  function openDetail(id) {
    S.touched = true;
    if (S.detail === id) { closeDetail(); return; }
    S.selected = id;
    S.detail = id;
    S.colSrc = null;
    draw();
    onChange?.();
  }
  function closeDetail() {
    const id = S.detail;
    S.detail = null;
    draw();
    panel.querySelector(`.ov-place[data-fk="row:${CSS.escape(id || "")}"]`)?.focus({ preventScroll: true });
  }

  // Row <-> map hover link
  let hovered = null;
  function hover(id) {
    if (id === hovered) return;
    hovered = id;
    for (const r of panel.querySelectorAll(".ov-table tr.is-hov")) r.classList.remove("is-hov");
    if (id) panel.querySelector(`.ov-table tr[data-id="${CSS.escape(id)}"]`)?.classList.add("is-hov");
    grmap.hover?.(id);
  }

  // ---- results
  let current = [];
  function computeRanked() {
    const by = effectiveSort();
    const places = computePlaces(ov, { hub: S.hub, size_m2: S.size, tenure: S.tenure, timeValue: S.timeValue, useEstimates: !S.officialOnly });
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
    const vars = S.hub ? { hub: t(`hub.${S.hub}`), size: S.size, ten: t(`ten.${S.tenure}`).toLowerCase() } : {};
    for (const [st, key] of [["top", "map.top"], ["ranked", "map.ranked"], ["nodata", "map.nodata"]]) {
      if (st === "top" && !S.hub) continue;
      const it = h("span", "gr-key");
      const sw = h("i", `gr-sw gr-sw-${st}`);
      sw.setAttribute("aria-hidden", "true");
      it.append(sw, document.createTextNode(t(key, vars)));
      row.append(it);
    }
    legend.replaceChildren(row, h("p", "gr-legend-size", t("map.size")));
  }

  function tabBar() {
    const bar = h("div", "seg ov-tabs");
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", t("ov.tabs"));
    const label = { rank: t("tab.rank"), compare: S.cmp.length ? `${t("tab.compare")} (${S.cmp.length})` : t("tab.compare"), country: t("nav.country") };
    for (const k of TABS) {
      const b = btn("ov-tab", label[k], () => { if (S.tab !== k) changed({ tab: k }, { resetScroll: false }); });
      b.id = `ov-tab-${k}`;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(S.tab === k));
      b.setAttribute("aria-controls", "ov-tp");
      b.tabIndex = S.tab === k ? 0 : -1;
      b.dataset.tab = k;
      b.dataset.fk = `tab:${k}`;
      bar.append(b);
    }
    bar.addEventListener("keydown", (e) => {
      const i = TABS.indexOf(S.tab);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      changed({ tab: TABS[(to + TABS.length) % TABS.length] }, { resetScroll: false });
    });
    return bar;
  }

  function chipsBar() {
    const chips = h("div", "ov-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", t("ov.countries"));
    for (const c of COUNTRIES) {
      const b = pressed(btn("ov-chip", c, () => {
        const next = new Set(S.countries);
        if (next.has(c)) next.delete(c); else next.add(c);
        changed({ countries: next, shown: PAGE });
      }), S.countries.has(c));
      b.title = t(`country.${c}`);
      b.setAttribute("aria-label", t(`country.${c}`));
      b.dataset.fk = `cc:${c}`;
      chips.append(b);
    }
    return chips;
  }

  function rankTab(tp) {
    if (!S.hub) {
      tp.append(h("p", "lead ov-pick", t("ov.pick")), countryCompact());
      return;
    }
    const { by, places, ranked } = computeRanked();
    current = ranked;
    drawMap(places, ranked, by);
    if (wide()) { tp.append(tableView(ranked, by)); return; }
    const sortRow = h("div", "ov-sortrow");
    sortRow.append(h("span", "ov-glabel", t("ov.sort")));
    const seg = h("div", "seg ov-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("ov.sort"));
    for (const k of ["left", "time", "housing"]) {
      const label = k === "housing" && S.tenure === "buy" ? t("sort.housing_buy")
        : k === "left" && S.timeValue > 0 && S.tenure === "rent" ? t("sort.balance") : t(`sort.${k}`);
      const b = pressed(btn("", label, () => changed({ sort: k, shown: PAGE })), by === k);
      b.dataset.fk = `psort:${k}`;
      if (k === "left" && S.tenure === "buy") b.disabled = true;
      seg.append(b);
    }
    sortRow.append(seg, chipsBar());
    const list = h("div", "ov-list");
    let n = 0;
    ranked.slice(0, S.shown).forEach((p) => {
      const has = sortValue(p, by) !== null;
      list.append(card(p, has ? n : null));
      if (has) n += 1;
    });
    if (!ranked.length) list.append(h("p", "muted", t("ov.none")));
    tp.append(sortRow, list);
    const dp = S.detail && ranked.find((p) => p.id === S.detail);
    if (dp) tp.append(drawer(dp, ranked));
    if (ranked.length > S.shown) {
      const rest = Math.min(PAGE * 2, ranked.length - S.shown);
      tp.append(btn("btn ov-moreall", t("ov.more", { n: rest }), () => changed({ shown: S.shown + rest }, { resetScroll: false })));
    }
  }

  function compareTab(tp) {
    if (!S.cmp.length) { tp.append(h("p", "lead ov-pick", t("ov.cmp.hint"))); return; }
    tp.append(compareTable(S.cmp, { hub: S.hub || "kirchberg", onRemove: (id) => { S.cmp = S.cmp.filter((x) => x !== id); draw(); } }));
    if (S.cmp.length < 2) tp.append(h("p", "muted ov-cmphint", t("ov.cmp.hint")));
    const a = h("a", "btn small ov-cmpfull", t("ov.cmp.full"));
    a.href = `#/compare/${S.cmp.join("/")}`;
    tp.append(a);
  }

  function draw({ resetScroll = false } = {}) {
    const ae = document.activeElement;
    const fk = ae && (lead.contains(ae) || panel.contains(ae)) ? ae.dataset.fk : null;
    const prevScroll = resetScroll ? 0 : (panel.querySelector(".ov-tblwrap, .ov-tabpanel")?.scrollTop || 0);
    drawLead();
    drawLegend();
    if (!S.hub) { drawIdleMap(); current = []; }

    const top = h("div", "ov-tabsrow");
    if (S.hub) {
      // phone: sticky summary of the settings, a tap brings the controls back
      const sum = btn("ov-sumbtn", `${t("ov.settings")} ▴`, () => { S.ctrlOpen = true; drawLead(); lead.scrollIntoView({ block: "start" }); });
      sum.title = summary();
      sum.setAttribute("aria-label", `${t("ov.settings")} : ${summary()}`);
      sum.dataset.fk = "sum";
      top.append(sum);
    }
    top.append(tabBar());
    if (S.tab === "rank" && S.hub && wide()) top.append(chipsBar());
    const tp = h("div", `ov-tabpanel is-${S.tab}`);
    tp.id = "ov-tp";
    tp.setAttribute("role", "tabpanel");
    tp.setAttribute("aria-labelledby", `ov-tab-${S.tab}`);
    if (S.tab === "compare") compareTab(tp);
    else if (S.tab === "country") tp.append(countryCompact());
    else rankTab(tp);
    if (S.tab !== "rank" && S.hub) { const r = computeRanked(); current = r.ranked; drawMap(r.places, r.ranked, r.by); }

    const status = h("div", "ov-status");
    if (S.hub) {
      const nEst = current.filter((p) => sortValue(p, effectiveSort()) !== null && (S.tenure === "rent" ? p.rent_estimated : p.price_estimated)).length;
      status.append(h("span", "ov-count", `${t("ov.count", { n: current.length, hub: t(`hub.${S.hub}`), size: S.size })}${nEst ? ` · ${t("ov.nest", { n: nEst })}` : ""}`));
      const off = pressed(btn("ov-off", t("ov.official"), () => {
        S.officialOnly = !S.officialOnly;
        setOfficialOnly(S.officialOnly);
        S.touched = true;
        onChange?.();
        draw();
      }), S.officialOnly);
      off.title = t("ov.official.tip");
      off.dataset.fk = "official";
      status.append(off);
    }
    const lim = btn("link-btn ov-limbtn", t("ov.limsrc"), openDialog);
    lim.setAttribute("aria-haspopup", "dialog");
    lim.dataset.fk = "limits";
    status.append(lim);
    panel.replaceChildren(top, tp, status);
    hovered = null;
    const sc = panel.querySelector(".ov-tblwrap") || tp;
    sc.scrollTop = prevScroll;
    if (fk) panel.parentNode.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
  }

  // "Limits & sources" dialog (assumptions, reference salary, every source of the ranking)
  function openDialog() {
    const dlg = h("dialog", "ov-dialog card");
    dlg.setAttribute("aria-labelledby", "ov-dlg-title");
    const head = h("div", "ov-dhead");
    const title = h("h2", "ov-dname", t("ov.limsrc"));
    title.id = "ov-dlg-title";
    const x = btn("ov-x-btn", "×", () => dlg.close());
    x.setAttribute("aria-label", t("ov.close"));
    head.append(title, x);
    const body = h("div", "ov-foot");
    body.append(h("p", "section-title", t("ov.limits")));
    const ul = h("ul", "ov-limits");
    for (const l of A.limits || []) ul.append(h("li", null, lang === "fr" ? (LIMITS_FR[l] || l) : l));
    body.append(ul, h("p", "ov-salary", t("ov.salary", { y: ov.reference.net_year_lu, v: eur(ov.reference.net_monthly_lu, lang) })));
    body.append(h("p", "section-title", t("ov.sources")));
    const sl = h("ul", "ov-srclist");
    for (const s of [...Object.values(ov.sources), ...(ov.reference.sources || [])]) {
      const li = h("li");
      sourceNodes(li, [s]);
      sl.append(li);
    }
    const all = h("a", "btn small", t("nav.sources"));
    all.href = "#/sources";
    all.onclick = () => dlg.close();
    body.append(sl, h("p", "muted small", `${t("foot.sources")} · ${t("built")}`), all);
    dlg.append(head, body);
    dlg.addEventListener("close", () => { dlg.remove(); panel.querySelector(".ov-limbtn")?.focus({ preventScroll: true }); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    panel.append(dlg);
    dlg.showModal();
  }

  // Select a place from a card / row (fromMap = false) or from the map (bring its row or card into view).
  function select(id, fromMap) {
    S.touched = true;
    S.selected = id;
    if (fromMap && id && S.hub) {
      const i = current.findIndex((p) => p.id === id);
      if (i < 0 && !S.countries.has(id.slice(0, 2).toUpperCase())) {
        const p = ov.places.find((x) => x.id === id);
        if (p) S.countries = new Set([...S.countries, p.country]);
      }
      S.tab = "rank";
      S.detail = id;
      draw();
      const j = current.findIndex((p) => p.id === id);
      if (!wide() && j >= S.shown) { S.shown = j + 1; draw(); }
      const el = wide() ? panel.querySelector(`.ov-table tr[data-id="${CSS.escape(id)}"]`) : null;
      if (el) {
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: wide() ? "center" : "nearest" });
      }
    } else draw();
    onChange?.();
  }

  // Esc closes the detail drawer / sheet (unless the chat bubble or a dialog is open)
  escHandler = () => {
    if (!S.detail || !panel.isConnected || lead.hidden || document.body.classList.contains("chat-open") || document.body.classList.contains("tour-open")
      || document.querySelector("dialog[open]")) return false;
    closeDetail();
    return true;
  };

  // Re-render when crossing the phone / wide breakpoint (cards <-> table).
  WIDE.onchange = () => { if (panel.isConnected && lead.isConnected && !lead.hidden) draw({ resetScroll: true }); };

  draw({ resetScroll: true });
  return { select: (id) => select(id, true), hover: (id) => { if (wide() && S.hub && S.tab === "rank") hover(id); }, redraw: draw };
}
