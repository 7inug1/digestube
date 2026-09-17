import { test } from "node:test";
import assert from "node:assert/strict";
import { videoIdOf } from "../src/lib/ingest-client";

test("여러 모양의 유튜브 주소에서 영상 번호를 찾는다", () => {
  const cases: [string, string | null][] = [
    ["https://www.youtube.com/watch?v=LHpplKlnXes", "LHpplKlnXes"],
    // 재생목록 안에서 보다가 복사한 주소. v= 가 있으니 한 편이다 —
    // 이걸 재생목록으로 치면 한 편 넣으려던 사람이 수십 편을 돌리게 된다.
    ["https://www.youtube.com/watch?v=LHpplKlnXes&list=PL_zM0&index=9", "LHpplKlnXes"],
    ["https://youtu.be/LHpplKlnXes?si=abc", "LHpplKlnXes"],
    ["https://www.youtube.com/shorts/LHpplKlnXes", "LHpplKlnXes"],
    ["https://www.youtube.com/live/LHpplKlnXes", "LHpplKlnXes"],
    ["https://www.youtube.com/embed/LHpplKlnXes", "LHpplKlnXes"],
    // 순수 재생목록에는 영상 번호가 없다
    ["https://www.youtube.com/playlist?list=PL_zM0", null],
    ["https://example.com", null],
  ];
  for (const [url, want] of cases) assert.equal(videoIdOf(url), want, url);
});
