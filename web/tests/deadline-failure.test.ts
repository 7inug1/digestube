import test from "node:test";
import assert from "node:assert/strict";

import { timeoutFor, OutOfTime, MIN_CALL_MS } from "../src/lib/deadline";
import { describe, redact } from "../src/lib/failure";
import { topicChunk } from "../src/lib/topic-chunker";
import { label } from "../src/lib/outline";

test("inner timeouts never outlive the route budget", () => {
  assert.equal(timeoutFor("x", 30000), 30000);
  assert.equal(timeoutFor("x", 30000, 1_000_000, 0), 30000);
  assert.equal(timeoutFor("x", 30000, 10_000, 0), 10_000);
  assert.throws(() => timeoutFor("x", 30000, MIN_CALL_MS - 1, 0), OutOfTime);
});

test("out of time falls back without calling the model", async () => {
  const saved = { key: process.env.GEMINI_API_KEY, fetch: globalThis.fetch };
  process.env.GEMINI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}"); };
  try {
    const past = Date.now() - 1;
    const pieces = [{ text: "첫 문장입니다.", offset: 0, duration: 1000 }, { text: "둘째 문장입니다.", offset: 1000, duration: 1000 }];
    const topic = await topicChunk(pieces, past);
    assert.equal(topic.source, "fallback");
    assert.ok(topic.chunks.length > 0);
    const item = await label({ seq: 0, t: 0, text: "첫 문장입니다. 뒤 문장입니다." }, undefined, past);
    assert.equal(item.source, "fallback");
    assert.equal(item.label, "첫 문장입니다.");
    assert.equal(calls, 0);
  } finally {
    process.env.GEMINI_API_KEY = saved.key;
    globalThis.fetch = saved.fetch;
  }
});

test("failure record hides secrets and names the kind of failure", () => {
  const leaked = redact("GET https://x/models?key=AIzaSyA1234567890abcdefghijklmnop&alt=sse Bearer hf_abcdefghijklmnopqrst");
  assert.ok(!leaked.includes("AIzaSy") && !leaked.includes("hf_abc"), leaked);

  const at = new Date("2026-09-19T00:00:00Z");
  assert.deepEqual(describe(new Error("전사 서버가 지금 붐벼요. 잠시 뒤 다시 눌러주세요."), "transcribe", at),
    { stage: "transcribe", kind: "overloaded", status: null, message: "전사 서버가 지금 붐벼요. 잠시 뒤 다시 눌러주세요.", at: at.toISOString() });
  assert.equal(describe(Object.assign(new Error("aborted"), { name: "TimeoutError" }), "save").kind, "timeout");
  assert.equal(describe(new Error("전사에 실패했습니다 (404): not found"), "transcribe").kind, "http");
  assert.equal(describe(new Error("전사에 실패했습니다 (404): not found"), "transcribe").status, 404);
  assert.equal(describe(new Error("fetch failed"), "save").kind, "network");
  assert.ok(describe(new Error("x".repeat(500)), "save").message.length <= 200);
});
