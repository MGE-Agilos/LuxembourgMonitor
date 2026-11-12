import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contextSuggestions } from "./chat-suggest.js";

const suggestions = JSON.parse(readFileSync(new URL("../data/suggestions.json", import.meta.url), "utf8"));

test("home with Kirchberg reuses the q1 suggestion (offline answer) in both languages", () => {
  for (const lang of ["en", "fr"]) {
    const s = contextSuggestions({ page: "ouvivre", hub: "kirchberg" }, { lang, suggestions });
    assert.equal(s[0].sid, "q1");
    assert.equal(s[0].q, suggestions.q1[lang]);
    assert.ok(s.length >= 3 && s.length <= 4);
  }
  const belval = contextSuggestions({ page: "ouvivre", hub: "belval" }, { lang: "fr", suggestions });
  assert.equal(belval[1].sid, "q2");
  assert.equal(belval[1].q, suggestions.q2.fr);
});

test("commune and place pages name the place; offline keeps only questions with a fallback", () => {
  const live = contextSuggestions({ page: "commune", lau: "1005" }, { lang: "en", suggestions, names: { lau: "Echternach" } });
  assert.equal(live[0].q, "How indebted is Echternach per resident?");
  assert.equal(live[0].sid, null);
  const off = contextSuggestions({ page: "commune", lau: "1005" }, { lang: "en", suggestions, names: { lau: "Echternach" }, live: false });
  assert.ok(off.length >= 3 && off.every((x) => x.sid));
  const place = contextSuggestions({ page: "place", place: "de:ags:07211000" }, { lang: "fr", suggestions, names: { place: "Trier" } });
  assert.match(place[0].q, /Trier/);
});

test("default page lists the suggestions.json questions", () => {
  const s = contextSuggestions({ page: "other" }, { lang: "en", suggestions });
  assert.deepEqual(s.map((x) => x.sid), Object.keys(suggestions));
  assert.deepEqual(contextSuggestions(null, { suggestions }).map((x) => x.sid), Object.keys(suggestions));
});
