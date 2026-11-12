import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenRings, lerpCoords, makeWarp, ringRadii, ringsPath, warpGeometry } from "./cartogram.js";

// Flat test projection: 10 px per degree, y down.
const project = ([lon, lat]) => [lon * 10, -lat * 10];
const centre = [0, 0];
// Eight controls on a circle of radius 10 px (1 degree), all at 20 minutes.
const ring = (minutes = 20, extra = []) => [
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return { lon: Math.cos(a), lat: Math.sin(a), minutes };
  }),
  ...extra,
];
const dist = ([x, y], [a, b]) => Math.hypot(x - a, y - b);
const azimuth = ([x, y], [cx, cy]) => Math.atan2(y - cy, x - cx);

test("the centre stays put", () => {
  const w = makeWarp({ centre, controls: ring(), project });
  const c = w(centre);
  assert.ok(dist(c, project(centre)) < 1e-9);
  assert.deepEqual(w.centre, project(centre));
});

test("uniform times keep geographic radii (median scale)", () => {
  const w = makeWarp({ centre, controls: ring(), project });
  assert.ok(Math.abs(w.scale - 0.5) < 1e-9); // 10 px / 20 min
  const p = w([0.5, 0.5]);
  assert.ok(Math.abs(dist(p, w.centre) - dist(project([0.5, 0.5]), w.centre)) < 0.5);
});

test("a control with double the ratio is pushed out, its azimuth preserved", () => {
  // one far-slower place among three controls at the same radius in the other directions
  const controls = [
    { lon: 1, lat: 0, minutes: 20 }, { lon: -1, lat: 0, minutes: 20 },
    { lon: 0, lat: -1, minutes: 20 }, { lon: 0, lat: 1, minutes: 40 },
  ];
  const w = makeWarp({ centre, controls, project, smooth: 0 });
  const slow = w([0, 1]);
  const fast = w([1, 0]);
  assert.ok(dist(slow, w.centre) > dist(fast, w.centre) * 1.5, `${dist(slow, w.centre)} vs ${dist(fast, w.centre)}`);
  assert.ok(Math.abs(azimuth(slow, w.centre) - azimuth(project([0, 1]), w.centre)) < 1e-6);
  // exact placement: 40 min × scale
  assert.ok(Math.abs(dist(w.place([0, 1], 40), w.centre) - 40 * w.scale) < 1e-9);
});

test("azimuth is preserved for any point", () => {
  const w = makeWarp({ centre, controls: ring(20, [{ lon: 0.3, lat: 0.6, minutes: 50 }]), project });
  for (const p of [[0.2, 0.7], [-0.9, 0.1], [0.4, -0.4], [3, 2]]) {
    const q = w(p);
    assert.ok(Math.abs(azimuth(q, w.centre) - azimuth(project(p), w.centre)) < 1e-6, String(p));
  }
});

test("null-minute controls are ignored", () => {
  const a = makeWarp({ centre, controls: ring(), project });
  const b = makeWarp({ centre, controls: ring(20, [{ lon: 0.5, lat: 0.5, minutes: null }, { lon: 0.2, lat: 0.1 }]), project });
  assert.equal(b.controls, a.controls);
  assert.deepEqual(b([0.3, 0.4]), a([0.3, 0.4]));
  // a place without a time keeps its geographic position
  assert.deepEqual(b.place([0.5, 0.5], null), project([0.5, 0.5]));
});

test("points far from every control keep their geographic position", () => {
  const w = makeWarp({ centre, controls: ring(40), project, scale: 0.5, reach: 2, rMax: 200 });
  const far = [8, 0]; // 80 px away, controls at 10 px
  const q = w(far);
  // pushed out by the inner (slower) area, but not scaled by the inner factor (×2)
  assert.ok(dist(q, w.centre) < 80 * 1.5);
});

test("radii stay increasing along a ray (no folding)", () => {
  const controls = [{ lon: 1, lat: 0, minutes: 60 }, { lon: 2, lat: 0, minutes: 10 }, { lon: 3, lat: 0, minutes: 30 }];
  const w = makeWarp({ centre, controls, project });
  let prev = 0;
  for (let x = 0.1; x < 4; x += 0.1) {
    const r = dist(w([x, 0]), w.centre);
    assert.ok(r > prev, `x=${x}`);
    prev = r;
  }
});

test("warpGeometry keeps the vertex count; helpers", () => {
  const w = makeWarp({ centre, controls: ring(), project });
  const geom = { type: "MultiPolygon", coordinates: [[[[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.1]]]] };
  const out = warpGeometry(geom, w);
  assert.equal(out.coordinates[0][0].length, 4);
  assert.equal(out.coordinates[0][0][0].length, 2);
  const { lens, pts } = flattenRings(geom);
  assert.deepEqual(lens, [4]);
  assert.equal(pts.length, 4);
  assert.equal(ringsPath([2], [0, 0, 1, 2]), "M0.0,0.0L1.0,2.0Z");
  assert.deepEqual([...lerpCoords([0, 10], [10, 20], 0.5)], [5, 15]);
  assert.deepEqual(ringRadii(2, [15, 30]), [{ minutes: 15, r: 30 }, { minutes: 30, r: 60 }]);
});
