import test from "node:test";
import assert from "node:assert/strict";

import { thinkingConfig } from "../src/lib/thinking";

test("생각 단계는 Gemini 3 이 받는 이름으로만 만든다", () => {
  assert.deepEqual(thinkingConfig("low"), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingConfig(undefined), {}); // 안 주면 모델 기본값(medium)
  assert.throws(() => thinkingConfig("none"), /low · medium · high/);
});
