// "Où vivre ?" — pure computations over data/ouvivre.json (no DOM, testable with node --test).
// Formulas (plan B1): monthly rent = rent_m2 × size; purchase = sale_price_m2 × size;
// share of the Luxembourg reference net salary; hours/month = 2 × minutes × days / 12 / 60;
// fuel cost/month = 2 × road km × working days / 12 × consumption / 100 × pump price (assumptions);
// left to live (rent) = net LU − rent − fuel cost; null when the place has no car route (no number invented).
// Cross-border transit fares are not collected: noted, never counted. No rent-by-size source exists: no size factor.

export const HUBS = ["kirchberg", "lux-gare", "cloche-dor", "belval", "findel"];
export const SIZES = [50, 70, 90];
export const COUNTRIES = ["LU", "FR", "DE", "BE"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function hoursPerMonth(minutes, days = 220) {
  if (num(minutes) === null) return null;
  return (2 * minutes * days) / 12 / 60;
}

export function fuelCostMonth(km, days, consumptionL100, pricePerL) {
  if (num(km) === null || num(days) === null || num(consumptionL100) === null || num(pricePerL) === null) return null;
  return (2 * km * days * (consumptionL100 / 100) * pricePerL) / 12;
}

export function computePlaces(data, { hub = "kirchberg", size_m2 = 70, tenure = "rent" } = {}) {
  const net = num(data?.reference?.net_monthly_lu);
  const A = data?.assumptions || {};
  const days = num(A.commute_days_per_year) ?? 220;
  const workDays = num(A.working_days_per_year) ?? days;
  const consumption = num(A.consumption_l_per_100km);
  const fuelPrice = num(A.fuel_price_eur_per_l);
  return (data?.places || []).map((p) => {
    const notes = [];
    const rentM2 = num(p.rent_m2);
    const saleM2 = num(p.sale_price_m2);
    // Only the figure of the chosen tenure is set, so sorting by housing never mixes rents and prices.
    const rent_month = tenure !== "rent" || rentM2 === null ? null : Math.round(rentM2 * size_m2);
    const price_total = tenure !== "buy" || saleM2 === null ? null : Math.round(saleM2 * size_m2);
    const c = p.commute?.[hub] || null;
    const car_min = num(c?.driving);
    const car_km = num(c?.driving_km);
    const transit_min = num(c?.transit);
    const transit_p80 = num(c?.transit_p80);

    if (tenure === "rent" && rent_month === null) {
      if (p.country === "DE") notes.push("rent_not_comparable");
      else notes.push("rent_not_published");
    }
    if (tenure === "buy" && price_total === null) {
      if (p.country === "BE" || num(p.house_price_median) !== null) notes.push("price_median_only");
      else if (p.country === "FR") notes.push("no_sale_moselle");
      else notes.push("price_not_published");
    }
    if (p.country === "FR" && tenure === "rent" && rent_month !== null) notes.push("rent_charges_included", "rent_size_fr");
    if (p.country === "LU" && tenure === "rent" && rent_month !== null && size_m2 > 50) notes.push("rent_size_lu");
    if (!c) notes.push("commute_not_published");
    else if (transit_min === null) notes.push("transit_not_published");

    const housing = tenure === "rent" ? rent_month : price_total;
    let share_of_lu_net = null;
    let years_of_lu_net = null;
    if (net !== null && housing !== null) {
      if (tenure === "rent") share_of_lu_net = rent_month / net;
      else years_of_lu_net = price_total / (net * 12);
    }
    const fuel_cost_month = fuelCostMonth(car_km, workDays, consumption, fuelPrice);
    if (c && p.country !== "LU") notes.push("transit_cost_not_counted");

    // Left to live is only defined for renting: a purchase has no monthly cost without a mortgage assumption.
    let left_month = null;
    if (tenure === "rent" && net !== null && rent_month !== null) {
      if (fuel_cost_month === null) notes.push("no_car_route");
      else left_month = Math.round(net - rent_month - fuel_cost_month);
    } else if (tenure === "buy") notes.push("left_rent_only");

    return {
      id: p.id,
      lau: p.lau ?? null,
      name: p.name,
      country: p.country,
      lat: p.lat,
      lon: p.lon,
      workers: num(p.lu_workers) ?? num(p.residents_employed),
      dist_lux_km: num(p.dist_lux_km),
      rent_m2: rentM2,
      rent_range: Array.isArray(p.rent_range) ? p.rent_range : null,
      sale_price_m2: saleM2,
      house_price: num(p.house_price),
      house_price_median: num(p.house_price_median),
      appt_price_median: num(p.appt_price_median),
      rent_month,
      price_total,
      share_of_lu_net,
      years_of_lu_net,
      car_min,
      car_km,
      transit_min,
      transit_p80,
      hours_month_car: hoursPerMonth(car_min, days),
      hours_month_transit: hoursPerMonth(transit_min, days),
      hours_month_transit_p80: hoursPerMonth(transit_p80, days),
      fuel_cost_month,
      left_month,
      src: p.src || {},
      notes,
    };
  });
}

// Sort keys: "left" (left to live, high first), "time" (car minutes, then transit, short first),
// "housing" (rent or purchase price, low first). Missing values always go last; ties by name.
export function sortValue(p, by) {
  if (by === "left") return p.left_month === null ? null : -p.left_month;
  if (by === "time") return p.car_min ?? p.transit_min;
  if (by === "housing") return p.rent_month ?? p.price_total;
  throw new Error(`unknown sort: ${by}`);
}

export function rank(places, by = "left") {
  return [...places].sort((a, b) => {
    const va = sortValue(a, by), vb = sortValue(b, by);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return va - vb;
    return a.name.localeCompare(b.name, "fr");
  });
}

// Striking comparisons for the kiosk attract mode, computed from the data (not hand-written).
// Each place with a rent and a car time is compared with Luxembourg City for the same hub and size.
export function comparisons(data, { hub = "kirchberg", size_m2 = 70, refLau = "0304", max = 6 } = {}) {
  const places = computePlaces(data, { hub, size_m2, tenure: "rent" });
  const ref = places.find((p) => p.lau === refLau);
  if (!ref || ref.rent_month === null || ref.hours_month_car === null) return [];
  return places
    .filter((p) => p.id !== ref.id && p.rent_month !== null && p.hours_month_car !== null && p.rent_month < ref.rent_month)
    .sort((a, b) => (b.workers ?? 0) - (a.workers ?? 0))
    .slice(0, max)
    .map((p) => ({
      id: p.id,
      ref: ref.id,
      name: p.name,
      country: p.country,
      hub,
      size_m2,
      rent_less: ref.rent_month - p.rent_month,
      hours_more: p.hours_month_car - ref.hours_month_car,
      workers: p.workers,
    }));
}
