import test from "node:test";
import assert from "node:assert/strict";

import { EMPTY, step, splitLines } from "../src/lib/search-stream";

const hit = (seq: number) => ({ video_id: "v", seq, t: seq * 10, text: `문단 ${seq}`, score: 0.5, title: "", channel: "", duration: 100 });

test("줄바꿈 단위로 자르고 덜 온 줄은 남긴다", () => {
  assert.deepEqual(splitLines('{"a":1}\n{"b":2}\n{"c"'), { lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  assert.deepEqual(splitLines("\n\n"), { lines: [], rest: "" });
});

test("먼저 온 결과를 보여 주고, 다시 세운 순서로 바꾸고, 끝나면 약한 결과인지 적는다", () => {
  let s = step(EMPTY, { t: "hits", hits: [hit(1), hit(2)] });
  assert.equal(s.refining, true);
  assert.deepEqual(s.hits?.map(h => h.seq), [1, 2]);
  s = step(s, { t: "reranked", hits: [hit(2), hit(1)] });
  assert.deepEqual(s.hits?.map(h => h.seq), [2, 1]);
  s = step(s, { t: "done", reranked: true, weak: true });
  assert.equal(s.refining, false);
  assert.equal(s.weak, true);
});

test("결과가 없으면 다시 세우지 않고, 판단 못 한 약함(null)은 약하지 않은 것으로 둔다", () => {
  let s = step(EMPTY, { t: "hits", hits: [] });
  assert.equal(s.refining, false);
  s = step(s, { t: "done", reranked: false, weak: null });
  assert.equal(s.weak, false);
  assert.deepEqual(s.hits, []);
});

test("오류는 메시지를 남기고 결과를 빈 목록으로 닫는다", () => {
  const s = step(EMPTY, { t: "error", error: "잠시 후 다시" });
  assert.equal(s.failed, "잠시 후 다시");
  assert.deepEqual(s.hits, []);
});

test("처리가 다 끝나야 done 이 된다 — 화면은 그때 한 번만 결과를 보여 준다", () => {
  let s = step(EMPTY, { t: "hits", hits: [hit(1), hit(2)] });
  assert.equal(s.done, false);
  s = step(s, { t: "reranked", hits: [hit(2), hit(1)] });
  assert.equal(s.done, false);
  s = step(s, { t: "done", reranked: true, weak: false });
  assert.equal(s.done, true);
  assert.deepEqual(s.hits?.map(h => h.seq), [2, 1]);
  assert.equal(step(EMPTY, { t: "error", error: "x" }).done, true);
});
