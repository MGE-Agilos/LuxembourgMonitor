/* global d3 */
// Sober charts for the B3 pages (BDG palette via CSS variables, so light and dark themes both work).
// Bars are HTML (responsive, direct labels, no layout maths); lines are d3 SVG with a hover/tap crosshair.
import { h } from "./dom.js";
import { t } from "./i18n.js";

const widthOf = (el) => Math.max(240, Math.floor(el.getBoundingClientRect().width || 320));

// Tiny population line: no axis, first and last values written underneath.
export function sparkline(el, pts, { fmtV, label }) {
  const w = widthOf(el), hgt = 40, m = 4;
  const x = d3.scaleLinear().domain(d3.extent(pts, (d) => d[0])).range([m, w - m]);
  const y = d3.scaleLinear().domain([0, d3.max(pts, (d) => d[1])]).nice().range([hgt - m, m]);
  const svg = d3.select(el).append("svg").attr("class", "ch-spark").attr("viewBox", `0 0 ${w} ${hgt}`)
    .attr("role", "img").attr("aria-label", label);
  svg.append("path").attr("class", "ch-area").attr("d", d3.area().x((d) => x(d[0])).y0(hgt - m).y1((d) => y(d[1]))(pts));
  svg.append("path").attr("class", "ch-line").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(pts));
  const last = pts[pts.length - 1];
  svg.append("circle").attr("class", "ch-dot").attr("r", 3.5).attr("cx", x(last[0])).attr("cy", y(last[1]));
  const ends = h("div", "ch-ends");
  ends.append(h("span", null, `${pts[0][0]} · ${fmtV(pts[0][1])}`), h("span", null, `${last[0]} · ${fmtV(last[1])}`));
  el.append(ends);
}

// Line over years with a few y ticks and a crosshair tooltip (pointer and touch).
export function lineChart(el, pts, { fmtV, fmtTick = fmtV, label, zero = false }) {
  const w = widthOf(el), hgt = 170, ml = 52, mr = 14, mt = 12, mb = 24;
  const x = d3.scaleLinear().domain(d3.extent(pts, (d) => d[0])).range([ml, w - mr]);
  const lo = d3.min(pts, (d) => d[1]), hi = d3.max(pts, (d) => d[1]);
  const y = d3.scaleLinear().domain(zero ? [0, hi] : [lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.05]).nice(4).range([hgt - mb, mt]);
  const wrap = h("div", "ch-wrap");
  el.append(wrap);
  const svg = d3.select(wrap).append("svg").attr("class", "ch-lineplot").attr("viewBox", `0 0 ${w} ${hgt}`)
    .attr("role", "img").attr("aria-label", label);
  const gy = svg.append("g").attr("class", "ch-grid");
  for (const v of y.ticks(4)) {
    gy.append("line").attr("x1", ml).attr("x2", w - mr).attr("y1", y(v)).attr("y2", y(v));
    gy.append("text").attr("x", ml - 6).attr("y", y(v) + 4).attr("text-anchor", "end").text(fmtTick(v));
  }
  const years = pts.map((d) => d[0]);
  const xt = [years[0], years[years.length - 1]];
  if (years.length > 6) xt.splice(1, 0, years[Math.floor(years.length / 2)]);
  const gx = svg.append("g").attr("class", "ch-axis");
  for (const v of xt) gx.append("text").attr("x", x(v)).attr("y", hgt - 6)
    .attr("text-anchor", v === xt[0] ? "start" : v === xt[xt.length - 1] ? "end" : "middle").text(String(v));
  svg.append("path").attr("class", "ch-line").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(pts));
  const last = pts[pts.length - 1];
  svg.append("circle").attr("class", "ch-dot").attr("r", 4).attr("cx", x(last[0])).attr("cy", y(last[1]));
  // hover layer
  const cross = svg.append("line").attr("class", "ch-cross").attr("y1", mt).attr("y2", hgt - mb).style("opacity", 0);
  const hot = svg.append("circle").attr("class", "ch-dot ch-hot").attr("r", 5).style("opacity", 0);
  const tip = h("div", "ch-tip");
  tip.hidden = true;
  wrap.append(tip);
  const show = (ev) => {
    const [px] = d3.pointer(ev, svg.node()); // viewBox units
    const yr = x.invert(px);
    const d = pts.reduce((a, b) => (Math.abs(b[0] - yr) < Math.abs(a[0] - yr) ? b : a));
    cross.attr("x1", x(d[0])).attr("x2", x(d[0])).style("opacity", 1);
    hot.attr("cx", x(d[0])).attr("cy", y(d[1])).style("opacity", 1);
    tip.textContent = `${d[0]} · ${fmtV(d[1])}`;
    tip.hidden = false;
    const ratio = svg.node().getBoundingClientRect().width / w;
    tip.style.left = `${Math.min(Math.max(x(d[0]) * ratio, 50), wrap.clientWidth - 50)}px`;
    tip.style.top = `${y(d[1]) * ratio - 34}px`;
  };
  const hide = () => { cross.style("opacity", 0); hot.style("opacity", 0); tip.hidden = true; };
  svg.append("rect").attr("class", "ch-hit").attr("x", ml).attr("y", 0).attr("width", w - ml - mr).attr("height", hgt)
    .on("pointermove", show).on("pointerdown", show).on("pointerleave", hide);
}

