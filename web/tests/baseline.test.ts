import test from "node:test";
import assert from "node:assert/strict";

import { piecesToChunks } from "../src/lib/baseline";

test("저장해 둔 원본 자막 조각(ms)을 점검용 문단(초)으로 바꾼다", () => {
  const got = piecesToChunks([
    { text: "안녕하세요.", offset: 160, duration: 3559 },
    { text: "  ", offset: 4000, duration: 500 },
    { text: "[음악]\n시작합니다", offset: 5000, duration: 2000 },
  ]);
  assert.deepEqual(got, [
    { t: 0.16, t_end: 3.719, text: "안녕하세요." },
    { t: 5, t_end: 7, text: "[음악] 시작합니다" },
  ]);
});
