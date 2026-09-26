import test from "node:test";
import assert from "node:assert/strict";

import { selectCorpus } from "../src/lib/goldenset-corpus";

const snapshot = {
  corpus: [
    { video: { id: "a" }, revision: "r-a", chunks: [{}, {}] },
    { video: { id: "b" }, revision: "r-b", chunks: [{}] },
  ],
};

const loaded = (over: Partial<Record<string, { revision: string; chunks: number }>> = {}) =>
  ["a", "b", "c"].map(id => {
    const base = { a: { revision: "r-a", chunks: 2 }, b: { revision: "r-b", chunks: 1 }, c: { revision: "r-c", chunks: 5 } }[id]!;
    const v = { ...base, ...(over[id] ?? {}) };
    return { id, revision: v.revision, chunks: Array.from({ length: v.chunks }, () => ({})) };
  });

test("keeps only the snapshot videos, in snapshot order", () => {
  const picked = selectCorpus(loaded().reverse(), snapshot);
  assert.deepEqual(picked.map(v => v.id), ["a", "b"]);
});

test("refuses when a snapshot video is missing from the DB", () => {
  assert.throws(() => selectCorpus(loaded().filter(v => v.id !== "b"), snapshot), /b/);
});

test("refuses when the DB revision differs from the snapshot", () => {
  // 전사나 청킹이 바뀌면 임베딩 비교와 같은 코퍼스라고 말할 수 없다
  assert.throws(() => selectCorpus(loaded({ a: { revision: "r-new", chunks: 2 } }), snapshot), /a/);
});

test("refuses when the paragraph count differs from the snapshot", () => {
  assert.throws(() => selectCorpus(loaded({ b: { revision: "r-b", chunks: 3 } }), snapshot), /b/);
});
