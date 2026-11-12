/* global d3 */
export function createMap(svg, carte, { onSelect }) {
  const W = 600, H = 760;
  const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const proj = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], carte);
  const path = d3.geoPath(proj);
  const paths = sel.append("g").selectAll("path").data(carte.features).join("path")
    .attr("class", "lm-commune")
    .attr("d", path)
    .attr("data-lau", (d) => d.properties.lau)
    .on("click", (_e, d) => onSelect(d.properties.lau));
  paths.append("title").text((d) => d.properties.name);

  // groups: { focus: [lau], twins: [lau], answer: [lau] } — first group wins for a commune.
  function highlight(groups) {
    const cls = new Map();
    for (const [k, laus] of Object.entries(groups)) for (const l of laus || []) if (!cls.has(l)) cls.set(l, k);
    sel.classed("has-hl", cls.size > 0);
    paths.attr("data-hl", (d) => cls.get(d.properties.lau) || null);
  }
  return { highlight, clear: () => highlight({}) };
}
