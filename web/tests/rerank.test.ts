import test from "node:test";
import assert from "node:assert/strict";

import { readScores, reorder, rerank } from "../src/lib/rerank";

test("reranker scores are read only in the one-per-input shape", () => {
  const perInput = [[{ label: "LABEL_0", score: 6.7 }], [{ label: "LABEL_0", score: -11 }]];
  assert.deepEqual(readScores(perInput, 2), [6.7, -11]);
  // top_k 를 빠뜨리면 모든 점수가 한 배열에 묶여 온다(2026-09-19 실제로 겪음) — 쓰지 않는다
  assert.equal(readScores([[{ score: 6.7 }, { score: -11 }]], 2), null);
  assert.equal(readScores(perInput, 3), null);
  assert.equal(readScores({ error: "loading" }, 2), null);
});

test("reorder sorts by score and keeps vector order on ties", () => {
  assert.deepEqual(reorder(["a", "b", "c", "d"], [1, 5, 5, 0], 3), ["b", "c", "a"]);
});

test("rerank reports timeout and errors instead of throwing", async () => {
  const saved = process.env.HF_TOKEN;
  process.env.HF_TOKEN = "test";
  try {
    // 응답이 500ms 뒤에야 오는 서버. 20ms 타임아웃이 먼저 끊어야 한다.
    const slow: typeof fetch = (_u, init) => new Promise((resolve, reject) => {
      const late = setTimeout(() => resolve(new Response("[]")), 500);
      init?.signal?.addEventListener("abort", () => { clearTimeout(late); reject(init.signal!.reason); });
    });
    const timedOut = await rerank("q", ["a"], 20, slow);
    assert.ok("error" in timedOut && timedOut.error === "timeout", JSON.stringify(timedOut));

    const down: typeof fetch = async () => new Response("busy", { status: 503 });
    assert.deepEqual(await rerank("q", ["a"], 1000, down), { error: "error", detail: "HTTP 503" });

    const ok: typeof fetch = async () => new Response(JSON.stringify([[{ score: 2 }], [{ score: 9 }]]));
    assert.deepEqual(await rerank("q", ["a", "b"], 1000, ok), { scores: [2, 9] });
  } finally {
    if (saved === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = saved;
  }
});
