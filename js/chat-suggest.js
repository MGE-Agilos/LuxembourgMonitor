// Contextual suggestions of the "Ask the data" bubble (pure, tested by chat-suggest.test.js).
// A suggestion whose text equals one of suggestions.json keeps that id, hence its pre-computed offline answer;
// the others need the live AI and are left out when it is not reachable (padded with suggestions.json ones).

const AT = {
  en: { kirchberg: "at Kirchberg", "lux-gare": "at the station (Gare)", "cloche-dor": "at Cloche d'Or", belval: "at Belval",
    findel: "at Findel", "lux-city": "in Luxembourg City centre" },
  fr: { kirchberg: "au Kirchberg", "lux-gare": "à la Gare", "cloche-dor": "à la Cloche d'Or", belval: "à Belval",
    findel: "au Findel", "lux-city": "au centre de Luxembourg-Ville" },
};
const NEAR = {
  en: { kirchberg: "near Kirchberg", "lux-gare": "near the station (Gare)", "cloche-dor": "near Cloche d'Or", belval: "near Belval",
    findel: "near Findel", "lux-city": "near Luxembourg City centre" },
  fr: { kirchberg: "près du Kirchberg", "lux-gare": "près de la Gare", "cloche-dor": "près de la Cloche d'Or", belval: "près de Belval",
    findel: "près du Findel", "lux-city": "près du centre de Luxembourg-Ville" },
};

const T = {
  en: {
    hub1: "Live in Thionville or Luxembourg City if I work {at}?",
    hub2: "Where can a family rent {near} for less?",
    hub3: "What is left to live in {place} if I work {at}?",
    c1: "How indebted is {name} per resident?",
    c2: "How long from {name} to Kirchberg by public transport?",
    c3: "How much does it cost to rent in {name}?",
    p1: "What is left to live in {name} if I work at Kirchberg?",
    p2: "How long from {name} to Kirchberg by public transport?",
    p3: "Compare {name} with Luxembourg City for a couple.",
    pays1: "How many cross-border workers come to Luxembourg every day?",
    cmp1: "Which of these places is cheapest to rent?",
    cmp2: "Which of these places is quickest to reach Kirchberg?",
  },
  fr: {
    hub1: "Vivre à Thionville ou à Luxembourg-Ville si je travaille {at} ?",
    hub2: "Où une famille peut-elle louer moins cher {near} ?",
    hub3: "Que reste-t-il pour vivre à {place} si je travaille {at} ?",
    c1: "Quelle est la dette de {name} par habitant ?",
    c2: "Combien de temps faut-il depuis {name} jusqu'au Kirchberg en transports en commun ?",
    c3: "Combien coûte un loyer à {name} ?",
    p1: "Que reste-t-il pour vivre à {name} si je travaille au Kirchberg ?",
    p2: "Combien de temps faut-il depuis {name} jusqu'au Kirchberg en transports en commun ?",
    p3: "Comparer {name} et Luxembourg-Ville pour un couple.",
    pays1: "Combien de frontaliers viennent travailler au Luxembourg chaque jour ?",
    cmp1: "Lequel de ces lieux a le loyer le plus bas ?",
    cmp2: "Lequel de ces lieux est le plus rapide pour aller au Kirchberg ?",
  },
};

const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, () => String(v)), s);

/**
 * @param ctx    page context ({page, hub, lau, place, ...} as sent to the API)
 * @param opts   {lang, suggestions (suggestions.json), names: {lau?, place?} display names, live: boolean, max}
 * @returns [{q, sid|null}]
 */
export function contextSuggestions(ctx, { lang = "en", suggestions = {}, names = {}, live = true, max = 4 } = {}) {
  const L = lang === "fr" ? "fr" : "en";
  const tr = (k, vars = {}) => fill(T[L][k], vars);
  const sugg = (id) => (suggestions[id] ? suggestions[id][L] || suggestions[id].en : null);
  const list = [];
  const add = (q) => { if (q && !list.includes(q)) list.push(q); };
  const page = ctx?.page;
  if (page === "ouvivre" && ctx.hub) {
    const vars = { at: AT[L][ctx.hub], near: NEAR[L][ctx.hub] };
    add(tr("hub1", vars));
    add(tr("hub2", vars));
    if (ctx.place && names.place) add(tr("hub3", { ...vars, place: names.place }));
    else add(sugg("q3"));
    add(sugg("q6"));
  } else if (page === "commune" && names.lau) {
    add(tr("c1", { name: names.lau }));
    add(tr("c2", { name: names.lau }));
    add(tr("c3", { name: names.lau }));
    add(sugg("q4"));
  } else if (page === "place" && names.place) {
    add(tr("p1", { name: names.place }));
    add(tr("p2", { name: names.place }));
    add(tr("p3", { name: names.place }));
    add(sugg("q6"));
  } else if (page === "pays") {
    add(sugg("q4"));
    add(sugg("q6"));
    add(tr("pays1"));
    add(sugg("q3"));
  } else if (page === "compare") {
    add(tr("cmp1"));
    add(tr("cmp2"));
    add(sugg("q1"));
  } else {
    for (const id of Object.keys(suggestions)) add(sugg(id));
    max = Math.max(max, list.length);
  }
  const idOf = new Map(Object.keys(suggestions).map((id) => [sugg(id), id]));
  let out = list.map((q) => ({ q, sid: idOf.get(q) || null }));
  if (!live) {
    out = out.filter((x) => x.sid);
    for (const id of Object.keys(suggestions)) {
      if (out.length >= Math.min(max, 4) && page) break;
      if (!out.some((x) => x.sid === id)) out.push({ q: sugg(id), sid: id });
    }
  }
  return out.slice(0, max);
}
