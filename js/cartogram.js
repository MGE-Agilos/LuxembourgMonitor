// Time-distance cartogram (plan B2, spec section 6) — pure functions, no DOM, tested by cartogram.test.js.
//
// Every point keeps its azimuth from the centre (the work hub); its distance to the centre becomes "minutes".
// Method:
//  1. each control place with a time gets a radial factor f = (minutes × scale) / geographic radius (px), where
//     scale (px per minute) is the median of radius / minutes, so the median place keeps its geographic radius;
//  2. f is interpolated anywhere by inverse-distance weighting (power 2) over the k nearest controls, and faded
//     back to 1 (no move) away from every control;
//  3. to keep the map readable the field is sampled on a polar grid around the centre, smoothed across azimuths
//     and made strictly increasing along each ray (displaced radius g(θ, r) = f·r): two vertices on one ray never
//     swap order, so polygons cannot fold over each other. Any point is then warped by bilinear lookup.

export const RING_MINUTES = [15, 30, 45, 60, 90];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {object} o
 * @param {[number, number]} o.centre       [lon, lat] of the hub
 * @param {{lon:number, lat:number, minutes:number|null}[]} o.controls
 * @param {(lonlat:[number,number]) => [number,number]} o.project
 * @param {number} [o.k=6]            nearest controls used by the interpolation
 * @param {number} [o.power=2]        inverse-distance power
 * @param {number} [o.scale]          px per minute (default: median radius/minutes of the controls)
 * @param {number} [o.minRadius=0]    controls closer than this (px) to the centre are ignored (ratio unstable)
 * @param {number} [o.reach]          px: beyond the nearest control + reach, points no longer move
 * @param {number} [o.fMin=0.25]      clamp of the radial factor
 * @param {number} [o.fMax=4]
 * @param {number} [o.angles=180]     polar grid: azimuth samples
 * @param {number} [o.step=2]         polar grid: radial step (px)
 * @param {number} [o.rMax]           polar grid: outer radius (px)
 * @param {number} [o.smooth=2]       passes of a [1 2 1] filter across azimuths
 * @param {number} [o.minSlope=0.15]  minimum d(g)/dr along a ray
 */
