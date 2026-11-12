// Help guide: the "?" button of the top bar opens a dialog (side panel on wide screens, full-screen sheet on phones)
// with short plain-language sections and a button that starts the guided tour.
import { h } from "./dom.js";
import { t } from "./i18n.js";

// Section ids, number of paragraphs (`help.<id>.p<n>`) and list items (`help.<id>.li<n>`); `ol` = numbered list.
export const SECTIONS = [
  { id: "what", p: 2 },
  { id: "how", li: 3, ol: true },
  { id: "read", li: 7 },
  { id: "maps", li: 3 },
  { id: "ask", li: 3 },
  { id: "data", p: 1, li: 5, link: "#/sources" },
];

export function createHelp({ onTour }) {
  const btn = document.getElementById("help-btn");
  let dlg = null;

  function build() {
    const d = h("dialog", "lm-help");
    d.id = "help-panel";
    d.setAttribute("aria-labelledby", "lm-help-title");
    const head = h("div", "lm-help-head");
    const titleBox = h("div", "lm-help-titlebox");
    const title = h("h2", "lm-help-title", t("help.title"));
    title.id = "lm-help-title";
    titleBox.append(h("p", "eyebrow", t("help.eyebrow")), title);
    const x = h("button", "ov-x-btn lm-help-close", "×");
    x.type = "button";
    x.setAttribute("aria-label", t("ov.close"));
    x.onclick = () => close();
    head.append(titleBox, x);

    const tour = h("button", "btn primary lm-help-tour", t("help.tour"));
    tour.type = "button";
    tour.onclick = () => { close({ restoreFocus: false }); onTour?.(); };

    const body = h("div", "lm-help-body");
    body.append(tour);
    for (const s of SECTIONS) {
      const sec = h("section", "lm-help-sec");
      sec.dataset.sec = s.id;
      const hid = `lm-help-${s.id}`;
      const h3 = h("h3", "lm-help-h", t(`help.${s.id}.h`));
      h3.id = hid;
      sec.setAttribute("aria-labelledby", hid);
      sec.append(h3);
      for (let n = 1; n <= (s.p || 0); n += 1) sec.append(h("p", null, t(`help.${s.id}.p${n}`)));
      if (s.li) {
        const list = h(s.ol ? "ol" : "ul", "lm-help-list");
        for (let n = 1; n <= s.li; n += 1) list.append(h("li", null, t(`help.${s.id}.li${n}`)));
        sec.append(list);
      }
      if (s.link) {
        const a = h("a", "btn small lm-help-link", t(`help.${s.id}.link`));
        a.href = s.link;
        a.onclick = () => close({ restoreFocus: false });
        sec.append(a);
      }
      body.append(sec);
    }
    d.append(head, body);
    d.addEventListener("close", () => { d.remove(); if (dlg === d) dlg = null; btn.setAttribute("aria-expanded", "false"); });
    d.addEventListener("click", (e) => { if (e.target === d) close(); });
    return d;
  }

  let restore = true;
  function open() {
    if (dlg) return;
    dlg = build();
    restore = true;
    dlg.addEventListener("close", () => { if (restore) btn.focus({ preventScroll: true }); });
    document.body.append(dlg);
    dlg.showModal();
    btn.setAttribute("aria-expanded", "true");
    dlg.querySelector(".lm-help-close").focus();
  }
  function close({ restoreFocus = true } = {}) {
    if (!dlg) return;
    restore = restoreFocus;
    dlg.close();
  }
  function relabel() {
    btn.setAttribute("aria-label", t("help.btn"));
    btn.title = t("help.btn");
    if (dlg) { close({ restoreFocus: false }); open(); }
  }

  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-controls", "help-panel");
  btn.setAttribute("aria-expanded", "false");
  btn.onclick = () => open();
  relabel();
  return { open, close, isOpen: () => Boolean(dlg), relabel };
}
