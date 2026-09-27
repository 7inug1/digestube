import test from "node:test";
import assert from "node:assert/strict";

import { contextLine, searchText } from "../src/lib/context";

const v = {
  title: "Please… I Need Your Help", channel: "Web Dev Simplified",
  tldr: ["AI 유행으로 기초를 건너뛰는 추세에 번아웃을 겪었다.", "둘째 줄"],
  outline: [{ seq: 0, label: "영상 업로드가 뜸했던 이유" }, { seq: 3, label: "설문조사 요청" }],
};

test("문맥 줄은 영상 제목 · 채널 · 요지 첫 줄 · 이 대목의 목차 제목이다", () => {
  assert.equal(contextLine(v, 1),
    "영상: Please… I Need Your Help · 채널: Web Dev Simplified · 요지: AI 유행으로 기초를 건너뛰는 추세에 번아웃을 겪었다. · 이 대목: 영상 업로드가 뜸했던 이유");
  // 문단보다 앞선 목차 중 가장 가까운 것
  assert.match(contextLine(v, 4), /이 대목: 설문조사 요청$/);
});

test("없는 정보는 건너뛴다 — 목차·요약 전에도 제목·채널만으로 만든다", () => {
  assert.equal(contextLine({ title: "제목", channel: null, tldr: null, outline: [] }, 0), "영상: 제목");
  assert.equal(contextLine({ title: null, channel: null, tldr: [], outline: [] }, 0), "");
});

test("검색용 글은 문맥 줄 다음 줄에 원문 — 문맥이 없으면 원문 그대로", () => {
  assert.equal(searchText(v, { seq: 1, text: "본문" }).split("\n")[1], "본문");
  assert.equal(searchText({ title: null, channel: null, tldr: null, outline: [] }, { seq: 0, text: "본문" }), "본문");
});
