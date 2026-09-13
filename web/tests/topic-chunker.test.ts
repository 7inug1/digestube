import test from "node:test";
import assert from "node:assert/strict";

import { topicChunk } from "../src/lib/topic-chunker";
import type { Piece } from "../src/lib/chunker";

const pieces: Piece[] = [
  { text: "첫 번째 주제를 설명합니다.", offset: 0, duration: 1000 },
  { text: "같은 주제의 예시입니다. ".repeat(30), offset: 1000, duration: 1000 },
  { text: "여기서 세부 내용이 바뀝니다.", offset: 2000, duration: 1000 },
  { text: "두 번째 주제를 시작합니다.", offset: 3000, duration: 1000 },
];

test("topic chunker applies the large-topic and long-topic boundaries without rewriting text", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const payload = calls === 1 ? { starts: [1, 4] } : { topics: [{ topic: 1, starts: [1, 3] }] };
    return new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }));
  };
  try {
    const result = await topicChunk(pieces);
    assert.equal(result.source, "model");
    assert.deepEqual(result.starts, [1, 3, 4]);
    assert.equal(calls, 2);
    assert.equal(
      result.chunks.map(c => c.text.replace(/\s+/gu, "")).join(""),
      pieces.map(p => p.text.replace(/\s+/gu, "")).join(""),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("topic chunker falls back to code when the model is unavailable", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const result = await topicChunk(pieces.slice(0, 2));
    assert.equal(result.source, "fallback");
    assert.match(result.problems[0], /offline/);
    assert.ok(result.chunks.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
