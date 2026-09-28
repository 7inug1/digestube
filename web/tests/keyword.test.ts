import test from "node:test";
import assert from "node:assert/strict";

import { terms, matchParagraphs } from "../src/lib/keyword";

test("질문에서 찾을 단어를 뽑는다 — 조사를 떼고, 질문투 말은 뺀다", () => {
  assert.deepEqual(terms("비전보드에 내 얼굴을 넣으려면 어떻게 해?"), ["비전보드", "얼굴", "넣으려면"]);
  assert.deepEqual(terms("AI 엔지니어와 ML 연구자의 차이가 뭐야"), ["ai", "엔지니어", "ml", "연구자", "차이"]);
  // 떼고 나서 한 글자만 남으면 떼지 않는다
  assert.deepEqual(terms("아이"), ["아이"]);
  assert.deepEqual(terms("  "), []);
});

const index = [
  { video_id: "v1", title: "비전보드 영상", chunks: [
    { seq: 0, t: 0, text: "오늘은 인생 설계 이야기입니다." },
    { seq: 3, t: 216, text: "비전보드에 남 사진 말고 내 얼굴을 넣는 방법은 간단해요. ChatGPT에 내 사진을 넣고 프롬프트를 씁니다." },
  ] },
  { video_id: "v2", title: "다른 영상", chunks: [{ seq: 1, t: 30, text: "얼굴 표정이 중요해요." }] },
];

test("걸린 단어가 많은 대목부터, 단어 위치(형광펜)와 함께 돌려준다", () => {
  const r = matchParagraphs(index, ["비전보드", "얼굴"], 5);
  assert.equal(r.length, 2);
  assert.equal(r[0].video_id, "v1");
  assert.equal(r[0].seq, 3);
  assert.equal(r[0].hits, 2);
  const marked = r[0].ranges.map(([a, b]) => r[0].snippet.slice(a, b));
  assert.deepEqual(marked, ["비전보드", "얼굴"]);
  assert.equal(r[1].video_id, "v2");
});

test("대소문자를 가리지 않고, 걸린 게 없으면 빈 목록", () => {
  assert.equal(matchParagraphs(index, ["chatgpt"], 5)[0].seq, 3);
  assert.deepEqual(matchParagraphs(index, ["김치찌개"], 5), []);
  assert.deepEqual(matchParagraphs(index, [], 5), []);
});

test("긴 문단은 첫 걸린 곳 둘레만 잘라 보여 준다", () => {
  const long = [{ video_id: "v", title: "t", chunks: [{ seq: 0, t: 0, text: "가".repeat(300) + " 목표 " + "나".repeat(300) }] }];
  const r = matchParagraphs(long, ["목표"], 5)[0];
  assert.ok(r.snippet.length < 140);
  assert.ok(r.snippet.startsWith("…") && r.snippet.endsWith("…"));
  assert.equal(r.snippet.slice(...r.ranges[0]), "목표");
});
