import test from "node:test";
import assert from "node:assert/strict";

import { audioPart } from "../src/lib/audio";

test("음성 파일을 Gemini 인라인 입력으로 만든다 — 확장자로 형식을 정한다", () => {
  const p = audioPart("/tmp/a.mp3", Buffer.from("abc"));
  assert.deepEqual(p, { inlineData: { mimeType: "audio/mp3", data: Buffer.from("abc").toString("base64") } });
  assert.equal(audioPart("x.M4A", Buffer.from("")).inlineData.mimeType, "audio/aac");
  assert.equal(audioPart("x.ogg", Buffer.from("")).inlineData.mimeType, "audio/ogg");
});

test("모르는 형식이나 인라인 한도(20MB)를 넘는 파일은 거절한다", () => {
  assert.throws(() => audioPart("x.webm", Buffer.from("")), /형식/);
  assert.throws(() => audioPart("x.mp3", Buffer.alloc(15 * 1024 * 1024)), /20MB/);
});
