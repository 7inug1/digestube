import test from "node:test";
import assert from "node:assert/strict";

import { ASK_DAY_LIMIT, askKeys, askVerdict } from "../src/lib/limits";

test("물어보기는 하루 50번, 영상 사용량과 따로 센다", () => {
  assert.equal(ASK_DAY_LIMIT, 50);
  assert.deepEqual(askKeys(["bid:a", "ip:1.2.3.4"]), ["ask:bid:a", "ask:ip:1.2.3.4"]);
});

test("열쇠 중 하나라도 50번을 채웠으면 막고, 못 읽은 열쇠는 세지 않는다", () => {
  assert.equal(askVerdict([3, null]).ok, true);
  assert.equal(askVerdict([50, 2]).ok, false);
  assert.equal(askVerdict([null]).ok, true);
});
