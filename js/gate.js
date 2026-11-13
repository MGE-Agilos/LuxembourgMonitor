// Welcome screen: first name + last name (required), e-mail (optional, with consent to be recontacted), logged in
// Supabase (luxembourg_monitor.visitors) through the luxembourg-monitor-visit Edge Function.
// - web: shown before the app on the first visit, then remembered in this browser (localStorage "lm.visitor");
// - kiosk: the attract loop runs freely; the first touch opens the screen; relock() (idle reset) asks the next visitor;
// - video mode and checks (localStorage "lm.gate" = "off") never show it.
// A visitor is never blocked by the network: if the log fails, the entry is queued locally and retried later.

export const NAME_MAX = 60;
export const EMAIL_MAX = 200;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PENDING_KEY = "lm.visit.pending";
const VISITOR_KEY = "lm.visitor";
const TIMEOUT_MS = 5000;

const STR = {
  en: {
    eyebrow: "Data Summit Luxembourg 2026 · Beyond Data",
    title: "Welcome",
    lead: "You work in Luxembourg: where to live? Tell us who you are, then explore.",
    first: "First name",
    last: "Last name",
    email: "E-mail (optional)",
    contact: "Beyond Data may contact me about this project",
    enter: "Enter",
    sending: "One moment…",
    privacy: "Beyond Data (Agilos) records your name to count the visits of its Data Summit stand. Your e-mail is used only if you tick the box. Ask the team to have your data deleted at any time.",
    err_first: "Please enter your first name.",
    err_last: "Please enter your last name.",
    err_email: "This e-mail address does not look valid.",
    err_contact: "Add your e-mail so we can contact you.",
  },
  fr: {
    eyebrow: "Data Summit Luxembourg 2026 · Beyond Data",
    title: "Bienvenue",
    lead: "Vous travaillez au Luxembourg : où vivre ? Dites-nous qui vous êtes, puis explorez.",
    first: "Prénom",
    last: "Nom",
    email: "E-mail (facultatif)",
    contact: "Beyond Data peut me recontacter au sujet de ce projet",
    enter: "Entrer",
    sending: "Un instant…",
    privacy: "Beyond Data (Agilos) enregistre votre nom pour compter les visites de son stand au Data Summit. Votre e-mail n'est utilisé que si vous cochez la case. Demandez à l'équipe la suppression de vos données à tout moment.",
    err_first: "Indiquez votre prénom.",
    err_last: "Indiquez votre nom.",
    err_email: "Cette adresse e-mail ne semble pas valide.",
    err_contact: "Ajoutez votre e-mail pour que nous puissions vous recontacter.",
  },
};

const clean = (v) => String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

// Pure validation (mirrors the Edge Function): returns { errors: {field: code}, value }.
export function validateVisitor({ first = "", last = "", email = "", contact = false } = {}) {
  const value = { first_name: clean(first), last_name: clean(last), email: clean(email).toLowerCase() || null, contact_ok: Boolean(contact) };
  const errors = {};
  if (!value.first_name || value.first_name.length > NAME_MAX) errors.first = "err_first";
  if (!value.last_name || value.last_name.length > NAME_MAX) errors.last = "err_last";
  if (value.email && (value.email.length > EMAIL_MAX || !EMAIL_RE.test(value.email))) errors.email = "err_email";
  if (value.contact_ok && !value.email) errors.email = "err_contact";
  return { errors, value };
}

function store(kind) {
  try { return kind === "local" ? localStorage : null; } catch { return null; }
}
function readPending() {
  try { return JSON.parse(store("local")?.getItem(PENDING_KEY) || "[]"); } catch { return []; }
}
function writePending(list) {
  try { store("local")?.setItem(PENDING_KEY, JSON.stringify(list.slice(-50))); } catch { /* storage unavailable */ }
}

