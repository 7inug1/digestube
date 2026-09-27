import test from "node:test";
import assert from "node:assert/strict";

import { decide, HIGH, LOW, FALLBACK } from "../src/lib/judge";

const never = async () => { throw new Error("부르면 안 된다"); };

test("경계는 -2 · -8, AI 가 실패하면 -3 으로 판단한다(2026-09-27 골든셋 dev)", () => {
  assert.deepEqual([HIGH, LOW, FALLBACK], [-2, -8, -3]);
});

test("확실히 높거나 낮으면 AI 를 부르지 않는다", async () => {
  assert.deepEqual(await decide(-2, never), { weak: false, by: "score" });
  assert.deepEqual(await decide(4.1, never), { weak: false, by: "score" });
  assert.deepEqual(await decide(-8.01, never), { weak: true, by: "score" });
});

test("애매한 구간만 AI 판정을 따른다", async () => {
  assert.deepEqual(await decide(-5, async () => ({ answerable: false, why: "가격 정보 없음" })),
    { weak: true, by: "ai", why: "가격 정보 없음" });
  assert.deepEqual(await decide(-3.5, async () => ({ answerable: true, why: "직접 나옴" })),
    { weak: false, by: "ai", why: "직접 나옴" });
});

test("AI 가 실패하거나 늦으면 점수 기준(-3)으로 판단한다 — 검색이 멈추지 않게", async () => {
  const fail = async () => { throw new Error("timeout"); };
  assert.deepEqual(await decide(-3.5, fail), { weak: true, by: "fallback" });
  assert.deepEqual(await decide(-2.5, fail), { weak: false, by: "fallback" });
});
