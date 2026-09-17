import { test } from "node:test";
import assert from "node:assert/strict";
import { saySorry, SaidWell } from "../src/lib/errors";

test("남의 집 사정은 화면에 내보내지 않는다", () => {
  // 실제로 화면에 떴던 문장이다
  const raw = new Error('Supadata 404: {"error":"not-found","message":"Not Found","details":"Failed to get playlist","documentationUrl":"https://docs.supadata.ai/errors/not-found"}');
  const said = saySorry(raw, "test");
  assert.doesNotMatch(said, /Supadata|documentationUrl|http/);
  assert.match(said, /찾지 못했어요/);
});

test("우리가 쓴 안내는 그대로 나간다", () => {
  const mine = "오늘 12분 남았는데 이 영상은 20분이에요. 더 짧은 영상을 넣거나 내일 다시 와주세요.";
  assert.equal(saySorry(new Error(mine), "test"), mine);
  assert.equal(saySorry(new SaidWell("라이브 영상은 끝난 뒤에 넣어주세요."), "test"), "라이브 영상은 끝난 뒤에 넣어주세요.");
});

test("알아볼 수 있는 것만 골라 말한다", () => {
  const cases: [string, RegExp][] = [
    ["503 Service Unavailable", /붐벼요/],
    ["fetch failed: ECONNREFUSED", /연결이 잠시 끊겼어요/],
    ["The operation timed out", /오래 걸려/],
    ["401 Unauthorized", /권한이 없어요/],
  ];
  for (const [raw, want] of cases) assert.match(saySorry(new Error(raw), "test"), want, raw);
});

test("못 알아보면 짐작하지 않는다", () => {
  const said = saySorry(new Error("PGRST116: JSON object requested, multiple rows returned"), "test");
  assert.match(said, /잠시 뒤 다시 시도해 주세요/);
  assert.doesNotMatch(said, /PGRST/);
});
