import assert from "node:assert/strict";
import { test } from "node:test";
import { STEPS, activeSteps, anchorOf, placePopover, shouldAutoStart } from "./tour.js";

const all = () => true;

test("wide layout keeps every step but the phone-only one", () => {
  const ids = activeSteps(STEPS, { phone: false, visible: all }).map((s) => s.id);
  assert.deepEqual(ids, ["q", "sit", "rank", "detail", "time", "minutes", "ask", "help"]);
});

test("phone layout adds the settings toggle and uses the phone anchors", () => {
  const steps = activeSteps(STEPS, { phone: true, visible: all });
  assert.equal(steps.length, 9);
  assert.ok(steps.some((s) => s.id === "settings"));
  assert.equal(anchorOf(steps.find((s) => s.id === "detail"), true), "#panel .ov-list .ov-card");
  assert.equal(anchorOf(steps.find((s) => s.id === "detail"), false), "#panel .ov-table tbody tr");
});

test("steps whose anchor is missing are skipped", () => {
  const visible = (sel) => !sel.includes("ask-fab") && !sel.includes("gr-modes");
  const ids = activeSteps(STEPS, { phone: false, visible }).map((s) => s.id);
  assert.ok(!ids.includes("ask") && !ids.includes("minutes"));
  assert.equal(ids.length, 6);
  assert.deepEqual(activeSteps(STEPS, { phone: false, visible: () => false }), []);
});

test("auto-start once, never on the kiosk nor in video mode, forced by ?tour=1", () => {
  assert.equal(shouldAutoStart({}), true);
  assert.equal(shouldAutoStart({ seen: true }), false);
  assert.equal(shouldAutoStart({ kiosk: true }), false);
  assert.equal(shouldAutoStart({ video: true }), false);
  assert.equal(shouldAutoStart({ video: true, seen: true, forced: true }), true);
  assert.equal(shouldAutoStart({ kiosk: true, forced: true }), true);
});

const vp = { width: 1440, height: 900 };
const pop = { width: 380, height: 200 };
const inside = (p) => p.left >= 0 && p.top >= 0 && p.left + pop.width <= vp.width && p.top + pop.height <= vp.height;

test("popover goes below a target near the top, arrow pointing at its centre", () => {
  const p = placePopover({ left: 100, top: 80, width: 300, height: 40 }, pop, vp);
  assert.equal(p.side, "bottom");
  assert.equal(p.top, 80 + 40 + 14);
  assert.ok(inside(p));
  assert.equal(p.left + p.arrow, 250); // arrow under the target centre
});

test("popover goes above a target near the bottom, clamped to the viewport edge", () => {
  const p = placePopover({ left: 1380, top: 820, width: 56, height: 56 }, pop, vp); // the chat bubble
  assert.equal(p.side, "top");
  assert.ok(inside(p));
  assert.ok(p.arrow >= 28 && p.arrow <= pop.width - 28);
});

test("tall target: popover on the free side, or over it when no side fits", () => {
  const left = placePopover({ left: 800, top: 120, width: 620, height: 760 }, pop, vp);
  assert.equal(left.side, "left");
  assert.ok(inside(left));
  const over = placePopover({ left: 0, top: 0, width: 1440, height: 900 }, pop, vp);
  assert.equal(over.side, "over");
  assert.equal(over.arrow, null);
  assert.ok(inside(over));
});

test("phone: popover never wider than the screen and kept inside it", () => {
  const phone = { width: 390, height: 844 };
  const pp = { width: 366, height: 230 };
  const p = placePopover({ left: 16, top: 300, width: 358, height: 60 }, pp, phone);
  assert.equal(p.side, "bottom");
  assert.ok(p.left >= 12 && p.left + pp.width <= phone.width - 12 + 0.01);
});
