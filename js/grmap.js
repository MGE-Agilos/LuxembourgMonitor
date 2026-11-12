/* global d3, topojson */
// Greater Region map for "Où vivre ?": Luxembourg communes (polygons) + cross-border towns (circles sized by
// the number of people working in Luxembourg) + outlines of the neighbouring countries (world-atlas, cropped).
// Plan B2: the same map can be redrawn "in minutes" (time-distance cartogram around the work hub, js/cartogram.js),
// by car or public transport, with animated morphing between the three states.
import { RING_MINUTES, flattenRings, lerpCoords, makeWarp, ringRadii, ringsPath } from "./cartogram.js";
import { displayName } from "./data.js";
import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const NEIGHBOURS = new Set(["250", "276", "056", "528"]); // France, Germany, Belgium, Netherlands (ISO numeric)
// Label anchors (lon, lat) chosen in empty areas of the crop.
const COUNTRY_LABELS = [["FR", 5.86, 49.2], ["DE", 6.72, 49.62], ["BE", 5.62, 49.82]];
// Work hubs (lon, lat). ouvivre.json gives hub ids only; approximate centres of each business district read from
// OpenStreetMap (Kirchberg plateau, Gare centrale, Cloche d'Or, Belval / Cité des sciences, Findel airport,
// Luxembourg City centre).
const HUB_COORDS = {
  kirchberg: [6.155, 49.628],
  "lux-gare": [6.133, 49.6],
  "cloche-dor": [6.118, 49.578],
  belval: [5.946, 49.501],
  findel: [6.204, 49.633],
  "lux-city": [6.1319, 49.6116],
};
const DEFAULT_HUB = "lux-city";
const MODES = ["km", "driving", "transit"];
const MORPH_MS = 1400;
// Cartogram parameters (see js/cartogram.js): 6 nearest controls, inverse-distance power 2, controls within 3 km
// of the hub ignored (ratio unstable), polar grid of 144 azimuths x 4 px smoothed twice across azimuths;
// one px-per-minute scale per hub shared by car and transit (see hubScale) so that the rings stay put and
// public transport visibly pushes places outwards.
const WARP = { k: 6, power: 2, minKm: 3, smooth: 2, angles: 144, step: 4 };

export function placeName(p, lang = getLang()) {
  return p.lau ? displayName(p, lang) : p.name;
}