export function makeWarp({
  centre, controls, project, k = 6, power = 2, scale, minRadius = 0, reach, fMin = 0.25, fMax = 4,
  angles = 180, step = 2, rMax, smooth = 2, minSlope = 0.15,
}) {
  const [cx, cy] = project(centre);
  const ctrl = [];
  for (const c of controls) {
    if (typeof c.minutes !== "number" || !Number.isFinite(c.minutes) || c.minutes <= 0) continue;
    const [x, y] = project([c.lon, c.lat]);
    const r = Math.hypot(x - cx, y - cy);
    if (!(r > minRadius) || r === 0) continue;
    ctrl.push({ x, y, r, minutes: c.minutes });
  }
  const sc = scale ?? (ctrl.length ? median(ctrl.map((c) => c.r / c.minutes)) : 1);
  for (const c of ctrl) c.f = Math.min(fMax, Math.max(fMin, (c.minutes * sc) / c.r));
  const maxR = ctrl.reduce((m, c) => Math.max(m, c.r), 0);
  const R = rMax ?? Math.max(1, maxR * 1.5);
  const rch = reach ?? Math.max(1, maxR * 0.25);
  const kk = Math.min(k, ctrl.length);

  // Interpolated radial factor at a screen point (px).
  const best = new Float64Array(kk);
  const bestF = new Float64Array(kk);
  const N = ctrl.length;
  const CX = Float64Array.from(ctrl, (c) => c.x), CY = Float64Array.from(ctrl, (c) => c.y), CF = Float64Array.from(ctrl, (c) => c.f);
  function factor(x, y) {
    if (!kk) return 1;
    let n = 0;
    for (let c = 0; c < N; c += 1) {
      const ex = CX[c] - x, ey = CY[c] - y;
      const d = ex * ex + ey * ey;
      let i;
      if (n < kk) i = n++;
      else if (d < best[kk - 1]) i = kk - 1;
      else continue;
      while (i > 0 && best[i - 1] > d) { best[i] = best[i - 1]; bestF[i] = bestF[i - 1]; i -= 1; }
      best[i] = d; bestF[i] = CF[c];
    }
    if (best[0] === 0) return bestF[0];
    let sw = 0, sf = 0;
    for (let i = 0; i < kk; i += 1) {
      const w = power === 2 ? 1 / best[i] : 1 / best[i] ** (power / 2);
      sw += w; sf += w * bestF[i];
    }
    const f = sf / sw;
    const dn = Math.sqrt(best[0]);
    const fade = dn <= rch ? 1 : Math.max(0, 1 - (dn - rch) / rch);
    return 1 + (f - 1) * fade;
  }

  // Polar grid of displaced radii g[a][j] at radius j·step.
  const J = Math.ceil(R / step);
  const cols = J + 1;
  let fGrid = new Float64Array(angles * cols);
  for (let a = 0; a < angles; a += 1) {
    const th = (2 * Math.PI * a) / angles;
    const ux = Math.cos(th), uy = Math.sin(th);
    for (let j = 1; j <= J; j += 1) fGrid[a * cols + j] = factor(cx + ux * j * step, cy + uy * j * step);
    fGrid[a * cols] = fGrid[a * cols + 1];
  }
  for (let s = 0; s < smooth; s += 1) {
    const next = new Float64Array(fGrid.length);
    for (let a = 0; a < angles; a += 1) {
      const p = ((a - 1 + angles) % angles) * cols, q = ((a + 1) % angles) * cols, o = a * cols;
      for (let j = 0; j <= J; j += 1) next[o + j] = (fGrid[p + j] + 2 * fGrid[o + j] + fGrid[q + j]) / 4;
    }
    fGrid = next;
  }
  const g = new Float64Array(angles * cols);
  for (let a = 0; a < angles; a += 1) {
    const o = a * cols;
    g[o] = 0;
    for (let j = 1; j <= J; j += 1) g[o + j] = Math.max(fGrid[o + j] * j * step, g[o + j - 1] + minSlope * step);
  }

  function radiusAt(th, r) {
    let ta = (th / (2 * Math.PI)) * angles;
    ta = ((ta % angles) + angles) % angles;
    const a0 = Math.floor(ta) % angles, a1 = (a0 + 1) % angles, wa = ta - Math.floor(ta);
    if (r >= R) {
      const e = (1 - wa) * g[a0 * cols + J] + wa * g[a1 * cols + J];
      return e + (r - J * step);
    }
    const tj = r / step, j0 = Math.floor(tj), wj = tj - j0, j1 = Math.min(J, j0 + 1);
    const v0 = (1 - wj) * g[a0 * cols + j0] + wj * g[a0 * cols + j1];
    const v1 = (1 - wj) * g[a1 * cols + j0] + wj * g[a1 * cols + j1];
    return (1 - wa) * v0 + wa * v1;
  }

  // Screen point -> displaced screen point.
  function warpXY(x, y) {
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (r === 0) return [cx, cy];
    const gr = radiusAt(Math.atan2(dy, dx), r);
    return [cx + (dx / r) * gr, cy + (dy / r) * gr];
  }
  const warp = (lonlat) => { const [x, y] = project(lonlat); return warpXY(x, y); };
  warp.xy = warpXY;
  warp.centre = [cx, cy];
  warp.scale = sc;
  warp.controls = ctrl.length;
  // Exact position of a place with a known time (same azimuth, radius = minutes × scale); geographic otherwise.
  warp.place = (lonlat, minutes) => {
    const [x, y] = project(lonlat);
    if (typeof minutes !== "number" || !Number.isFinite(minutes)) return [x, y];
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r === 0) return [cx, cy];
    return [cx + (dx / r) * minutes * sc, cy + (dy / r) * minutes * sc];
  };
  return warp;
}

// Same geometry with every [lon, lat] replaced by its warped [x, y] (any GeoJSON geometry type).
export function warpGeometry(geometry, warp) {
  const walk = (c) => (typeof c[0] === "number" ? warp(c) : c.map(walk));
  if (geometry.type === "GeometryCollection") {
    return { type: geometry.type, geometries: geometry.geometries.map((g) => warpGeometry(g, warp)) };
  }
  return { type: geometry.type, coordinates: walk(geometry.coordinates) };
}

// Ring radii (px) of the reference circles.
export function ringRadii(scale, minutes = RING_MINUTES) {
  return minutes.map((m) => ({ minutes: m, r: m * scale }));
}

// Polygon/MultiPolygon -> ring lengths + flat list of [lon, lat] (for per-vertex interpolation).
export function flattenRings(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  const lens = [], pts = [];
  for (const poly of polys) for (const ring of poly) { lens.push(ring.length); for (const p of ring) pts.push(p); }
  return { lens, pts };
}

// SVG path of rings given flat x,y coordinates.
export function ringsPath(lens, xy) {
  let s = "", i = 0;
  for (const n of lens) {
    for (let v = 0; v < n; v += 1, i += 2) s += `${v ? "L" : "M"}${xy[i].toFixed(1)},${xy[i + 1].toFixed(1)}`;
    s += "Z";
  }
  return s;
}

// Linear blend of two flat coordinate arrays of equal length.
export function lerpCoords(a, b, t, out = new Float64Array(a.length)) {
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