export function createGate({ url, kiosk = false, video = false, getLang, setLang, onAdmit = () => {}, fetchImpl = (...a) => fetch(...a) }) {
  const ls = store("local");
  let disabled = video;
  try { if (ls?.getItem("lm.gate") === "off") disabled = true; } catch { /* ignore */ }
  let admitted = disabled || (!kiosk && ls?.getItem(VISITOR_KEY) === "1");
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  if (admitted) resolveReady();

  async function post(row) {
    if (!url) throw new Error("no url");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(row), signal: ctl.signal });
      if (r.status === 400) return "invalid";
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "ok";
    } finally {
      clearTimeout(timer);
    }
  }
  // Retry the entries that could not be logged earlier (network down at the stand, for instance).
  async function flush() {
    const list = readPending();
    if (!list.length) return;
    const left = [];
    for (const row of list) {
      try { if ((await post(row)) !== "ok") continue; } catch { left.push(row); }
    }
    writePending(left);
  }

  let dlg = null;
  const s = (k) => (STR[getLang()] || STR.en)[k];

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "lm-gate";
    dlg.setAttribute("aria-labelledby", "lm-gate-title");
    dlg.addEventListener("cancel", (e) => e.preventDefault()); // Esc does not skip the screen
    document.body.append(dlg);
  }

  function render(values = {}, errors = {}) {
    if (!dlg) build();
    const lang = getLang();
    dlg.innerHTML = `
      <div class="lm-gate-card">
        <div class="lm-gate-top">
          <p class="eyebrow"></p>
          <div class="seg lm-gate-lang" role="group" aria-label="Language">
            <button type="button" data-l="en" aria-pressed="${lang === "en"}">EN</button>
            <button type="button" data-l="fr" aria-pressed="${lang === "fr"}">FR</button>
          </div>
        </div>
        <h1 id="lm-gate-title"></h1>
        <p class="lm-gate-lead"></p>
        <form novalidate>
          <div class="lm-gate-row">
            <label class="lm-gate-f"><span data-k="first"></span><input name="first" autocomplete="given-name" maxlength="${NAME_MAX}" required><small class="err" data-e="first"></small></label>
            <label class="lm-gate-f"><span data-k="last"></span><input name="last" autocomplete="family-name" maxlength="${NAME_MAX}" required><small class="err" data-e="last"></small></label>
          </div>
          <label class="lm-gate-f"><span data-k="email"></span><input name="email" type="email" autocomplete="email" inputmode="email" maxlength="${EMAIL_MAX}"><small class="err" data-e="email"></small></label>
          <label class="lm-gate-check"><input name="contact" type="checkbox"><span data-k="contact"></span></label>
          <button class="btn primary lm-gate-go" type="submit"></button>
          <p class="lm-gate-privacy"></p>
        </form>
      </div>`;
    dlg.querySelector(".eyebrow").textContent = s("eyebrow");
    dlg.querySelector("h1").textContent = s("title");
    dlg.querySelector(".lm-gate-lead").textContent = s("lead");
    for (const el of dlg.querySelectorAll("[data-k]")) el.textContent = s(el.dataset.k);
    dlg.querySelector(".lm-gate-go").textContent = s("enter");
    dlg.querySelector(".lm-gate-privacy").textContent = s("privacy");
    const form = dlg.querySelector("form");
    form.first.value = values.first ?? "";
    form.last.value = values.last ?? "";
    form.email.value = values.email ?? "";
    form.contact.checked = Boolean(values.contact);
    for (const [f, code] of Object.entries(errors)) {
      dlg.querySelector(`[data-e="${f}"]`).textContent = s(code);
      form[f].setAttribute("aria-invalid", "true");
    }
    const read = () => ({ first: form.first.value, last: form.last.value, email: form.email.value, contact: form.contact.checked });
    for (const b of dlg.querySelectorAll("[data-l]")) {
      b.addEventListener("click", () => { setLang(b.dataset.l); render(read()); });
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { errors: errs, value } = validateVisitor(read());
      if (Object.keys(errs).length) {
        render(read(), errs);
        dlg.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      const go = form.querySelector(".lm-gate-go");
      go.disabled = true;
      go.textContent = s("sending");
      const row = { ...value, lang: getLang() === "fr" ? "fr" : "en", mode: kiosk ? "kiosk" : "web" };
      let res = "ok";
      try {
        res = await post(row);
      } catch (err) {
        console.warn("visit log failed, queued:", err?.message || err);
        writePending([...readPending(), row]);
      }
      if (res === "invalid") { // the server disagrees with the local check: show the form again
        go.disabled = false;
        go.textContent = s("enter");
        return;
      }
      admit();
      flush();
    });
    const focus = errors && Object.keys(errors).length ? null : form.first;
    focus?.focus();
  }

  function show() {
    if (admitted || disabled) return;
    render();
    if (!dlg.open) dlg.showModal();
    dlg.querySelector("input[name=first]")?.focus();
  }
  function admit() {
    admitted = true;
    if (!kiosk) try { ls?.setItem(VISITOR_KEY, "1"); } catch { /* ignore */ }
    if (dlg?.open) dlg.close();
    if (dlg) dlg.innerHTML = ""; // the next kiosk visitor never sees the previous name
    resolveReady();
    onAdmit();
  }

  // Kiosk: while locked, the first touch anywhere outside the screen opens it instead of acting on the app.
  if (kiosk && !disabled) {
    const block = (e) => {
      if (admitted || dlg?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "pointerdown" || e.type === "keydown") show();
    };
    for (const ev of ["pointerdown", "click", "keydown"]) addEventListener(ev, block, { capture: true });
  }

  if (!admitted) {
    if (!kiosk) show();
  }
  if (!disabled) flush();

  return {
    ready,
    isOpen: () => Boolean(dlg?.open),
    isAdmitted: () => admitted,
    // kiosk idle reset: the next visitor must introduce themselves; a half-filled form is cleared
    relock() {
      if (!kiosk || disabled) return;
      admitted = false;
      if (dlg?.open) dlg.close();
      if (dlg) dlg.innerHTML = "";
    },
  };
}
