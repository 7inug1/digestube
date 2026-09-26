import test from "node:test";
import assert from "node:assert/strict";

import { weakMatch, WEAK_SCORE } from "../src/lib/rerank";

test("후보 중 가장 높은 리랭커 점수가 기준보다 낮으면 약한 결과다", () => {
  assert.equal(weakMatch([-7.2, -5.4, -9]), true);
  assert.equal(weakMatch([-7.2, 0.7, -9]), false);
  // 기준값과 같으면 약하다고 하지 않는다 — 경계에서 경고를 아낀다
  assert.equal(weakMatch([WEAK_SCORE]), false);
});

test("점수가 없으면 판단하지 않는다", () => {
  assert.equal(weakMatch([]), null);
});

test("개발 평가 12문항(2026-09-19, 후보 10개)에서 11개를 가른다", () => {
  // 1위 리랭커 점수. 개발 반복에 쓴 질문이라 독립 검증이 아니다 — 기준값을 고른 근거로만 남긴다.
  const answerable = [-6.99, 1.85, 9.86, 4.52, -1.61, -3.13, 0.71, -3.2];
  const noAnswer = [-7.18, -7.66, -5.44, -7.04];
  const right = answerable.filter(s => !weakMatch([s])).length + noAnswer.filter(s => weakMatch([s])).length;
  assert.equal(right, 11);
});