// Horizontal bars: rows = [{ label, v, display, emph, color }]; null v -> "not published". Optional target marker.
export function hbars(el, rows, { max, target, targetLabel } = {}) {
  const top = max ?? (Math.max(...rows.map((r) => r.v ?? 0), target ?? 0) || 1);
  const box = h("div", "ch-bars");
  for (const r of rows) {
    const row = h("div", `ch-row${r.emph ? " is-emph" : ""}`);
    row.append(h("span", "ch-label", r.label));
    const track = h("div", "ch-track");
    if (r.v === null || r.v === undefined) {
      row.append(h("span", "ch-val np", t("np")));
    } else {
      const bar = h("i", "ch-bar");
      bar.style.width = `${Math.max(0.5, (Math.max(r.v, 0) / top) * 100)}%`;
      if (r.color) bar.style.background = r.color;
      bar.title = `${r.label}: ${r.display}`;
      track.append(bar);
      row.append(h("span", "ch-val", r.display));
    }
    if (target !== undefined) {
      const tk = h("b", "ch-target");
      tk.style.left = `${(target / top) * 100}%`;
      tk.setAttribute("aria-hidden", "true");
      track.append(tk);
    }
    row.append(track);
    box.append(row);
  }
  if (target !== undefined && targetLabel) {
    const lg = h("p", "ch-legend");
    const k = h("span", "ch-key");
    k.append(h("i", "ch-sw ch-sw-target"), document.createTextNode(targetLabel));
    lg.append(k);
    box.append(lg);
  }
  el.append(box);
}

// Grouped bars: groups = [{ label, values: { key: { v, display } } }], keys = [{ key, label, color }]. Legend on top.
export function groupBars(el, groups, keys, { max } = {}) {
  const top = max ?? Math.max(1, ...groups.flatMap((g) => keys.map((k) => g.values[k.key]?.v ?? 0)));
  el.append(legend(keys));
  const box = h("div", "ch-bars ch-groups");
  for (const g of groups) {
    const grp = h("div", "ch-group");
    grp.append(h("span", "ch-label", g.label));
    for (const k of keys) {
      const val = g.values[k.key];
      const line = h("div", "ch-kline");
      const track = h("div", "ch-track");
      line.append(track);
      if (!val || val.v === null || val.v === undefined) line.append(h("span", "ch-val np", `${k.label} : ${t("np")}`));
      else {
        const bar = h("i", "ch-bar");
        bar.style.width = `${Math.max(0.5, (val.v / top) * 100)}%`;
        bar.style.background = k.color;
        bar.title = `${g.label} · ${k.label}: ${val.display}`;
        track.append(bar);
        line.append(h("span", "ch-val", val.display));
      }
      grp.append(line);
    }
    box.append(grp);
  }
  el.append(box);
}

export function legend(keys) {
  const lg = h("p", "ch-legend");
  for (const k of keys) {
    const it = h("span", "ch-key");
    const sw = h("i", "ch-sw");
    sw.style.background = k.color;
    it.append(sw, document.createTextNode(k.label));
    lg.append(it);
  }
  return lg;
}

// One 100% stacked bar with a legend table (label, amount, share). parts = [{ label, v, display, color }].
export function stackBar(el, parts, { share }) {
  const total = parts.reduce((s, p) => s + Math.max(p.v || 0, 0), 0) || 1;
  const bar = h("div", "ch-stack");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", parts.map((p) => `${p.label} ${p.display}`).join(", "));
  for (const p of parts) {
    if (!(p.v > 0)) continue;
    const seg = h("i", "ch-seg");
    seg.style.flexGrow = String(p.v);
    seg.style.background = p.color;
    seg.title = `${p.label}: ${p.display} (${share(p.v / total)})`;
    bar.append(seg);
  }
  const tbl = h("ul", "ch-stack-legend");
  for (const p of parts) {
    const li = h("li");
    const sw = h("i", "ch-sw");
    sw.style.background = p.color;
    li.append(sw, h("span", "ch-sl", p.label), h("span", "ch-sv", p.display), h("span", "ch-sp", share((p.v || 0) / total)));
    tbl.append(li);
  }
  el.append(bar, tbl);
}

export const CAT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--c${i})`);
