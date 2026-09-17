import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, quotaMessage, MAX_SECONDS, ANON_DAY_SECONDS } from "../src/lib/limits";
import { isoSeconds, type Details } from "../src/lib/youtube";

const ok: Details = { seconds: 600, live: "none", privacy: "public", ageRestricted: false, embeddable: true };

test("ISO 8601 길이를 초로 읽는다", () => {
  assert.equal(isoSeconds("PT10M58S"), 658);
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("PT45S"), 45);
  assert.equal(isoSeconds("P0D"), 0);
  assert.equal(isoSeconds("이상한값"), 0);
});

test("공개·30분 이하·라이브 아님이면 받는다", () => {
  assert.deepEqual(judge(ok), { ok: true });
  assert.deepEqual(judge({ ...ok, seconds: MAX_SECONDS }), { ok: true });
});

test("확인을 못 하면 막지 않는다", () => {
  assert.deepEqual(judge(null), { ok: true });
});

test("30분 넘으면 분 수를 말하며 거른다", () => {
  const v = judge({ ...ok, seconds: MAX_SECONDS + 1 });
  assert.equal(v.ok, false);
  if (!v.ok) { assert.equal(v.code, "VIDEO_TOO_LONG"); assert.match(v.error, /30분/); }
});

test("비공개·라이브·연령제한은 각자 다른 이유로 거른다", () => {
  const codes = [
    judge({ ...ok, privacy: "private" }),
    judge({ ...ok, live: "live" }),
    judge({ ...ok, live: "upcoming" }),
    judge({ ...ok, ageRestricted: true }),
  ].map(v => (v.ok ? "ok" : v.code));
  assert.deepEqual(codes, ["VIDEO_PRIVATE", "VIDEO_LIVE", "VIDEO_LIVE", "VIDEO_AGE"]);
});

test("쿼터 안내는 남은 분과 영상 길이를 같이 말한다", () => {
  assert.match(quotaMessage(12 * 60, 20 * 60), /12분 남았는데 이 영상은 20분/);
  assert.match(quotaMessage(0, 5 * 60), new RegExp(`${ANON_DAY_SECONDS / 60}분을 다 썼어요`));
  // 59초 남으면 0분 — "0분 남았는데" 대신 다 썼다고 말한다
  assert.match(quotaMessage(59, 60), /다 썼어요/);
});
