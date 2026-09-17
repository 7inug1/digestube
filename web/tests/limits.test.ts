import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, quotaMessage, ANON_DAY_SECONDS, SLICE_SECONDS } from "../src/lib/limits";
import { isoSeconds, type Details } from "../src/lib/youtube";

const ok: Details = { seconds: 600, live: "none", privacy: "public", ageRestricted: false, embeddable: true };

test("ISO 8601 길이를 초로 읽는다", () => {
  assert.equal(isoSeconds("PT10M58S"), 658);
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("PT45S"), 45);
  assert.equal(isoSeconds("P0D"), 0);
  assert.equal(isoSeconds("이상한값"), 0);
});

test("공개·라이브 아님이면 길이와 상관없이 받는다", () => {
  assert.deepEqual(judge(ok), { ok: true });
  // 한 영상 길이 제한은 없앴다 — 긴 영상은 나눠서 받아쓴다
  assert.deepEqual(judge({ ...ok, seconds: 3 * 60 * 60 }), { ok: true });
});

test("구간은 서버 한 번 실행(300초) 안에 끝날 크기여야 한다", () => {
  // 받아쓰기는 실측으로 길이의 15% 쯤 걸린다. 모델 준비 시간 40초를 얹어도 300초 아래여야 한다
  assert.ok(SLICE_SECONDS * 0.15 + 40 < 300);
});

test("확인을 못 하면 막지 않는다", () => {
  assert.deepEqual(judge(null), { ok: true });
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

test("쓴 곳 전부에 적는다 — 로그인하면 계정, 아니면 IP. 브라우저는 늘.", async () => {
  const { quotaKeys } = await import("../src/lib/limits");
  const req = (cookie: string, ip = "1.2.3.4") =>
    new Request("https://x", { headers: { cookie, "x-forwarded-for": ip } });

  // 익명: IP 와 브라우저 둘 다
  assert.deepEqual(quotaKeys(req("dt.bid=abc")).sort(), ["bid:abc", "ip:1.2.3.4"]);

  // 로그인: 계정과 브라우저. IP 는 빠진다 — 사무실에서 남이 쓴 만큼 막히지 않게.
  assert.deepEqual(quotaKeys(req("dt.bid=abc"), "u1").sort(), ["bid:abc", "user:u1"]);

  // 브라우저에도 계속 적으므로, 로그인했다 로그아웃해도 그 기기의 사용량은 남는다
  assert.ok(quotaKeys(req("dt.bid=abc"), "u1").includes("bid:abc"));

  // 쿠키가 없으면(차단·시크릿창) 남은 열쇠로라도 센다
  assert.deepEqual(quotaKeys(req("")), ["ip:1.2.3.4"]);
});

test("전체 상한은 개인 몫보다 먼저다", async () => {
  const { ALL_DAY_SECONDS, ANON_DAY_SECONDS } = await import("../src/lib/limits");
  // 개인 60분 × 10명이 꽉 채워야 닿는 선. 한 사람이 혼자 닿을 수는 없다.
  assert.equal(ALL_DAY_SECONDS / ANON_DAY_SECONDS, 10);
});

test("IP 는 느슨한 뒷문이다 — 개인 몫의 세 배", async () => {
  const { IP_DAY_SECONDS, ANON_DAY_SECONDS } = await import("../src/lib/limits");
  // 사무실에서 세 사람까지는 각자 제 몫을 다 쓸 수 있고,
  // 한 사람이 쿠키를 지우며 반복하면 세 번에서 끊긴다.
  assert.equal(IP_DAY_SECONDS / ANON_DAY_SECONDS, 3);
});
