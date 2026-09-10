/** 전사 조각을 문단으로 묶는다.
 *
 *  Supadata 가 주는 조각은 한 조각이 몇 글자 안 된다(3분 영상이 204조각).
 *  그대로 두면 뜻이 안 통해 검색의 단위가 못 된다.
 *
 *  자르는 방식 넷을 같은 글에 대고 재봤다(전사 세 편 8,186자, 목표 340자).
 *    A 글자 수로       문장 중간 끊김 88%   읽어도 말이 안 된다. 탈락
 *    B 마침표마다      끊김 0%, 평균 58자   너무 잘아 뜻이 안 담긴다
 *    C 문장 끝 + 길이  끊김 0%, 평균 314자  여기서 쓰는 것
 *    D 화제가 바뀌는 곳 미측정              임베딩 모델이 필요하다
 *
 *  C 를 쓰는 것은 재서 이긴 결과가 아니라 아직 못 정해서다. 어느 쪽이 나은지는
 *  검색이 잘 되는지로 판정해야 하고, 그러려면 골든셋이 있어야 한다.
 *
 *  겹침은 넣지 않는다. 붙여서 재봤더니 문장이 잘리는 것을 고치지 못했고
 *  (A 88% → 90%), 데이터만 38~95% 늘었다.
 *
 *  ⚠️ 구두점에 기대는 방식이다. mode=generate 로 받아쓴 글에는 구두점이 붙지만
 *  mode=native 로 가져온 자막에는 없는 경우가 많다. 그때는 문장 끝을 못 찾아
 *  MAXLEN 마다 잘린다. 지금 배포가 native 인 것은 서버리스 60초 제한 때문이고,
 *  generate 로 돌아가면 이 문제도 같이 사라진다.
 */
export type Piece = { text: string; offset: number; duration: number };
export type Chunk = { t: number; t_end: number; text: string };

export const TARGET = 340;   // 문단이 이 길이를 넘으려 하면 문장 끝에서 끊는다
export const MAXLEN = 700;   // 한 문장이 이보다 길면 어쩔 수 없이 여기서 끊는다

const ENDS = /[.!?。？！]$/;

export function chunk(pieces: Piece[], target = TARGET, maxlen = MAXLEN): Chunk[] {
  const out: Chunk[] = [];
  let buf = "";
  let start: number | null = null;
  let lastEnd = 0;

  for (const p of pieces) {
    const t = (p.text ?? "").trim();
    if (!t) continue;

    const off = (p.offset ?? 0) / 1000;
    const end = ((p.offset ?? 0) + (p.duration ?? 0)) / 1000;
    if (start === null) start = off;
    buf = `${buf} ${t}`.trim();
    lastEnd = end;

    const endsSentence = ENDS.test(t);
    if ((endsSentence && buf.length >= target) || buf.length >= maxlen) {
      out.push({ t: round(start), t_end: round(end), text: buf });
      buf = "";
      start = null;
    }
  }

  if (buf.trim()) out.push({ t: round(start ?? 0), t_end: round(lastEnd), text: buf.trim() });
  return out;
}

/** 잰 값 — 문단이 고르게 나왔는지 눈으로 보려는 것. */
export function stats(chunks: Chunk[]) {
  if (!chunks.length) return { n: 0 };
  const ls = chunks.map((c) => c.text.length);
  const cut = chunks.filter((c) => !ENDS.test(c.text.trim())).length;
  return {
    n: chunks.length,
    avg: Math.round(ls.reduce((a, b) => a + b, 0) / ls.length),
    min: Math.min(...ls),
    max: Math.max(...ls),
    cut,
    cut_pct: Math.round((cut / chunks.length) * 100),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
