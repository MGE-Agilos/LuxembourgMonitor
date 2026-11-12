import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { comparisons, computePlaces, hoursPerMonth, rank } from "./ouvivre.js";

const fixture = {
  reference: { net_monthly_lu: 4000 },
  assumptions: { commute_days_per_year: 220, commute_cost_per_km_eur: null },
  places: [
    { id: "lu:0304", lau: "0304", country: "LU", name: "Luxembourg", residents_employed: 50000, rent_m2: 50, sale_price_m2: 10000,
      commute: { kirchberg: { driving: 12, driving_km: 4, transit: 24, transit_p80: 26 } } },
    { id: "fr:1", country: "FR", name: "Thionville", lu_workers: 10000, rent_m2: 16,
      commute: { kirchberg: { driving: 39, driving_km: 39, transit: 85, transit_p80: 102 } } },
    { id: "de:1", country: "DE", name: "Trier", lu_workers: 8000, commute: { kirchberg: { driving: 40, driving_km: 43, transit: 75, transit_p80: 80 } } },
    { id: "be:1", country: "BE", name: "Arlon", lu_workers: 8600, house_price_median: 389000 },
    { id: "lu:0101", lau: "0101", country: "LU", name: "Beckerich", residents_employed: 900, rent_m2: 25,
      commute: { kirchberg: { driving: 30, driving_km: 25 } } },
  ],
};

test("hoursPerMonth follows 2 × minutes × 220 / 12 / 60", () => {
  assert.equal(hoursPerMonth(30), (2 * 30 * 220) / 12 / 60);
  assert.equal(hoursPerMonth(null), null);
});

test("rent, share of net salary and left to live", () => {
  const [lux, thi] = computePlaces(fixture, { hub: "kirchberg", size_m2: 70, tenure: "rent" });
  assert.equal(lux.rent_month, 3500);
  assert.equal(lux.share_of_lu_net, 3500 / 4000);
  assert.equal(lux.left_month, 500);
  assert.equal(thi.rent_month, 1120);
  assert.equal(thi.left_month, 2880);
  assert.equal(thi.car_min, 39);
  assert.equal(thi.transit_p80, 102);
  assert.ok(Math.abs(thi.hours_month_car - 23.833) < 0.01);
  assert.ok(thi.notes.includes("rent_charges_included"));
  assert.ok(thi.notes.includes("commute_cost_not_counted"));
});

test("missing data gives null and a note, never a number", () => {
  const ps = computePlaces(fixture, { hub: "kirchberg", size_m2: 50, tenure: "rent" });
  const trier = ps.find((p) => p.id === "de:1");
  const arlon = ps.find((p) => p.id === "be:1");
  const beck = ps.find((p) => p.id === "lu:0101");
  assert.equal(trier.rent_month, null);
  assert.equal(trier.left_month, null);
  assert.ok(trier.notes.includes("rent_not_comparable"));
  assert.equal(arlon.car_min, null);
  assert.equal(arlon.hours_month_car, null);
  assert.ok(arlon.notes.includes("rent_not_published"));
  assert.ok(arlon.notes.includes("commute_not_published"));
  assert.equal(beck.transit_min, null);
  assert.ok(beck.notes.includes("transit_not_published"));
});

test("buy: price total and years of net salary, no left to live", () => {
  const ps = computePlaces(fixture, { hub: "kirchberg", size_m2: 90, tenure: "buy" });
  const lux = ps[0];
  assert.equal(lux.price_total, 900000);
  assert.equal(lux.years_of_lu_net, 900000 / 48000);
  assert.equal(lux.share_of_lu_net, null);
  assert.equal(lux.rent_month, null); // buy mode: no rent mixed into the housing sort
  assert.deepEqual(rank(ps, "housing").slice(0, 1).map((p) => p.id), ["lu:0304"]);
  assert.equal(lux.left_month, null);
  assert.ok(ps.find((p) => p.id === "be:1").notes.includes("price_median_only"));
});

test("commute cost is subtracted once a per-km rate exists", () => {
  const d = { ...fixture, assumptions: { commute_days_per_year: 220, commute_cost_per_km_eur: 0.3 } };
  const thi = computePlaces(d, { hub: "kirchberg", size_m2: 70 })[1];
  const cost = (2 * 39 * 220 * 0.3) / 12;
  assert.equal(thi.left_month, Math.round(4000 - 1120 - cost));
});

test("rank puts nulls last and sorts by the chosen key", () => {
  const ps = computePlaces(fixture, { hub: "kirchberg", size_m2: 70 });
  assert.deepEqual(rank(ps, "left").map((p) => p.id), ["fr:1", "lu:0101", "lu:0304", "be:1", "de:1"]);
  assert.deepEqual(rank(ps, "time").map((p) => p.id), ["lu:0304", "lu:0101", "fr:1", "de:1", "be:1"]);
  assert.deepEqual(rank(ps, "housing").map((p) => p.id), ["fr:1", "lu:0101", "lu:0304", "be:1", "de:1"]);
  assert.throws(() => rank(ps, "nope"));
});

test("comparisons with Luxembourg City are computed from the data", () => {
  const c = comparisons(fixture, { hub: "kirchberg", size_m2: 70 });
  assert.equal(c[0].name, "Thionville");
  assert.equal(c[0].rent_less, 3500 - 1120);
  assert.ok(Math.abs(c[0].hours_more - hoursPerMonth(27)) < 1e-9);
});

test("real ouvivre.json: every place computes, no NaN", () => {
  const data = JSON.parse(readFileSync(new URL("../data/ouvivre.json", import.meta.url), "utf8"));
  for (const hub of ["kirchberg", "lux-gare", "cloche-dor", "belval", "findel"]) {
    for (const tenure of ["rent", "buy"]) {
      const ps = computePlaces(data, { hub, size_m2: 70, tenure });
      assert.equal(ps.length, data.places.length);
      for (const p of ps) for (const [k, v] of Object.entries(p)) if (typeof v === "number") assert.ok(Number.isFinite(v), `${p.id}.${k}`);
    }
  }
  assert.ok(comparisons(data).length >= 3);
});
