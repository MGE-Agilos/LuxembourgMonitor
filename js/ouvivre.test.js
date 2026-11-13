import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { comparisons, computePlaces, fuelCostMonth, hoursPerMonth, mortgagePayment, rank, referenceHourlyWage } from "./ouvivre.js";

const fixture = {
  reference: { net_monthly_lu: 4000 },
  assumptions: { commute_days_per_year: 220, working_days_per_year: 220, consumption_l_per_100km: 6.5, fuel_price_eur_per_l: 1.8 },
  places: [
    { id: "lu:0304", lau: "0304", country: "LU", name: "Luxembourg", residents_employed: 50000, rent_m2: 50, sale_price_m2: 10000,
      commute: { kirchberg: { driving: 12, driving_km: 4, transit: 24, transit_p80: 26 } } },
    { id: "fr:1", country: "FR", name: "Thionville", lu_workers: 10000, rent_m2: 16,
      commute: { kirchberg: { driving: 39, driving_km: 39, transit: 85, transit_p80: 102 } } },
    { id: "de:1", country: "DE", name: "Trier", lu_workers: 8000, commute: { kirchberg: { driving: 40, driving_km: 43, transit: 75, transit_p80: 80 } } },
    { id: "be:1", country: "BE", name: "Arlon", lu_workers: 8600, house_price_median: 389000 },
    { id: "lu:0101", lau: "0101", country: "LU", name: "Beckerich", residents_employed: 900, rent_m2: 25,
      commute: { kirchberg: { driving: 30, driving_km: 25 } } },
    { id: "fr:2", country: "FR", name: "SansRoute", lu_workers: 500, rent_m2: 10, commute: { kirchberg: { transit: 70, transit_p80: 80 } } },
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
  assert.equal(lux.left_month, Math.round(4000 - 3500 - fuelCostMonth(4, 220, 6.5, 1.8)));
  assert.equal(thi.rent_month, 1120);
  assert.equal(thi.left_month, Math.round(4000 - 1120 - fuelCostMonth(39, 220, 6.5, 1.8)));
  assert.equal(thi.car_min, 39);
  assert.equal(thi.transit_p80, 102);
  assert.ok(Math.abs(thi.hours_month_car - 23.833) < 0.01);
  assert.ok(thi.notes.includes("rent_charges_included"));
  assert.ok(thi.notes.includes("transit_cost_not_counted"));
  assert.ok(!lux.notes.includes("transit_cost_not_counted")); // public transport is free in Luxembourg
  assert.ok(lux.notes.includes("rent_size_lu")); // 70 m2 > average advertised flat: caveat
  assert.ok(thi.notes.includes("rent_size_fr"));
});

test("fuel cost = 2 x km x days / 12 x L/100 km x price", () => {
  // 39 km: 2 x 39 x 220 / 12 = 1430 km a month; 6.5 L/100 km = 92.95 L; at 1.8 EUR/L = 167.31 EUR
  assert.ok(Math.abs(fuelCostMonth(39, 220, 6.5, 1.8) - 167.31) < 1e-9);
  assert.equal(fuelCostMonth(null, 220, 6.5, 1.8), null);
  assert.equal(fuelCostMonth(39, 220, 6.5, null), null);
  const thi = computePlaces(fixture, { hub: "kirchberg", size_m2: 70 }).find((p) => p.id === "fr:1");
  assert.ok(Math.abs(thi.fuel_cost_month - 167.31) < 1e-9);
  assert.equal(thi.left_month, 2713);
  const small = computePlaces(fixture, { hub: "kirchberg", size_m2: 50 }).find((p) => p.id === "lu:0304");
  assert.ok(!small.notes.includes("rent_size_lu"));
});

