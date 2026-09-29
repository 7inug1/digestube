import test from "node:test";
import assert from "node:assert/strict";

import { overshoot, timing, withDriftRetry, DRIFT_TOLERANCE_SEC, GAP_TOLERANCE_SEC, PIECE_CHAR_LIMIT } from "../src/lib/drift";

/** 5초마다 한 조각씩 이어지다 lastEndSec 에 끝나는 정상 전사. */
const pieces = (lastEndSec: number) => {
  const out: { text: string; offset: number; duration: number }[] = [];
  for (let t = 0; t < lastEndSec - 2; t += 5) out.push({ text: "말", offset: t * 1000, duration: 2000 });
  out.push({ text: "끝", offset: (lastEndSec - 2) * 1000, duration: 2000 });
  return out;
};
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

/** 85분 영상 60~80분 구간에서 본 모양: 중간에 시각이 튀어 3분이 비고, 끝에 몇 분 치 말이 한 조각에 몰린다. */
const skipped = () => {
  const out: { text: string; offset: number; duration: number }[] = [];
  for (let t = 3600; t < 4013; t += 5) out.push({ text: "말", offset: t * 1000, duration: 2000 });
  for (let t = 4200; t < 4675; t += 5) out.push({ text: "말", offset: t * 1000, duration: 2000 });
  out.push({ text: "몰림".repeat(1400), offset: 4675_000, duration: 125_000 });
  return out;
};

test("조각 사이 가장 긴 빈틈과 가장 긴 조각을 잰다", () => {
  const t = timing(skipped(), 4800);
  assert.equal(t.overshoot, 0);
  assert.equal(t.maxGap, 190);
  assert.equal(t.maxChars, 2800);
  assert.equal(t.ok, false);
  assert.equal(timing(pieces(640), 652).ok, true);
});

test("마지막 조각 뒤로 구간 끝까지 비어 있으면 그것도 빈틈이다", () => {
  const early = pieces(500);
  assert.equal(timing(early, 652).maxGap, 154);
  assert.equal(timing(early, 652).ok, false);
});

test("허용치 안의 빈틈과 조각 길이는 정상으로 본다", () => {
  const quiet = [
    { text: "음악 전", offset: 0, duration: 2000 },
    { text: "x".repeat(PIECE_CHAR_LIMIT), offset: GAP_TOLERANCE_SEC * 1000, duration: 2000 },
  ];
  assert.equal(timing(quiet, GAP_TOLERANCE_SEC + 2).ok, true);
});

test("끝은 맞아도 중간이 비었으면 한 번 다시 받아쓰고, 정상인 쪽을 쓴다", async () => {
  const answers = [{ result: { content: skipped() } }, { result: { content: pieces(4800).map(p => ({ ...p, offset: p.offset + 3600_000 })).filter(p => p.offset < 4800_000) } }];
  let calls = 0;
  const r = await withDriftRetry(async () => { calls++; return answers.shift()!; }, 4800, () => true);
  assert.equal(calls, 2);
  assert.equal(r.retried, true);
  assert.equal(r.gap, 5);
  assert.equal(r.value.result.content.some(p => p.text.length > PIECE_CHAR_LIMIT), false);
});

test("두 번 다 비었으면 빈틈이 짧은 쪽을 쓴다", async () => {
  const worse = { result: { content: skipped() } };
  const better = { result: { content: skipped().filter(p => !(p.offset >= 4013_000 && p.offset < 4100_000)).concat([{ text: "말", offset: 4100_000, duration: 2000 }]) } };
  const answers = [worse, better];
  const r = await withDriftRetry(async () => answers.shift()!, 4800, () => true);
  assert.equal(r.retried, true);
  assert.equal(r.gap, 125);
});
