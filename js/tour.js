// Guided tour: successive pop-ups anchored to real elements of the home "Where to live?", with a dimmed backdrop and a
// spotlight on the element. Steps whose anchor is missing or hidden are skipped. The pure helpers (step filtering,
// popover placement, auto-start rule) are exported for the unit tests and take no DOM.
export const TOUR_KEY = "lm-tour-seen";

// Each step: i18n key `tour.<id>.t` / `tour.<id>.b` (+ `.bp` for a phone variant of the body), anchor selector for
// wide screens and phones, `only` to keep a step on one layout.
export const STEPS = [
  { id: "q", wide: "#lead .ov-grp-hub", phone: "#lead .ov-grp-hub", ctrls: true },
  { id: "sit", wide: "#lead .ov-grp-sit", phone: "#lead .ov-grp-sit", ctrls: true },
  { id: "settings", phone: "#lead .ov-ctrl-toggle", only: "phone" },
  { id: "rank", wide: "#panel .ov-tblwrap", phone: "#panel .ov-sortrow" },
  { id: "detail", wide: "#panel .ov-table tbody tr", phone: "#panel .ov-list .ov-card" },
  { id: "time", wide: "#lead .ov-time", phone: "#lead .ov-time", ctrls: true },
  { id: "minutes", wide: ".gr-modes .gr-seg", phone: ".gr-modes .gr-seg" },
  { id: "ask", wide: "#ask-fab", phone: "#ask-fab" },
  { id: "help", wide: "#help-btn", phone: "#help-btn" },
];

export const anchorOf = (step, phone) => (phone ? step.phone : step.wide) || null;

// Steps kept for this layout whose anchor exists and is visible (`visible(selector)` is supplied by the caller).
export function activeSteps(steps, { phone, visible }) {
  return steps.filter((s) => {
    if (s.only && s.only !== (phone ? "phone" : "wide")) return false;
    const sel = anchorOf(s, phone);
    return Boolean(sel) && visible(sel);
  });
}

// Auto-start once on the first visit (not on the kiosk nor in the promo-video mode); `?tour=1` forces it.
export function shouldAutoStart({ kiosk = false, video = false, forced = false, seen = false } = {}) {
  if (forced) return true;
  return !kiosk && !video && !seen;
}

