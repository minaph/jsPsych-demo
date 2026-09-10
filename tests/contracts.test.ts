import assert from "node:assert/strict";
import { test } from "node:test";
import { isHelloAnswer } from "../shared/contracts.ts";

const answer = { id: "187fba02-7787-4b0f-9551-9746e47f7205", response: "hello", rtMs: 1234 };

test("accepts a UUID-backed answer, including zero milliseconds", () => {
  assert.equal(isHelloAnswer(answer), true);
  assert.equal(isHelloAnswer({ ...answer, rtMs: 0 }), true);
});

test("rejects invalid or unexpected fields", () => {
  for (const value of [null, [], "hello", {}, { ...answer, id: "guessable" },
    { ...answer, response: "other" }, { ...answer, extra: "not collected" },
    { id: answer.id, response: "hello" }]) {
    assert.equal(isHelloAnswer(value), false);
  }
});

test("reaction time must be a bounded integer", () => {
  for (const rtMs of [-1, 0.5, NaN, Infinity, "1234", 86_400_001]) {
    assert.equal(isHelloAnswer({ ...answer, rtMs }), false);
  }
});
