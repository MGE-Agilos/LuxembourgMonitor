// Estimates of masked rents / sale prices (ouvivre.json rent_est / sale_est): text and marker shared by the home,
// the comparator and the drawer. An estimate is never a published figure: it is always labelled "est.".
import { h } from "./dom.js";
import { getLang, t } from "./i18n.js";

const OFFICIAL_ONLY = "lm.officialOnly";
export function officialOnly() {
  try { return sessionStorage.getItem(OFFICIAL_ONLY) === "1"; } catch { return false; }
}
export function setOfficialOnly(on) {
  try { sessionStorage.setItem(OFFICIAL_ONLY, on ? "1" : "0"); } catch { /* storage unavailable: kept in memory by the caller */ }
}

const fmt = (v, d = 1) => new Intl.NumberFormat(getLang() === "fr" ? "fr-LU" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

// kind: "rent" | "price". Returns the one-line explanation, or null when the place has no estimate of that kind.
export function estText(p, kind) {
  const e = kind === "rent" ? p?.rent_est : p?.sale_est;
  if (!e) return null;
  const k = t(kind === "rent" ? "est.k.rent" : "est.k.price");
  const m = e.method || "unknown";
  return t(`est.${m}`, { k, year: e.year ?? "", base: e.base == null ? "" : fmt(e.base, 1), ratio: e.ratio == null ? "" : fmt(e.ratio, 2),
    canton: e.canton || "", district: e.district || "", n: e.n ?? "" });
}

// Small "est." marker with the explanation as tooltip.
export function estMark(text) {
  const s = h("span", "ov-est", t("est.short"));
  s.title = text || t("est.title");
  s.setAttribute("aria-label", text || t("est.title"));
  return s;
}
