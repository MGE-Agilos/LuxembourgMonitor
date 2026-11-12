// "Ask the data": floating, contextual, conversational chat bubble on every page.
// The thread lives in memory (and sessionStorage) so that it survives page changes; each question is sent with the
// page context and the last 3 turns; suggestions.json questions keep their pre-computed answers when the API fails.
import { contextSuggestions } from "./chat-suggest.js";
import { ASK_TIMEOUT_MS, ASK_URL, KIOSK, VIDEO } from "./config.js";
import { data, displayName, fmt, label, sourceName } from "./data.js";
import { h, sleep } from "./dom.js";
import { getLang, t } from "./i18n.js";
import { extLink } from "./ui.js";

const UNIT_FR = { "€/month": "€/mois", "€/inh.": "€/hab.", places: "places", h: "h" };
const UNIT_EN = { places: "places" };
const STORE = "lm-chat";
const MAX_THREAD = 20;
export const MAX_HISTORY = 3;

// Figure of the v2 answer (cross-border place, canton or national): the server sends its label, unit and year.
export function figureText(f, lang, { communeName = (l) => l } = {}) {
  if (!f.label) return null;
  const name = f.place === "national" ? t("ask.national") : f.commune ? communeName(f.commune) : f.name || f.place;
  const d = Number.isInteger(f.value) ? 0 : 1;
  const s = new Intl.NumberFormat(lang === "fr" ? "fr-LU" : "en-GB", { maximumFractionDigits: d }).format(f.value);
  const u = (lang === "fr" ? UNIT_FR[f.unit] : UNIT_EN[f.unit]) ?? f.unit ?? "";
  const v = !u ? s : u === "%" ? (lang === "fr" ? `${s} %` : `${s}%`) : `${s} ${u}`;
  const label = f.label[lang] || f.label.en;
  return `${name} — ${label} : ${v}${f.year != null && f.year !== "" ? ` (${f.year})` : ""}`;
}

let fallback = null;
async function loadFallback() {
  if (fallback) return fallback;
  try {
    const r = await fetch("fallback/answers.json");
    if (!r.ok) return {};
    fallback = await r.json();
  } catch {
    return {};
  }
  return fallback;
}

export function isValid(res) {
  return !!res && typeof res.text === "string"
    && (res.communes === undefined || (Array.isArray(res.communes) && res.communes.every((x) => typeof x === "string")))
    && (res.places === undefined || (Array.isArray(res.places) && res.places.every((x) => typeof x === "string")))
    && (res.figures === undefined || (Array.isArray(res.figures) && res.figures.every((f) => f && typeof f.value === "number"
      && (f.label === undefined || (f.label && typeof f.label === "object")))));
}

export async function askApi(question, lang, lau, { url = ASK_URL, timeoutMs = ASK_TIMEOUT_MS, signal, history, context } = {}) {
  if (!url) throw new Error("offline");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const body = { question, lang, lau };
    if (history?.length) body.history = history;
    if (context) body.context = context;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const j = await r.json();
    if (!isValid(j)) throw new Error("bad response");
    return j;
  } finally {
    clearTimeout(timer);
  }
}

// Last answered turns as {q, a} (plain text) for the API.
export function historyOf(thread, max = MAX_HISTORY) {
  return thread.filter((x) => x.status === "ok" && x.res?.text).slice(-max).map((x) => ({ q: x.q, a: x.res.text }));
}

function loadThread() {
  try {
    const j = JSON.parse(sessionStorage.getItem(STORE) || "[]");
    return Array.isArray(j) ? j.filter((x) => x && typeof x.q === "string" && (x.status !== "ok" || isValid(x.res))) : [];
  } catch {
    return [];
  }
}
function saveThread(thread) {
  try { sessionStorage.setItem(STORE, JSON.stringify(thread.filter((x) => x.status !== "pending"))); } catch { /* ignore */ }
}

const ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4.5 3.6A.9.9 0 0 1 3 20.9V6a2 2 0 0 1 1-2Zm4 6.5a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/></svg>';

/**
 * @param getContext  () => page context for the API ({page, lau, place, places, hub, size_m2, tenure, time_value, tab})
 * @param highlight   (ids) => light up LU LAU codes / place ids on the visible map
 * @param navigate    (hash) => go to a page (the thread stays)
 * @param onOpen      () => called when the panel opens (e.g. stop the attract loop)
 */
