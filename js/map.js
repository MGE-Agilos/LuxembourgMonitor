/* global d3 */
import { displayName } from "./data.js";
import { getLang } from "./i18n.js";
export function createMap(svg, carte, { onSelect, communes = [] }) {
  const W = 600, H = 760;
  const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], carte);
  const path = d3.geoPath(proj);
  // Base map: choropleth of population density, quantile scale over the BDG sequential ramp.
  const css = getComputedStyle(document.documentElement);
  const ramp = [1, 2, 3, 4, 5, 6, 7].map((i) => css.getPropertyValue(`--seq${i}`).trim());
  const dens = new Map(communes.filter((c) => c.values.density).map((c) => [c.lau, c.values.density.v]));
  const color = d3.scaleQuantile().domain([...dens.values()]).range(ramp);
  const baseFor = (lau) => (dens.has(lau) ? color(dens.get(lau)) : null);
  const paths = sel.append("g").selectAll("path").data(carte.features).join("path")
    .attr("class", "lm-commune")
    .attr("d", path)
    .attr("data-lau", (d) => d.properties.lau)
    .attr("style", (d) => { const b = baseFor(d.properties.lau); return b ? `--base: ${b}` : null; })
    .on("click", (_e, d) => onSelect(d.properties.lau));
  const titles = paths.append("title");
  const byLau = new Map(communes.map((c) => [c.lau, c]));
  function relabel(lang = getLang()) {
    titles.text((d) => { const c = byLau.get(d.properties.lau); return c ? displayName(c, lang) : d.properties.name; });
  }
  relabel();

  // groups: { focus: [lau], twins: [lau], answer: [lau] } — first group wins for a commune.
  function highlight(groups) {
    const cls = new Map();
    for (const [k, laus] of Object.entries(groups)) for (const l of laus || []) if (!cls.has(l)) cls.set(l, k);
    sel.classed("has-hl", cls.size > 0);
    paths.attr("data-hl", (d) => cls.get(d.properties.lau) || null);
  }
  return { highlight, relabel, clear: () => highlight({}) };
}