export function createGrMap(svg, { places, carte, onSelect, getHub = () => null, onUserMode = () => {} }) {
  const W = 600, H = 780;
  const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const pts = places.map((p) => [p.lon, p.lat]);
  const [[x0, y0], [x1, y1]] = d3.geoBounds(carte);
  pts.push([x0, y0], [x1, y1]);
  const proj = d3.geoMercator().fitExtent([[30, 30], [W - 30, H - 30]], { type: "MultiPoint", coordinates: pts });
  proj.clipExtent([[0, 0], [W, H]]);
  const path = d3.geoPath(proj);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gCountries = sel.append("g").attr("class", "gr-countries");
  const gCountryNames = sel.append("g").attr("class", "gr-cnames");
  const gRings = sel.append("g").attr("class", "gr-rings");
  const gLu = sel.append("g");
  const gPts = sel.append("g");
  const gRingLabels = sel.append("g").attr("class", "gr-rings gr-ring-labels"); // above the polygons
  const gHub = sel.append("g").attr("class", "gr-hub").attr("opacity", 0);
  const gNames = sel.append("g").attr("class", "gr-names");

  // LU polygons drawn from flat projected vertex arrays, so km and minutes shapes interpolate vertex by vertex.
  const feats = carte.features.map((f, i) => {
    const { lens, pts: ll } = flattenRings(f.geometry);
    const base = new Float64Array(ll.length * 2);
    ll.forEach((p, j) => { const [x, y] = proj(p); base[2 * j] = x; base[2 * j + 1] = y; });
    return { f, i, lau: f.properties.lau, lens, ll, base, cur: Float64Array.from(base) };
  });
  const byLau = new Map(places.filter((p) => p.lau).map((p) => [p.lau, p]));
  const lu = gLu.selectAll("path").data(feats).join("path")
    .attr("class", "gr-lu")
    .attr("d", (d) => ringsPath(d.lens, d.cur))
    .attr("data-id", (d) => `lu:${d.lau}`)
    .on("click", (_e, d) => onSelect(`lu:${d.lau}`));
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

  gHub.append("rect").attr("class", "gr-hub-mk").attr("x", -7).attr("y", -7).attr("width", 14).attr("height", 14)
    .attr("transform", "rotate(45)");
  const hubLabel = gHub.append("text").attr("class", "gr-hub-name").attr("y", -14).attr("text-anchor", "middle");

  // ---- layouts: km (geographic) and minutes per (hub, mode), cached
  const kmPx = Math.hypot(...[0, 1].map((k) => proj([6.13, 49.6])[k] - proj([6.13, 49.609])[k]));
  const kmLayout = {
    mode: "km",
    xy: feats.map((d) => d.base),
    pos: new Map(places.filter((p) => Number.isFinite(p.lat)).map((p) => [p.id, proj([p.lon, p.lat])])),
    noTime: new Set(),
    minutes: new Map(),
  };
  const cache = new Map();
  const minutesOf = (p, hub, mode) => {
    const v = p.commute?.[hub]?.[mode];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  // One px-per-minute scale per hub, shared by car and public transport so the rings stay put: the car median
  // (the median place keeps its geographic radius), reduced if needed so that every timed place of both modes
  // fits in the frame (a hub near the edge, e.g. Belval, would otherwise push places out of the map).
  const scales = new Map();
  function hubScale(hub, located, control) {
    if (scales.has(hub)) return scales.get(hub);
    const centre = HUB_COORDS[hub] || HUB_COORDS[DEFAULT_HUB];
    const car = makeWarp({ centre, project: proj, controls: control("driving"), minRadius: WARP.minKm * kmPx, angles: 4, rMax: 4 });
    const [cx, cy] = car.centre, m = 24;
    let fit = 1;
    for (const mode of ["driving", "transit"]) {
      for (const p of located) {
        const min = minutesOf(p, hub, mode);
        if (min === null) continue;
        const [x, y] = car.place([p.lon, p.lat], min);
        const dx = x - cx, dy = y - cy;
        if (dx > 0) fit = Math.min(fit, (W - m - cx) / dx); else if (dx < 0) fit = Math.min(fit, (cx - m) / -dx);
        if (dy > 0) fit = Math.min(fit, (H - m - cy) / dy); else if (dy < 0) fit = Math.min(fit, (cy - m) / -dy);
      }
    }
    const sc = car.scale * Math.max(0.3, fit);
    scales.set(hub, sc);
    return sc;
  }
  function layout(hub, mode) {
    if (mode === "km") return kmLayout;
    const key = `${hub}|${mode}`;
    if (cache.has(key)) return cache.get(key);
    const t0 = performance.now();
    const centre = HUB_COORDS[hub] || HUB_COORDS[DEFAULT_HUB];
    const located = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const control = (m) => located.map((p) => ({ lon: p.lon, lat: p.lat, minutes: minutesOf(p, hub, m) }));
    const [hx, hy] = proj(centre);
    let rMax = 0;
    for (const d of feats) for (let j = 0; j < d.base.length; j += 2) rMax = Math.max(rMax, Math.hypot(d.base[j] - hx, d.base[j + 1] - hy));
    const opts = { centre, project: proj, k: WARP.k, power: WARP.power, minRadius: WARP.minKm * kmPx, smooth: WARP.smooth,
      angles: WARP.angles, step: WARP.step, rMax: rMax + 10 };
    const warp = makeWarp({ ...opts, controls: control(mode), scale: hubScale(hub, located, control) });
    const xy = feats.map((d) => {
      const out = new Float64Array(d.base.length);
      for (let j = 0; j < d.base.length; j += 2) { const [x, y] = warp.xy(d.base[j], d.base[j + 1]); out[j] = x; out[j + 1] = y; }
      return out;
    });
    const pos = new Map(), noTime = new Set(), minutes = new Map();
    for (const p of located) {
      const m = minutesOf(p, hub, mode);
      minutes.set(p.id, m);
      if (m === null) noTime.add(p.id);
      // LU communes: label on their warped centroid (moves with the polygon); cross-border towns: exactly on their
      // time ring; places without a time stay at their geographic position.
      pos.set(p.id, m === null ? proj([p.lon, p.lat]) : p.country === "LU" ? warp([p.lon, p.lat]) : warp.place([p.lon, p.lat], m));
    }
    const L = { mode, hub, xy, pos, noTime, minutes, scale: warp.scale, centre: warp.centre, rings: ringRadii(warp.scale, RING_MINUTES) };
    L.ms = performance.now() - t0;
    svg.dataset.warpMs = L.ms.toFixed(1);
    svg.dataset.warpMaxMs = Math.max(Number(svg.dataset.warpMaxMs || 0), L.ms).toFixed(1);
    cache.set(key, L);
    return L;
  }

  let mode = "km";
  let lastMinMode = "driving";
  let current = kmLayout;
  const hubNow = () => getHub() || DEFAULT_HUB;
  const posOf = (p) => current.pos.get(p.id) || proj([p.lon, p.lat]);

  const all = new Map(places.map((p) => [p.id, p]));
  let names = [];
  function drawNames() {
    const lang = getLang();
    // Greedy placement: above the mark, else right, else left; a label that still collides is dropped.
    const boxes = [];
    const items = [];
    for (const p of names.map((id) => all.get(id)).filter(Boolean)) {
      const text = placeName(p, lang);
      const [x, y] = posOf(p);
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

  // ---- mode switch (inside the map container, after the svg; CSS puts it on top)
  const bar = h("div", "gr-modes");
  const segKind = h("div", "seg gr-seg");
  segKind.setAttribute("role", "group");
  const bKm = h("button");
  const bMin = h("button");
  const segMode = h("div", "seg gr-seg gr-seg-mode");
  segMode.setAttribute("role", "group");
  const bCar = h("button");
  const bTc = h("button");
  for (const b of [bKm, bMin, bCar, bTc]) b.type = "button";
  bKm.dataset.mode = "km"; bMin.dataset.mode = "minutes"; bCar.dataset.mode = "driving"; bTc.dataset.mode = "transit";
  bKm.onclick = () => userMode("km");
  bMin.onclick = () => userMode(lastMinMode);
  bCar.onclick = () => userMode("driving");
  bTc.onclick = () => userMode("transit");
  segKind.append(bKm, bMin);
  segMode.append(bCar, bTc);
  const note = h("p", "gr-modes-note");
  bar.append(segKind, segMode, note);
  svg.after(bar);

  function drawBar() {
    bKm.textContent = t("gr.km");
    bMin.textContent = t("gr.min");
    bCar.textContent = t("gr.car");
    bTc.textContent = t("gr.transit");
    segKind.setAttribute("aria-label", t("gr.kind"));
    segMode.setAttribute("aria-label", t("gr.mode"));
    bKm.setAttribute("aria-pressed", String(mode === "km"));
    bMin.setAttribute("aria-pressed", String(mode !== "km"));
    bCar.setAttribute("aria-pressed", String(mode === "driving"));
    bTc.setAttribute("aria-pressed", String(mode === "transit"));
    segMode.hidden = mode === "km";
    note.hidden = mode === "km";
    if (mode !== "km") {
      const sw = h("i", "gr-sw gr-sw-notime");
      sw.setAttribute("aria-hidden", "true");
      const ring = h("i", "gr-sw gr-sw-ring");
      ring.setAttribute("aria-hidden", "true");
      note.replaceChildren(
        document.createTextNode(t(mode === "driving" ? "gr.note.car" : "gr.note.transit", { hub: t(`hub.${hubNow()}`) })),
        h("span", "gr-key", null), h("span", "gr-key", null),
      );
      note.children[0].append(ring, document.createTextNode(t("gr.rings")));
      note.children[1].append(sw, document.createTextNode(t("gr.notime")));
    }
  }

  function setTitles(lang = getLang()) {
    const suffix = (id) => {
      const m = current.minutes.get(id);
      if (current.mode === "km") return "";
      return m === null || m === undefined ? ` — ${t("gr.notime")}` : ` — ${m} min`;
    };
    luTitles.text((d) => { const p = byLau.get(d.lau); return (p ? placeName(p, lang) : d.f.properties.name) + (p ? suffix(p.id) : ""); });
    ptTitles.text((p) => p.name + suffix(p.id));
  }

  let namesTimer = null;
  function apply(L, animate) {
    current = L;
    const dur = animate && !reduceMotion() ? MORPH_MS : 0;
    const isMin = L.mode !== "km";
    sel.classed("is-min", isMin);
    lu.attr("data-nt", (d) => (isMin && L.noTime.has(`lu:${d.lau}`) ? "" : null));
    groups.attr("data-nt", (p) => (isMin && L.noTime.has(p.id) ? "" : null));
    if (dur) {
      lu.transition("morph").duration(dur).ease(d3.easeCubicInOut).attrTween("d", (d) => {
        const from = Float64Array.from(d.cur), to = L.xy[d.i];
        return (k) => ringsPath(d.lens, lerpCoords(from, to, k, d.cur));
      });
      groups.transition("morph").duration(dur).ease(d3.easeCubicInOut).attr("transform", (p) => `translate(${posOf(p)})`);
    } else {
      lu.interrupt("morph").each((d) => d.cur.set(L.xy[d.i])).attr("d", (d) => ringsPath(d.lens, d.cur));
      groups.interrupt("morph").attr("transform", (p) => `translate(${posOf(p)})`);
    }
    // reference rings and hub marker
    const centre = isMin ? L.centre : proj(HUB_COORDS[hubNow()] || HUB_COORDS[DEFAULT_HUB]);
    const rings = isMin ? L.rings : (cache.get(`${hubNow()}|driving`)?.rings || ringRadii(1));
    const rc = gRings.selectAll("circle").data(rings, (d) => d.minutes).join("circle").attr("class", "gr-ring");
    const rt = gRingLabels.selectAll("text").data(rings, (d) => d.minutes).join("text").attr("class", "gr-ring-label")
      .text((d) => `${d.minutes} min`);
    // labels up and to the right (few places there, steep enough for consecutive labels not to overlap);
    // rings too small to hold a label next to the hub name stay unlabelled
    const lx = (d) => d.r * Math.cos(-1.05) + 4, ly = (d) => d.r * Math.sin(-1.05) - 2;
    rt.attr("display", (d) => (d.r < 32 ? "none" : null));
    const ringT = (s) => (dur ? s.transition("morph").duration(dur).ease(d3.easeCubicInOut) : s.interrupt("morph"));
    for (const g of [gRings, gRingLabels]) ringT(g).attr("opacity", isMin ? 1 : 0).attr("transform", `translate(${centre})`);
    ringT(rc).attr("r", (d) => d.r);
    ringT(rt).attr("x", lx).attr("y", ly);
    hubLabel.text(t(`hub.${hubNow()}`));
    ringT(gHub).attr("opacity", isMin ? 1 : 0).attr("transform", `translate(${centre})`);
    setTitles();
    drawBar();
    // labels jump to the new layout once the morph is done
    clearTimeout(namesTimer);
    if (dur) {
      gNames.interrupt().transition().duration(150).attr("opacity", 0);
      namesTimer = setTimeout(() => { drawNames(); gNames.transition().duration(300).attr("opacity", 1); }, dur);
    } else {
      gNames.interrupt().attr("opacity", 1);
      drawNames();
    }
  }

  function setMode(m, { animate = true } = {}) {
    if (!MODES.includes(m)) return;
    mode = m;
    if (m !== "km") lastMinMode = m;
    apply(layout(hubNow(), m), animate);
  }
  function userMode(m) {
    onUserMode(m);
    setMode(m);
  }
  let attractI = 0;
  // Kiosk attract mode: km -> minutes by car -> minutes by public transport -> km ...
  function attractStep() {
    setMode(MODES[attractI % MODES.length]);
    attractI += 1;
  }

  function relabel(lang = getLang()) {
    setTitles(lang);
    gCountryNames.selectAll("text").text((d) => t(`country.${d[0]}`).toUpperCase());
    hubLabel.text(t(`hub.${hubNow()}`));
    drawBar();
    drawNames();
  }

  // status: Map id -> "top" | "ranked" | "nodata" | "out"; labels: ids to name on the map.
  function update({ status, labels = [] }) {
    lu.attr("data-st", (d) => status.get(`lu:${d.lau}`) || "nodata");
    groups.attr("data-st", (p) => status.get(p.id) || "nodata");
    names = labels;
    // the work hub changed while the map is in minutes: morph to the new centre
    if (mode !== "km" && (current.hub !== hubNow())) apply(layout(hubNow(), mode), true);
    else drawNames();
  }
  function select(id) {
    lu.attr("data-sel", (d) => (`lu:${d.lau}` === id ? "" : null));
    groups.attr("data-sel", (p) => (p.id === id ? "" : null));
    if (id) groups.filter((p) => p.id === id).raise();
  }
  // Attract mode: light up a few places (ids), fade the rest.
  function highlight(groupsArg = {}) {
    const ids = new Set(groupsArg.focus || []);
    sel.classed("has-hl", ids.size > 0);
    lu.attr("data-hl", (d) => (ids.has(`lu:${d.lau}`) ? "focus" : null));
    groups.attr("data-hl", (p) => (ids.has(p.id) ? "focus" : null));
  }

  // Assistant answer: light up LU communes (LAU "0304" or "lu:0304") and cross-border places (ids), fade the rest.
  function highlightPlaces(ids = []) {
    const set = new Set(ids.map((x) => (/^\d{4}$/.test(x) ? `lu:${x}` : x)));
    sel.classed("has-hl", set.size > 0);
    lu.attr("data-hl", (d) => (set.has(`lu:${d.lau}`) ? "answer" : null));
    groups.attr("data-hl", (p) => (set.has(p.id) ? "answer" : null));
    if (set.size) groups.filter((p) => set.has(p.id)).raise();
  }

  async function loadCountries() {
    try {
      if (typeof topojson === "undefined") return;
      const r2 = await fetch(WORLD_URL);
      if (!r2.ok) return;
      const world = await r2.json();
      const fs = topojson.feature(world, world.objects.countries).features.filter((f) => NEIGHBOURS.has(String(f.id)));
      gCountries.selectAll("path").data(fs).join("path").attr("class", "gr-country").attr("d", path);
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
  return {
    update, select, highlight, highlightPlaces, clear: () => highlight({}), relabel, setMode, attractStep,
    mode: () => mode, resetAttract: () => { attractI = 0; },
  };
}