export function createChat({ getContext, highlight = () => {}, navigate, onOpen = () => {} }) {
  let thread = loadThread();
  let isOpen = false;
  let apiDown = !ASK_URL;
  let seq = 0;
  let abort = new AbortController();
  let lastFocus = null;

  // Floating button
  const fab = h("button", "lm-fab");
  fab.type = "button";
  fab.id = "ask-fab";
  fab.setAttribute("aria-haspopup", "dialog");
  fab.setAttribute("aria-controls", "ask-panel");
  fab.innerHTML = ICON;
  const fabLabel = h("span", "lm-fab-label");
  fab.append(fabLabel);
  fab.onclick = () => open();

  // Panel
  const panel = h("div", "lm-chat");
  panel.id = "ask-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "ask-title");
  const head = h("div", "lm-chat-head");
  const title = h("h2", "lm-chat-title");
  title.id = "ask-title";
  const newBtn = h("button", "btn ghost small lm-chat-new");
  newBtn.type = "button";
  newBtn.onclick = () => { reset(); render(); input.focus(); };
  const closeBtn = h("button", "lm-chat-close");
  closeBtn.type = "button";
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z"/></svg>';
  closeBtn.onclick = () => close();
  const ctxChip = h("p", "chip emph lm-chat-ctx");
  head.append(title, newBtn, closeBtn);
  const body = h("div", "lm-chat-body");
  const log = h("div", "lm-thread");
  log.setAttribute("aria-live", "polite");
  body.append(ctxChip, log);
  const form = h("form", "lm-askform");
  const input = h("input");
  input.maxLength = 300;
  input.autocomplete = "off";
  const send = h("button", "btn primary");
  send.type = "submit";
  form.append(input, send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length >= 3) { input.value = ""; ask(q, null); }
  });
  const privacy = h("p", "lm-chat-privacy");
  panel.append(head, body, form, privacy);
  document.body.append(fab, panel);

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1'])")]
      .filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function relabel() {
    fabLabel.textContent = t("ask.title");
    fab.setAttribute("aria-label", t("ask.title"));
    title.textContent = t("ask.title");
    newBtn.textContent = t("ask.new");
    closeBtn.setAttribute("aria-label", t("ask.close"));
    input.placeholder = t("ask.placeholder");
    input.setAttribute("aria-label", t("ask.placeholder"));
    send.textContent = t("ask.send");
    privacy.textContent = t("ask.privacy");
  }

  const st = () => data();
  const lang = () => getLang();
  function placeName(id) {
    const p = (st().ouvivre?.places || []).find((x) => x.id === id);
    if (!p) return null;
    const c = p.lau ? st().byLau.get(p.lau) : null;
    return c ? displayName(c, lang()) : p.name;
  }
  function names(ctx) {
    const c = ctx?.lau ? st().byLau.get(ctx.lau) : null;
    return { lau: c ? displayName(c, lang()) : null, place: ctx?.place ? placeName(ctx.place) : null };
  }
  function contextLabel(ctx) {
    const n = names(ctx);
    if (ctx?.page === "commune" && n.lau) return t("ask.about", { name: n.lau });
    if (ctx?.page === "place" && n.place) return t("ask.about", { name: n.place });
    if (ctx?.page === "ouvivre" && ctx.hub) {
      const bits = [t(`hub.${ctx.hub}`), t(`size.${ctx.size_m2}`), t(`ten.${ctx.tenure}`)];
      return bits.join(" · ");
    }
    return "";
  }
  function suggestionList() {
    const ctx = getContext();
    return contextSuggestions(ctx, { lang: lang(), suggestions: st().suggestions, names: names(ctx), live: !apiDown && !VIDEO });
  }

  function chips(list, cls) {
    const box = h("div", cls);
    for (const s of list) {
      const b = h("button", "btn", s.q);
      b.type = "button";
      if (s.sid) b.dataset.sid = s.sid;
      b.onclick = () => ask(s.q, s.sid);
      box.append(b);
    }
    return box;
  }

  function answerBox(res) {
    const L = lang();
    const box = h("div", "lm-answer");
    box.append(h("p", "lm-answer-text", res.text));
    if (res.figures?.length) {
      box.append(h("p", "section-title", t("ask.figures")));
      const ul = h("ul", "lm-figs");
      const communeName = (l) => { const c = st().byLau.get(l); return c ? displayName(c, L) : l; };
      for (const f of res.figures) {
        const v2 = figureText(f, L, { communeName });
        ul.append(h("li", null, v2 ?? `${communeName(f.commune)} — ${label(f.indicator, L)} : ${fmt(f.value, f.indicator, L)} (${f.year})`));
      }
      box.append(ul);
    }
    if (res.sources?.length) {
      const row = h("div", "lm-row");
      row.append(h("span", "muted small", `${t("ask.sources")} :`));
      const details = new Map((res.source_details || []).map((x) => [x.id, x]));
      for (const id of res.sources) {
        const d = details.get(id);
        const known = st().meta.sources[id] || st().ouvivre?.sources?.[id];
        const chip = h("span", "chip");
        chip.append(extLink(known?.name || d?.name || sourceName(id), known?.url || d?.url || ""));
        row.append(chip);
      }
      box.append(row);
    }
    const laus = (res.communes || []).filter((l) => st().byLau.has(l));
    if (laus.length) {
      const row = h("div", "lm-row");
      for (const l of laus) {
        const b = h("button", "btn small", displayName(st().byLau.get(l), L));
        b.type = "button";
        b.onclick = () => go(`#/c/${l}`);
        row.append(b);
      }
      box.append(row);
    }
    const ovPlaces = new Map((st().ouvivre?.places || []).map((p) => [p.id, p]));
    const crossIds = [...new Set([...(res.places || []), ...(res.communes || [])])];
    const cross = crossIds.map((id) => ovPlaces.get(id)).filter((p) => p && p.country !== "LU");
    if (cross.length) {
      const row = h("div", "lm-row lm-places");
      row.append(h("span", "muted small", `${t("ask.places")} :`));
      for (const p of cross) {
        const b = h("button", "btn small", `${p.name} (${p.country})`);
        b.type = "button";
        b.onclick = () => go(`#/p/${encodeURIComponent(p.id)}`);
        row.append(b);
      }
      box.append(row);
    }
    if (res.followup) {
      const b = h("button", "btn ghost lm-followup", `→ ${res.followup}`);
      b.type = "button";
      b.onclick = () => ask(res.followup, null);
      box.append(b);
    }
    return box;
  }

  function go(hash) {
    if (!matchMedia("(min-width: 900px)").matches) close({ restoreFocus: false }); // phone: show the page, keep the thread
    navigate(hash);
  }

  function render() {
    relabel();
    const ctx = getContext();
    const cl = contextLabel(ctx);
    ctxChip.textContent = cl;
    ctxChip.hidden = !cl;
    const items = [];
    if (!thread.length) {
      items.push(h("p", "lm-chat-intro", t("ask.intro")));
      items.push(chips(suggestionList(), "lm-sugg"));
    }
    thread.forEach((turn, i) => {
      const q = h("div", "lm-msg lm-msg-user");
      q.append(h("p", null, turn.q));
      items.push(q);
      const a = h("div", "lm-msg lm-msg-bot");
      if (turn.status === "pending") {
        const p = h("p", "lm-typing");
        p.append(h("span", "lm-dots"), h("span", null, t("ask.thinking")));
        a.append(p);
      } else if (turn.status === "ok") a.append(answerBox(turn.res));
      else a.append(h("p", "chip warn", turn.status === "needlive" ? t("ask.needlive") : t("ask.offline")));
      items.push(a);
      if (i === thread.length - 1 && turn.status !== "pending") {
        items.push(h("p", "lm-more-title", t("ask.more")));
        items.push(chips(suggestionList().filter((s) => !thread.some((x) => x.q === s.q)).slice(0, 3), "lm-sugg is-compact"));
      }
    });
    log.replaceChildren(...items);
    const lastUser = log.querySelectorAll(".lm-msg-user");
    if (thread.length && lastUser.length) {
      const el = lastUser[lastUser.length - 1];
      body.scrollTop = el.offsetTop - 8;
    } else body.scrollTop = 0;
  }

  async function ask(question, suggestionId) {
    if (!isOpen) open({ focus: false });
    const my = ++seq;
    const history = historyOf(thread);
    const turn = { q: question, sid: suggestionId || null, status: "pending", res: null };
    thread.push(turn);
    if (thread.length > MAX_THREAD) thread = thread.slice(-MAX_THREAD);
    render();
    const L = lang();
    let res = null;
    if (!VIDEO) {
      const ctx = getContext();
      try {
        res = await askApi(question, L, ctx?.lau || null, { signal: abort.signal, history, context: ctx });
        apiDown = false;
      } catch (err) {
        if (err?.name !== "AbortError" || !abort.signal.aborted) apiDown = true;
        res = null;
      }
    }
    if (!res && suggestionId) {
      const fb = await loadFallback();
      res = fb?.[L]?.[suggestionId] || null;
      if (!isValid(res)) res = null;
      if (VIDEO && res) await sleep(1800);
    }
    if (!thread.includes(turn)) return; // conversation reset meanwhile
    turn.status = res ? "ok" : suggestionId ? "offline" : "needlive";
    turn.res = res;
    saveThread(thread);
    if (my === seq) {
      render();
      if (res) highlight([...(res.communes || []), ...(res.places || [])]);
    }
  }

  function open({ focus = true } = {}) {
    if (!isOpen) {
      lastFocus = document.activeElement;
      isOpen = true;
      panel.hidden = false;
      fab.setAttribute("aria-expanded", "true");
      document.body.classList.add("chat-open");
      onOpen();
    }
    render();
    if (focus && !KIOSK) input.focus();
    else if (focus) closeBtn.focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    document.body.classList.remove("chat-open");
    if (restoreFocus) (fab.isConnected ? fab : lastFocus)?.focus?.();
  }

  function reset() {
    abort.abort();
    abort = new AbortController();
    seq += 1;
    thread = [];
    saveThread(thread);
    if (isOpen) render();
  }

  async function typeAndAsk(question, suggestionId, cps = 18) {
    open({ focus: false });
    input.value = "";
    for (const ch of question) {
      input.value += ch;
      await sleep(1000 / cps);
    }
    input.value = "";
    return ask(question, suggestionId);
  }

  relabel();
  fab.setAttribute("aria-expanded", "false");
  return {
    open, close, reset, ask, typeAndAsk,
    refresh: () => { relabel(); if (isOpen) render(); }, // page or language changed
    isOpen: () => isOpen,
    hasThread: () => thread.length > 0,
    lastAnswer: () => [...thread].reverse().find((x) => x.status === "ok")?.res || null,
  };
}
