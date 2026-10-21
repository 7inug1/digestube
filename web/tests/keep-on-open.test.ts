import { test } from "node:test";
import assert from "node:assert/strict";
import { keepOnOpen } from "../src/lib/keep";

// 이미 만들어진 영상을 랜딩에서 넣으면 변환 없이 바로 읽기 화면으로 간다.
// 이때도 내 라이브러리에 담겨야 물어보기가 그 영상 안에서 답을 찾는다.
test("랜딩에서 넣은 완성된 영상은 로그인했으면 계정에, 아니면 브라우저에 담는다", () => {
  assert.equal(keepOnOpen({ convert: "1", ready: true, signedIn: true }), "account");
  assert.equal(keepOnOpen({ convert: "1", ready: true, signedIn: false }), "browser");
});

test("주소만 찍어 연 영상이나 아직 만드는 중인 영상은 여기서 담지 않는다", () => {
  // 링크로 남의 영상을 열었다고 내 목록에 들어오면 안 된다
  assert.equal(keepOnOpen({ convert: undefined, ready: true, signedIn: true }), null);
  // 만드는 중이면 변환 흐름(/api/ingest, Building)이 끝날 때 담는다
  assert.equal(keepOnOpen({ convert: "1", ready: false, signedIn: true }), null);
});
