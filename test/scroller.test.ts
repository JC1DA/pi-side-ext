import assert from "node:assert/strict";
import { test } from "node:test";
import { Scroller } from "../src/scroller.ts";

test("follows the end while content grows", () => {
  const s = new Scroller();
  assert.equal(s.layout(5, 10), 0); // fits: no scroll
  assert.equal(s.layout(30, 10), 20);
  assert.equal(s.layout(40, 10), 30);
});

test("scrolling up stops following and keeps the view stable", () => {
  const s = new Scroller();
  s.layout(30, 10);
  s.scrollBy(-5);
  assert.equal(s.follow, false);
  assert.equal(s.layout(50, 10), 15); // new output does not move the view
});

test("scrolling back to the bottom resumes following", () => {
  const s = new Scroller();
  s.layout(30, 10);
  s.scrollBy(-5);
  s.scrollBy(100); // clamped to the bottom
  assert.equal(s.follow, true);
  assert.equal(s.layout(40, 10), 30);
});

test("clamps at the top and to shrinking content", () => {
  const s = new Scroller();
  s.layout(30, 10);
  s.scrollBy(-100);
  assert.equal(s.top, 0);
  s.scrollBy(15);
  assert.equal(s.layout(12, 10), 2); // content shrank below the old position
});

test("toEnd jumps to the bottom and follows", () => {
  const s = new Scroller();
  s.layout(30, 10);
  s.scrollBy(-10);
  s.toEnd();
  assert.equal(s.follow, true);
  assert.equal(s.layout(35, 10), 25);
});
