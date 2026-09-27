import test from "node:test";
import assert from "node:assert/strict";

import { answerPrompt, citations, cleanCitations, isDecline, DECLINE, splitSse } from "../src/lib/answer";

const passages = [
  { title: "코난 오브라이언", t: 69, text: "준비가 안 됐어도 잡아라." },
  { title: "조바심에 관한 한 가지 깨달음", t: 89, text: "모든 걸 대비하느라 할 일을 못 한다." },
];

test("프롬프트는 번호 붙은 근거와 규칙(근거 밖 금지·각주·길이·거절 문구)을 담는다", () => {
  const p = answerPrompt("준비 안 됐는데 기회가 오면?", passages);
  assert.match(p, /\[1\] 코난 오브라이언 · 1:09\n준비가 안 됐어도 잡아라\./);
  assert.match(p, /\[2\] 조바심에 관한 한 가지 깨달음 · 1:29/);
  assert.match(p, /문단에 없는 내용은 쓰지 않는다/);
  assert.ok(p.includes(DECLINE));
});

test("각주 번호는 나온 순서대로 한 번씩, 없는 번호는 버린다", () => {
  assert.deepEqual(citations("잡아라 [2]. 대비만 하지 마라 [1][2]. 끝 [7].", 2), [2, 1]);
  assert.equal(cleanCitations("잡아라 [2]. 끝 [7].", 2), "잡아라 [2]. 끝.");
});

test("거절 문구로 시작하면 답하지 않은 것으로 본다", () => {
  assert.equal(isDecline(`${DECLINE}`), true);
  assert.equal(isDecline("잡아라 [1]."), false);
});

test("Gemini 스트림(SSE)을 줄 단위로 읽고 덜 온 줄은 남긴다", () => {
  const ev = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}`;
  const { texts, rest } = splitSse(`${ev("잡아")}\r\n\r\n${ev("라")}\n\ndata: {"cand`);
  assert.deepEqual(texts, ["잡아", "라"]);
  assert.equal(rest, 'data: {"cand');
});
