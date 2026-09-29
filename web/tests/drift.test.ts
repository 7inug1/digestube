import test from "node:test";
import assert from "node:assert/strict";

import { overshoot, withDriftRetry, DRIFT_TOLERANCE_SEC } from "../src/lib/drift";

const pieces = (lastEndSec: number) => [
  { text: "처음", offset: 0, duration: 2000 },
  { text: "끝", offset: (lastEndSec - 2) * 1000, duration: 2000 },
];
const out = (lastEndSec: number) => ({ result: { content: pieces(lastEndSec) } });

test("마지막 조각이 끝난 시각이 기대한 끝을 얼마나 넘었는지 잰다", () => {
  assert.equal(overshoot(pieces(726), 652), 74);
  assert.equal(overshoot(pieces(640), 652), -12);
  assert.equal(overshoot([], 652), 0);
});

test("밀리지 않았으면 한 번만 받아쓴다", async () => {
  let calls = 0;
  const r = await withDriftRetry(async () => { calls++; return out(640); }, 652, () => true);
  assert.equal(calls, 1);
  assert.equal(r.retried, false);
  assert.equal(r.drift, -12);
});

test("허용치 안의 작은 넘침은 밀림으로 보지 않는다", async () => {
  let calls = 0;
  await withDriftRetry(async () => { calls++; return out(652 + DRIFT_TOLERANCE_SEC); }, 652, () => true);
  assert.equal(calls, 1);
});

test("밀렸으면 한 번 다시 받아쓰고, 다시 받은 쪽이 정상이면 그걸 쓴다", async () => {
  const answers = [out(726), out(641)];
  const r = await withDriftRetry(async () => answers.shift()!, 652, () => true);
  assert.equal(r.retried, true);
  assert.equal(r.drift, -11);
  assert.equal(r.value.result.content.at(-1)!.offset, 639000);
});

test("두 번 다 밀리면 덜 밀린 쪽을 쓴다", async () => {
  const answers = [out(726), out(701)];
  const r = await withDriftRetry(async () => answers.shift()!, 652, () => true);
  assert.equal(r.drift, 49);
});

test("다시 받아쓸 시간이 없으면 다시 부르지 않는다", async () => {
  let calls = 0;
  const r = await withDriftRetry(async () => { calls++; return out(726); }, 652, () => false);
  assert.equal(calls, 1);
  assert.equal(r.retried, false);
  assert.equal(r.drift, 74);
});

test("다시 받아쓰다 실패하면 처음 결과를 쓴다", async () => {
  let calls = 0;
  const r = await withDriftRetry(async () => { if (calls++) throw new Error("붐빔"); return out(726); }, 652, () => true);
  assert.equal(calls, 2);
  assert.equal(r.drift, 74);
});

test("기대한 끝을 모르면 확인하지 않는다", async () => {
  let calls = 0;
  const r = await withDriftRetry(async () => { calls++; return out(726); }, undefined, () => true);
  assert.equal(calls, 1);
  assert.equal(r.drift, null);
});