test("no car route: left to live is null with a note, hours of transit still shown", () => {
  const sr = computePlaces(fixture, { hub: "kirchberg", size_m2: 70 }).find((p) => p.id === "fr:2");
  assert.equal(sr.rent_month, 700);
  assert.equal(sr.fuel_cost_month, null);
  assert.equal(sr.left_month, null);
  assert.ok(sr.notes.includes("no_car_route"));
  assert.ok(sr.hours_month_transit > 0);
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

test("mortgagePayment is the standard annuity", () => {
  // 200 000 € borrowed over 25 years at 3.6 %: about 1 012 € per month
  assert.ok(Math.abs(mortgagePayment(250000, 3.6, 25, 0.8) - 1012.0) < 1);
  assert.equal(mortgagePayment(120000, 0, 10, 1), 1000);
  assert.equal(mortgagePayment(null, 3, 25, 0.8), null);
  assert.equal(mortgagePayment(100000, null, 25, 0.8), null);
});

test("buy: price, mortgage payment, left to live with fuel, time value applies", () => {
  const data = { ...fixture, assumptions: { ...fixture.assumptions, mortgage_years: 25, mortgage_loan_share: 0.8, mortgage_rate_pct: { LU: 3.6 } } };
  const ps = computePlaces(data, { hub: "kirchberg", size_m2: 90, tenure: "buy" });
  const lux = ps[0];
  assert.equal(lux.price_total, 900000);
  assert.equal(lux.years_of_lu_net, 900000 / 48000);
  assert.equal(lux.mortgage_month, Math.round(mortgagePayment(900000, 3.6, 25, 0.8)));
  assert.equal(lux.share_of_lu_net, lux.mortgage_month / 4000);
  assert.equal(lux.rent_month, null); // buy mode: no rent mixed into the housing sort
  assert.equal(lux.left_month, Math.round(4000 - lux.mortgage_month - fuelCostMonth(4, 220, 6.5, 1.8)));
  assert.deepEqual(rank(ps, "housing").slice(0, 1).map((p) => p.id), ["lu:0304"]);
  assert.ok(ps.find((p) => p.id === "be:1").notes.includes("price_median_only"));
  const tv = computePlaces(data, { hub: "kirchberg", size_m2: 90, tenure: "buy", timeValue: 20 })[0];
  assert.equal(tv.balance_month, tv.left_month - Math.round(hoursPerMonth(12) * 20));
  // without a rate for the country: no payment, no left to live, a note (never a guessed rate)
  const noRate = computePlaces(fixture, { hub: "kirchberg", size_m2: 90, tenure: "buy" })[0];
  assert.equal(noRate.mortgage_month, null);
  assert.equal(noRate.left_month, null);
  assert.ok(noRate.notes.includes("no_mortgage_rate"));
});

test("rank puts nulls last and sorts by the chosen key", () => {
  const ps = computePlaces(fixture, { hub: "kirchberg", size_m2: 70 });
  assert.deepEqual(rank(ps, "left").map((p) => p.id), ["fr:1", "lu:0101", "lu:0304", "be:1", "fr:2", "de:1"]);
  assert.deepEqual(rank(ps, "time").map((p) => p.id), ["lu:0304", "lu:0101", "fr:1", "de:1", "fr:2", "be:1"]);
  assert.deepEqual(rank(ps, "housing").map((p) => p.id), ["fr:2", "fr:1", "lu:0101", "lu:0304", "be:1", "de:1"]);
  assert.throws(() => rank(ps, "nope"));
});

test("timeValue 0 leaves the ranking and the figures unchanged", () => {
  const a = computePlaces(fixture, { hub: "kirchberg", size_m2: 70 });
  const b = computePlaces(fixture, { hub: "kirchberg", size_m2: 70, timeValue: 0 });
  assert.deepEqual(rank(b, "left").map((p) => p.id), rank(a, "left").map((p) => p.id));
  for (const p of b) { assert.equal(p.time_cost_month, null); assert.equal(p.balance_month, p.left_month); }
});

test("a positive time value penalises long commutes", () => {
  const ps = computePlaces(fixture, { hub: "kirchberg", size_m2: 70, timeValue: 40 });
  const thi = ps.find((p) => p.id === "fr:1"), lux = ps.find((p) => p.id === "lu:0304");
  assert.equal(thi.time_cost_month, Math.round(hoursPerMonth(39) * 40));
  assert.equal(thi.balance_month, thi.left_month - thi.time_cost_month);
  assert.equal(lux.balance_month, lux.left_month - lux.time_cost_month);
  // a far cheap place beats a near dear one at 0 EUR/h, and loses once the extra hours are priced
  const fx = { ...fixture, places: [
    { id: "near", country: "LU", name: "Near", residents_employed: 1, rent_m2: 20, commute: { kirchberg: { driving: 10, driving_km: 8 } } },
    { id: "far", country: "FR", name: "Far", lu_workers: 1, rent_m2: 18, commute: { kirchberg: { driving: 60, driving_km: 8 } } },
  ] };
  const at = (v) => rank(computePlaces(fx, { hub: "kirchberg", size_m2: 70, timeValue: v }), "left").map((p) => p.id);
  assert.deepEqual(at(0), ["far", "near"]);
  assert.deepEqual(at(40), ["near", "far"]);
});

test("time value nulls: no hours or no left to live gives no balance", () => {
  const ps = computePlaces(fixture, { hub: "kirchberg", size_m2: 70, timeValue: 20 });
  for (const id of ["fr:2", "de:1", "be:1"]) assert.equal(ps.find((p) => p.id === id).balance_month, null);
  assert.deepEqual(rank(ps, "left").slice(-3).map((p) => p.id).sort(), ["be:1", "de:1", "fr:2"]);
});

test("transit mode uses the transit p50 hours", () => {
  const thi = computePlaces(fixture, { hub: "kirchberg", size_m2: 70, timeValue: 10, mode: "transit" }).find((p) => p.id === "fr:1");
  assert.equal(thi.time_cost_month, Math.round(hoursPerMonth(85) * 10));
});

test("reference hourly wage = net monthly / (40 x 52 / 12)", () => {
  assert.ok(Math.abs(referenceHourlyWage(fixture) - 4000 / (40 * 52 / 12)) < 1e-9);
  assert.equal(referenceHourlyWage({}), null);
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

const estFixture = {
  reference: { net_monthly_lu: 4000 },
  assumptions: fixture.assumptions,
  places: [
    { id: "lu:1", lau: "1", country: "LU", name: "Official", rent_m2: 30, rent_m2_est: 99, sale_price_m2: 6000, sale_price_m2_est: 99,
      commute: { kirchberg: { driving: 20, driving_km: 15 } } },
    { id: "lu:2", lau: "2", country: "LU", name: "Estimated", rent_m2: null, rent_m2_est: 20, rent_est: { method: "canton_mean", canton: "X", n: 3 },
      sale_price_m2_est: 5000, sale_est: { method: "district_mean" }, commute: { kirchberg: { driving: 30, driving_km: 25 } } },
    { id: "lu:3", lau: "3", country: "LU", name: "Nothing", commute: { kirchberg: { driving: 10, driving_km: 5 } } },
  ],
};

test("estimates: official value wins, estimate fills a masked one, flags and notes are set", () => {
  const [off, est, none] = computePlaces(estFixture, { size_m2: 70, tenure: "rent" });
  assert.equal(off.rent_month, 2100);
  assert.equal(off.rent_estimated, false);
  assert.ok(!off.notes.some((n) => n.startsWith("rent_estimate_")));
  assert.equal(est.rent_month, 1400);
  assert.equal(est.rent_estimated, true);
  assert.equal(est.rent_m2, null); // the official field stays null
  assert.equal(est.share_of_lu_net, 1400 / 4000);
  assert.equal(est.left_month, Math.round(4000 - 1400 - fuelCostMonth(25, 220, 6.5, 1.8)));
  assert.equal(est.balance_month, est.left_month);
  assert.ok(est.notes.includes("rent_estimate_canton_mean"));
  assert.equal(none.rent_month, null);
  assert.ok(none.notes.includes("rent_not_published"));
  const [, estBuy] = computePlaces(estFixture, { size_m2: 70, tenure: "buy" });
  assert.equal(estBuy.price_total, 350000);
  assert.equal(estBuy.price_estimated, true);
  assert.ok(estBuy.notes.includes("price_estimate_district_mean"));
});

test("estimates: useEstimates false behaves as before (null)", () => {
  const [off, est] = computePlaces(estFixture, { size_m2: 70, tenure: "rent", useEstimates: false });
  assert.equal(off.rent_month, 2100);
  assert.equal(est.rent_month, null);
  assert.equal(est.rent_estimated, false);
  assert.equal(est.left_month, null);
  assert.ok(est.notes.includes("rent_not_published"));
  assert.equal(computePlaces(estFixture, { tenure: "buy", useEstimates: false })[1].price_total, null);
});

test("estimates: ranking includes estimated places and comparisons ignore them", () => {
  const ps = computePlaces(estFixture, { size_m2: 70, tenure: "rent" });
  assert.deepEqual(rank(ps, "housing").map((p) => p.name), ["Estimated", "Official", "Nothing"]);
  const off = rank(computePlaces(estFixture, { size_m2: 70, tenure: "rent", useEstimates: false }), "housing");
  assert.equal(off[0].name, "Official");
  const withEst = { ...estFixture, places: [{ ...estFixture.places[0], lau: "0304", rent_m2: 50 }, estFixture.places[1]] };
  assert.equal(comparisons(withEst, { hub: "kirchberg" }).length, 0);
});

test("real ouvivre.json: every Luxembourg place has a rent (official or estimated)", () => {
  const data = JSON.parse(readFileSync(new URL("../data/ouvivre.json", import.meta.url), "utf8"));
  const lu = computePlaces(data, { tenure: "rent" }).filter((p) => p.country === "LU");
  assert.ok(lu.every((p) => p.rent_month !== null));
  assert.ok(lu.some((p) => p.rent_estimated));
});
