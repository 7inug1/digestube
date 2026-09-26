import test from "node:test";
import assert from "node:assert/strict";

import { warmDue, WARM_EVERY_MS } from "../src/lib/warm";

test("처음이거나 마지막으로 깨운 지 5분이 지났으면 다시 깨운다", () => {
  assert.equal(WARM_EVERY_MS, 5 * 60 * 1000);
  assert.equal(warmDue(null, 1000), true);
  assert.equal(warmDue(0, WARM_EVERY_MS), true);
  assert.equal(warmDue(0, WARM_EVERY_MS - 1), false);
});

test("기록이 이상하면(미래 시각·숫자 아님) 깨운다", () => {
  assert.equal(warmDue(10_000, 5_000), true);
  assert.equal(warmDue(Number.NaN, 5_000), true);
});
