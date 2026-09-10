/** 초 → "3분 23초". 사람이 읽는 자리에 쓴다. */
export function dur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? (s ? `${m}분 ${s}초` : `${m}분`) : `${s}초`;
}

/** 글자 수 → 읽는 데 걸리는 시간.
 *  한국어 묵독 속도를 분당 500자로 잡았다. 짧아도 1분으로 적는다 —
 *  "0분"은 읽는 사람에게 아무것도 알려주지 않는다. */
export function readTime(chars: number): string {
  return `${Math.max(1, Math.round(chars / 500))}분`;
}
