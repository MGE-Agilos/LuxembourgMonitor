/* global d3 */
// Map of the 100 Luxembourg communes (commune pages, #/pays): choropleth of a chosen theme (quantile scale over the
// BDG sequential ramp, missing values grey) with its legend, plus the focus / twins / answer highlights.
import { data, displayName, fmt, label } from "./data.js";
import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";

export const MAP_THEMES = ["density", "rent_appt_m2", "sale_price_m2", "commute_kirchberg_driving", "debt_pc", "foreign_share"];
let theme = "density"; // kept across pages for the session

export function createMap(svg, carte, { onSelect, communes = [] }) {
  const W = 600, H = 760;
  const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], carte);
  const path = d3.geoPath(proj);
  const css = getComputedStyle(document.documentElement);
  const ramp = [1, 2, 3, 4, 5, 6, 7].map((i) => css.getPropertyValue(`--seq${i}`).trim());
  const byLau = new Map(communes.map((c) => [c.lau, c]));
  const paths = sel.append("g").selectAll("path").data(carte.features).join("path")
    .attr("class", "lm-commune")
    .attr("d", path)
    .attr("data-lau", (d) => d.properties.lau)
    .on("click", (_e, d) => onSelect(d.properties.lau));
  const titles = paths.append("title");

  // ---- legend + theme selector, right after the svg (hidden with it on the home)
  const box = h("div", "lm-maplegend");
  const pick = h("label", "lm-mappick");
  const pickText = h("span", "lm-mappick-l");
  const select = h("select", "lm-mapsel");
  select.onchange = () => { theme = select.value; paint(); };
  pick.append(pickText, select);
  const scale = h("div", "lm-mapscale");
  const keys = h("div", "lm-mapkeys");
  box.append(pick, scale, keys);
  svg.after(box);

  let color = null;
  let groupsNow = {};
  const valueOf = (lau) => byLau.get(lau)?.values[theme]?.v ?? null;

  function paint(lang = getLang()) {
    const vals = communes.map((c) => c.values[theme]?.v).filter((v) => typeof v === "number" && Number.isFinite(v));
    color = d3.scaleQuantile().domain(vals).range(ramp);
    paths.attr("style", (d) => { const v = valueOf(d.properties.lau); return v === null ? null : `--base: ${color(v)}`; })
      .classed("is-na", (d) => valueOf(d.properties.lau) === null);
    titles.text((d) => {
      const c = byLau.get(d.properties.lau);
      const v = valueOf(d.properties.lau);
      return `${c ? displayName(c, lang) : d.properties.name} — ${v === null ? t("np") : fmt(v, theme, lang)}`;
    });
    svg.setAttribute("aria-label", t("lm.map.label", { t: label(theme, lang) }));
    // stepped legend: one swatch per quantile class, labelled with its lower bound
    const bounds = [d3.min(vals), ...color.quantiles()];
    // step labels without the unit (it goes in the legend title) so 7 of them fit a phone width
    const unit = fmt(0, theme, lang).replace(/^[-\d.,\s\u202f\u00a0]+/, "").trim();
    const dec = data().ind.get(theme)?.decimals ?? 0;
    const bare = (v) => new Intl.NumberFormat(lang === "fr" ? "fr-LU" : "en-GB", { maximumFractionDigits: v >= 100 ? 0 : dec }).format(v);
    const steps = h("div", "lm-steps");
    steps.setAttribute("role", "list");
    ramp.forEach((c, i) => {
      const st = h("div", "lm-step");
      st.setAttribute("role", "listitem");
      const sw = h("i", "lm-sw");
      sw.style.background = c;
      const lo = bounds[i];
      const hi = i < ramp.length - 1 ? bounds[i + 1] : d3.max(vals);
      st.title = `${fmt(lo, theme, lang)} – ${fmt(hi, theme, lang)}`;
      st.append(sw, h("span", "lm-stepv", i === 0 ? `≥ ${bare(lo)}` : bare(lo)));
      steps.append(st);
    });
    const missing = communes.length - vals.length;
    scale.replaceChildren(h("p", "lm-scaletitle", `${label(theme, lang)}${unit ? ` (${unit})` : ""} · ${t("lm.quantiles")}`), steps);
    if (missing > 0) {
      const na = h("span", "lm-key");
      const sw = h("i", "lm-sw lm-sw-na");
      sw.setAttribute("aria-hidden", "true");
      na.append(sw, document.createTextNode(t("lm.np", { n: missing })));
      scale.append(na);
    }
    drawKeys();
  }

  function drawKeys() {
    const has = (k) => (groupsNow[k] || []).length > 0;
    const items = [];
    if (has("focus")) items.push(["focus", has("twins") ? t("lm.focus") : t("lm.highlight")]);
    if (has("twins")) items.push(["twins", t("lm.twins")]);
    if (has("answer")) items.push(["answer", t("lm.answer")]);
    keys.replaceChildren(...items.map(([k, text]) => {
      const it = h("span", "lm-key");
      const sw = h("i", `lm-sw lm-sw-${k}`);
      sw.setAttribute("aria-hidden", "true");
      it.append(sw, document.createTextNode(text));
      return it;
    }));
    keys.hidden = !items.length;
  }

  function relabel(lang = getLang()) {
    pickText.textContent = t("lm.theme");
    select.replaceChildren(...MAP_THEMES.map((id) => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = label(id, lang);
      o.selected = id === theme;
      return o;
    }));
    paint(lang);
  }
  relabel();

  // groups: { focus: [lau], twins: [lau], answer: [lau] } — first group wins for a commune.
  function highlight(groups) {
    groupsNow = groups || {};
    const cls = new Map();
    for (const [k, laus] of Object.entries(groupsNow)) for (const l of laus || []) if (!cls.has(l)) cls.set(l, k);
    sel.classed("has-hl", cls.size > 0);
    paths.attr("data-hl", (d) => cls.get(d.properties.lau) || null);
    drawKeys();
  }
  return { highlight, relabel, clear: () => highlight({}) };
}
