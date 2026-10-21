/** 읽기 화면을 열 때 이 영상을 내 라이브러리에 담을지, 어디에 담을지.
 *
 *  랜딩에서 넣은 영상(convert=1)이 이미 만들어져 있으면 변환 흐름을 거치지 않고
 *  바로 읽기 화면이 된다. 담는 일은 변환 흐름(/api/ingest, Building)이 끝날 때
 *  하므로, 여기서 따로 담지 않으면 물어보기가 그 영상을 찾지 못한다.
 *  주소만 찍어 연 영상은 담지 않는다 — 남이 보낸 링크가 내 목록에 들어오면 안 된다.
 */
export type KeepPlace = "account" | "browser" | null;

export function keepOnOpen(o: { convert?: string; ready: boolean; signedIn: boolean }): KeepPlace {
  if (o.convert !== "1" || !o.ready) return null;
  return o.signedIn ? "account" : "browser";
}
