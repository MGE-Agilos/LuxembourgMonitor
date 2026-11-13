import assert from "node:assert/strict";
import { test } from "node:test";
import { validateVisitor } from "./gate.js";

test("validateVisitor: names required, e-mail optional but valid, consent needs an e-mail", () => {
  assert.deepEqual(validateVisitor({ first: " Anne ", last: "Muller" }),
    { errors: {}, value: { first_name: "Anne", last_name: "Muller", email: null, contact_ok: false } });
  assert.deepEqual(validateVisitor({}).errors, { first: "err_first", last: "err_last" });
  assert.equal(validateVisitor({ first: "A", last: "B", email: "nope" }).errors.email, "err_email");
  assert.equal(validateVisitor({ first: "A", last: "B", contact: true }).errors.email, "err_contact");
  assert.equal(validateVisitor({ first: "A", last: "B", email: "A@B.LU", contact: true }).value.email, "a@b.lu");
  assert.equal(validateVisitor({ first: "x".repeat(61), last: "B" }).errors.first, "err_first");
});
