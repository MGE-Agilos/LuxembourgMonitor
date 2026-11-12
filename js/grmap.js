/* global d3, topojson */
// Greater Region map for "Où vivre ?": Luxembourg communes (polygons) + cross-border towns (circles sized by
// the number of people working in Luxembourg) + outlines of the neighbouring countries (world-atlas, cropped).
import { displayName } from "./data.js";
import { getLang, t } from "./i18n.js";

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const NEIGHBOURS = new Set(["250", "276", "056", "528"]); // France, Germany, Belgium, Netherlands (ISO numeric)
// Label anchors (lon, lat) chosen in empty areas of the crop.
const COUNTRY_LABELS = [["FR", 5.86, 49.2], ["DE", 6.72, 49.62], ["BE", 5.62, 49.82]];

export function placeName(p, lang = getLang()) {
  return p.lau ? displayName(p, lang) : p.name;
}

export function createGrMap(svg, { places, carte, onSelect }) {
  const W = 600, H = 780;
  const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const pts = places.map((p) => [p.lon, p.lat]);
  const [[x0, y0], [x1, y1]] = d3.geoBounds(carte);
  pts.push([x0, y0], [x1, y1]);
  const proj = d3.geoMercator().fitExtent([[30, 30], [W - 30, H - 30]], { type: "MultiPoint", coordinates: pts });
  proj.clipExtent([[0, 0], [W, H]]);
  const path = d3.geoPath(proj);

  const gCountries = sel.append("g").attr("class", "gr-countries");
  const gCountryNames = sel.append("g").attr("class", "gr-cnames");
  const gLu = sel.append("g");
  const gPts = sel.append("g");
  const gNames = sel.append("g").attr("class", "gr-names");

  const byLau = new Map(places.filter((p) => p.lau).map((p) => [p.lau, p]));
  const lu = gLu.selectAll("path").data(carte.features).join("path")
    .attr("class", "gr-lu")
    .attr("d", path)
    .attr("data-id", (d) => `lu:${d.properties.lau}`)
    .on("click", (_e, d) => onSelect(`lu:${d.properties.lau}`));
  const luTitles = lu.append("title");

  const cross = places.filter((p) => p.country !== "LU" && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const maxW = d3.max(cross, (p) => p.lu_workers) || 1;
  const r = d3.scaleSqrt().domain([0, maxW]).range([0, 20]);
  const groups = gPts.selectAll("g").data(cross.sort((a, b) => b.lu_workers - a.lu_workers)).join("g")
    .attr("class", "gr-place")
    .attr("data-id", (p) => p.id)
    .attr("transform", (p) => `translate(${proj([p.lon, p.lat])})`)
    .on("click", (_e, p) => onSelect(p.id));
  groups.append("circle").attr("class", "gr-hit").attr("r", (p) => Math.max(16, r(p.lu_workers) + 6));
  groups.append("circle").attr("class", "gr-pt").attr("r", (p) => Math.max(4, r(p.lu_workers)));
  const ptTitles = groups.append("title");

  const all = new Map(places.map((p) => [p.id, p]));
  let names = [];
  function drawNames() {
    const lang = getLang();
    // Greedy placement: above the mark, else right, else left; a label that still collides is dropped.
    const boxes = [];
    const items = [];
    for (const p of names.map((id) => all.get(id)).filter(Boolean)) {
      const text = placeName(p, lang);
      const [x, y] = proj([p.lon, p.lat]);
      const rad = p.country === "LU" ? 0 : Math.max(4, r(p.lu_workers || 0));
      const w = text.length * 8.4, hgt = 17;
      const tries = [
        { x, y: y - rad - 6, anchor: "middle", bx: x - w / 2 },
        { x: x + rad + 5, y: y + 5, anchor: "start", bx: x + rad + 5 },
        { x: x - rad - 5, y: y + 5, anchor: "end", bx: x - rad - 5 - w },
        { x, y: y + rad + 17, anchor: "middle", bx: x - w / 2 },
      ];
      const spot = tries.find((s) => !boxes.some((b) => s.bx < b.x1 && s.bx + w > b.x0 && s.y - hgt < b.y1 && s.y > b.y0));
      if (!spot) continue;
      boxes.push({ x0: spot.bx, x1: spot.bx + w, y0: spot.y - hgt, y1: spot.y });
      items.push({ id: p.id, text, ...spot });
    }
    gNames.selectAll("text").data(items, (d) => d.id).join("text")
      .attr("x", (d) => d.x).attr("y", (d) => d.y)
      .attr("text-anchor", (d) => d.anchor)
      .text((d) => d.text);
  }

  function relabel(lang = getLang()) {
    luTitles.text((d) => { const p = byLau.get(d.properties.lau); return p ? placeName(p, lang) : d.properties.name; });
    ptTitles.text((p) => p.name);
    gCountryNames.selectAll("text").text((d) => t(`country.${d[0]}`).toUpperCase());
    drawNames();
  }

  // status: Map id -> "top" | "ranked" | "nodata" | "out"; labels: ids to name on the map.
  function update({ status, labels = [] }) {
    lu.attr("data-st", (d) => status.get(`lu:${d.properties.lau}`) || "nodata");
    groups.attr("data-st", (p) => status.get(p.id) || "nodata");
    names = labels;
    drawNames();
  }
  function select(id) {
    lu.attr("data-sel", (d) => (`lu:${d.properties.lau}` === id ? "" : null));
    groups.attr("data-sel", (p) => (p.id === id ? "" : null));
    if (id) groups.filter((p) => p.id === id).raise();
  }
  // Attract mode: light up a few places (ids), fade the rest.
  function highlight(groupsArg = {}) {
    const ids = new Set(groupsArg.focus || []);
    sel.classed("has-hl", ids.size > 0);
    lu.attr("data-hl", (d) => (ids.has(`lu:${d.properties.lau}`) ? "focus" : null));
    groups.attr("data-hl", (p) => (ids.has(p.id) ? "focus" : null));
  }

  async function loadCountries() {
    try {
      if (typeof topojson === "undefined") return;
      const r2 = await fetch(WORLD_URL);
      if (!r2.ok) return;
      const world = await r2.json();
      const feats = topojson.feature(world, world.objects.countries).features.filter((f) => NEIGHBOURS.has(String(f.id)));
      gCountries.selectAll("path").data(feats).join("path").attr("class", "gr-country").attr("d", path);
      // Borders drawn as a mesh so the crop frame gets no stroke.
      gCountries.append("path").attr("class", "gr-border")
        .attr("d", path(topojson.mesh(world, world.objects.countries, (a, b) => a !== b)));
      gCountryNames.selectAll("text").data(COUNTRY_LABELS).join("text")
        .attr("transform", (d) => `translate(${proj([d[1], d[2]])})`).attr("text-anchor", "middle");
      relabel();
    } catch (err) {
      console.warn("country outlines unavailable", err);
    }
  }
  loadCountries();
  relabel();
  return { update, select, highlight, clear: () => highlight({}), relabel };
}