// Popover placement next to a target rectangle, inside the viewport.
// target: {left, top, width, height}; pop: {width, height}; vp: {width, height}.
// Returns {side: "bottom"|"top"|"right"|"left"|"over", left, top, arrow} (arrow = offset along the popover edge).
export function placePopover(target, pop, vp, { gap = 14, margin = 12 } = {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const below = vp.height - (target.top + target.height) - gap - margin;
  const above = target.top - gap - margin;
  const right = vp.width - (target.left + target.width) - gap - margin;
  const left = target.left - gap - margin;
  const hLeft = clamp(cx - pop.width / 2, margin, Math.max(margin, vp.width - margin - pop.width));
  const vTop = clamp(cy - pop.height / 2, margin, Math.max(margin, vp.height - margin - pop.height));
  const arrowH = (l) => clamp(cx - l, 28, pop.width - 28);
  const arrowV = (t) => clamp(cy - t, 24, pop.height - 24);
  if (below >= pop.height) return { side: "bottom", left: hLeft, top: target.top + target.height + gap, arrow: arrowH(hLeft) };
  if (above >= pop.height) return { side: "top", left: hLeft, top: target.top - gap - pop.height, arrow: arrowH(hLeft) };
  if (right >= pop.width) return { side: "right", left: target.left + target.width + gap, top: vTop, arrow: arrowV(vTop) };
  if (left >= pop.width) return { side: "left", left: target.left - gap - pop.width, top: vTop, arrow: arrowV(vTop) };
  // target as large as the screen: the popover sits over it, at the bottom of the viewport
  return { side: "over", left: clamp((vp.width - pop.width) / 2, margin, vp.width), top: Math.max(margin, vp.height - margin - pop.height), arrow: null };
}

// ---- DOM part ----------------------------------------------------------------------------------------------------
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function isVisible(sel) {
  const e = document.querySelector(sel);
  if (!e || e.closest("[hidden]")) return false;
  const r = e.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(e);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

// t(key, vars): translation; prepare(): put the home in a state where the anchors exist (called at start);
// onStart/onStop: hooks of the app (stop the attract loop, close the chat...).
export function createTour({ t, isPhone, prepare = async () => {}, onStart = () => {}, onStop = () => {} }) {
  let steps = [];
  let i = 0;
  let open = false;
  let phone = false;
  let lastFocus = null;
  let ticker = null;
  let target = null;

  const root = el("div", "lm-tour");
  root.hidden = true;
  const block = el("div", "lm-tour-block");
  const spot = el("div", "lm-tour-spot");
  spot.setAttribute("aria-hidden", "true");
  const pop = el("div", "lm-tour-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "true");
  pop.setAttribute("aria-labelledby", "lm-tour-title");
  pop.setAttribute("aria-describedby", "lm-tour-body");
  pop.tabIndex = -1;
  const arrow = el("span", "lm-tour-arrow");
  arrow.setAttribute("aria-hidden", "true");
  const count = el("p", "eyebrow lm-tour-count");
  const title = el("h2", "lm-tour-title");
  title.id = "lm-tour-title";
  const body = el("p", "lm-tour-body");
  body.id = "lm-tour-body";
  const acts = el("div", "lm-tour-acts");
  const skip = el("button", "link-btn lm-tour-skip");
  const prev = el("button", "btn lm-tour-prev");
  const next = el("button", "btn primary lm-tour-next");
  for (const b of [skip, prev, next]) b.type = "button";
  skip.onclick = () => stop();
  prev.onclick = () => go(i - 1, -1);
  next.onclick = () => (i >= steps.length - 1 ? stop() : go(i + 1, 1));
  acts.append(skip, prev, next);
  pop.append(arrow, count, title, body, acts);
  root.append(block, spot, pop);
  document.body.append(root);

  function anchor() {
    const sel = anchorOf(steps[i], phone);
    return sel ? document.querySelector(sel) : null;
  }

  function place() {
    if (!open) return;
    if (!target || !target.isConnected) target = anchor(); // the home re-renders its panel on every change
    if (!target) return;
    const r = target.getBoundingClientRect();
    const vp = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const pad = 6;
    // spotlight clipped to the viewport (a tall target such as the table)
    const sl = Math.max(4, r.left - pad);
    const st = Math.max(4, r.top - pad);
    const sr = Math.min(vp.width - 4, r.right + pad);
    const sb = Math.min(vp.height - 4, r.bottom + pad);
    Object.assign(spot.style, { left: `${sl}px`, top: `${st}px`, width: `${Math.max(0, sr - sl)}px`, height: `${Math.max(0, sb - st)}px` });
    const p = placePopover({ left: sl, top: st, width: sr - sl, height: sb - st },
      { width: pop.offsetWidth, height: pop.offsetHeight }, vp, { gap: 14 });
    pop.style.left = `${Math.round(p.left)}px`;
    pop.style.top = `${Math.round(p.top)}px`;
    pop.dataset.side = p.side;
    arrow.hidden = p.arrow === null;
    arrow.style.removeProperty("left");
    arrow.style.removeProperty("top");
    if (p.arrow !== null) arrow.style[p.side === "top" || p.side === "bottom" ? "left" : "top"] = `${Math.round(p.arrow)}px`;
  }

  function render() {
    const s = steps[i];
    const last = i === steps.length - 1;
    count.textContent = t("tour.count", { i: i + 1, n: steps.length });
    title.textContent = t(`tour.${s.id}.t`);
    const pk = `tour.${s.id}.bp`;
    body.textContent = phone && t(pk) !== pk ? t(pk) : t(`tour.${s.id}.b`);
    skip.textContent = t("tour.skip");
    skip.hidden = last;
    prev.textContent = t("tour.prev");
    prev.disabled = i === 0;
    next.textContent = last ? t("tour.done") : t("tour.next");
    pop.setAttribute("aria-label", t("tour.label"));
    pop.dataset.step = s.id;
  }

  // Show step n (dir = direction to keep looking when the anchor vanished since the start).
  function go(n, dir = 1) {
    if (!open) return;
    let k = n;
    while (k >= 0 && k < steps.length && !isVisible(anchorOf(steps[k], phone))) k += dir;
    if (k < 0 || k >= steps.length) { if (dir > 0) stop(); return; }
    i = k;
    target = anchor();
    document.querySelectorAll("[data-tour-on]").forEach((e) => e.removeAttribute("data-tour-on"));
    target.setAttribute("data-tour-on", "");
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    render();
    place();
    pop.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (!open) return;
    const k = e.key;
    if (k === "Escape") stop();
    else if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") (i >= steps.length - 1 ? stop() : go(i + 1, 1));
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { if (i > 0) go(i - 1, -1); }
    else if (k === "Tab") {
      // focus trap inside the popover
      const f = [...pop.querySelectorAll("button")].filter((b) => !b.disabled && !b.hidden);
      const at = f.indexOf(document.activeElement);
      const to = e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : (at < 0 || at === f.length - 1 ? 0 : at + 1);
      f[to]?.focus();
    } else if (k === "Enter" || k === " ") {
      if (document.activeElement === pop) next.click(); else return; // buttons handle their own Enter / Space
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  const onMove = () => place();

  async function start() {
    if (open) return true;
    lastFocus = document.activeElement;
    open = true;
    steps = [];
    i = 0;
    onStart();
    await prepare();
    if (!open) return false; // closed while preparing (kiosk idle reset)
    phone = isPhone();
    steps = activeSteps(STEPS, { phone, visible: isVisible });
    if (!steps.length) { open = false; onStop(); return false; }
    root.hidden = false;
    document.body.classList.add("tour-open");
    addEventListener("keydown", onKey, true);
    addEventListener("resize", onMove);
    addEventListener("scroll", onMove, { capture: true, passive: true });
    ticker = setInterval(place, 300);
    go(0, 1);
    return true;
  }

  function stop() {
    if (!open) return;
    open = false;
    root.hidden = true;
    document.body.classList.remove("tour-open");
    document.querySelectorAll("[data-tour-on]").forEach((e) => e.removeAttribute("data-tour-on"));
    removeEventListener("keydown", onKey, true);
    removeEventListener("resize", onMove);
    removeEventListener("scroll", onMove, { capture: true });
    clearInterval(ticker);
    target = null;
    onStop();
    const back = lastFocus?.isConnected && lastFocus !== document.body ? lastFocus : document.getElementById("help-btn");
    back?.focus?.({ preventScroll: true });
  }

  return {
    start, stop,
    next: () => go(i + 1, 1),
    prev: () => go(i - 1, -1),
    isOpen: () => open,
    step: () => (open && steps[i] ? { index: i, total: steps.length, id: steps[i].id } : null),
    relabel: () => { if (open) { render(); place(); } },
  };
}
