import test from "node:test";
import assert from "node:assert/strict";

import { seqFromHash, isPaletteShortcut, splitVideoHref } from "../src/lib/palette";

test("주소의 #ck12 에서 문단 번호를 읽는다", () => {
  assert.equal(seqFromHash("#ck12"), 12);
  assert.equal(seqFromHash("#ck0"), 0);
  assert.equal(seqFromHash("#top"), null);
  assert.equal(seqFromHash(""), null);
});

test("⌘K·Ctrl+K 는 어디서든, / 는 글을 쓰는 중이 아닐 때만 검색 창을 연다", () => {
  assert.equal(isPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false, typing: true }), true);
  assert.equal(isPaletteShortcut({ key: "K", metaKey: false, ctrlKey: true, typing: false }), true);
  assert.equal(isPaletteShortcut({ key: "/", metaKey: false, ctrlKey: false, typing: false }), true);
  assert.equal(isPaletteShortcut({ key: "/", metaKey: false, ctrlKey: false, typing: true }), false);
  assert.equal(isPaletteShortcut({ key: "k", metaKey: false, ctrlKey: false, typing: false }), false);
});

test("영상 문단 주소를 경로와 문단 번호로 나눈다 — 같은 영상이면 새로 불러오지 않으려고", () => {
  assert.deepEqual(splitVideoHref("/videos/byVgbqzYJrs#ck2"), { path: "/videos/byVgbqzYJrs", seq: 2 });
  assert.equal(splitVideoHref("/search?q=x"), null);
});
