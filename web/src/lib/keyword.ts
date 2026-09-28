/** 검색 창에 입력하는 동안 보여 주는 "글자가 맞는 대목".
 *
 *  뜻으로 찾는 검색(임베딩·리랭커)은 Enter 를 쳐야 돈다. 그 전에 빈 창만 보이면 심심하고,
 *  내 질문의 단어가 라이브러리 어디에 나오는지는 글자 비교만으로도 바로 알 수 있다.
 *  서버·AI 호출 없이 브라우저에서 돈다 — 전사문은 창을 열 때 한 번 받아 둔다.
 */

export type IndexVideo = { video_id: string; title: string; chunks: { seq: number; t: number; text: string }[] };

export type KeywordHit = {
  video_id: string; title: string; seq: number; t: number;
  /** 걸린 서로 다른 단어 수 — 많을수록 앞에 온다 */
  hits: number;
  snippet: string;
  /** snippet 안에서 형광펜을 칠할 [시작, 끝) */
  ranges: [number, number][];
};

// 긴 것부터 — "에서"를 "에"보다 먼저 떼야 "서"가 남지 않는다
const PARTICLES = ["이랑", "에서", "으로", "까지", "부터", "한테", "에게", "처럼", "보다",
  "은", "는", "이", "가", "을", "를", "에", "의", "도", "로", "와", "과", "만", "랑"];

// 질문을 만드는 말 — 전사문에 나와도 질문의 내용과는 상관없다
const ASKING = new Set(["어떻게", "어떤", "어떠한", "무엇", "뭐", "뭐야", "뭐였지", "뭔가요", "무엇인가요",
  "누구", "누가", "어디", "언제", "왜", "있어", "있나요", "있었지", "있었잖아", "해줘", "알려줘",
  "좋나요", "거야", "건가요", "인가요", "했지", "였지", "그", "이", "저"]);

function stripParticle(w: string): string {
  for (const p of PARTICLES) {
    // 떼고 나서 한 글자만 남으면 원래 단어의 일부로 본다 ("아이"의 "이")
    if (w.endsWith(p) && w.length - p.length >= 2) return w.slice(0, -p.length);
  }
  return w;
}

/** 질문에서 찾을 단어 — 두 글자 이상, 조사 떼고, 질문투 말은 빼고, 겹치지 않게. */
export function terms(q: string): string[] {
  const out: string[] = [];
  for (const raw of q.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || ASKING.has(raw)) continue;
    const w = stripParticle(raw);
    if (w.length < 2 || ASKING.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

const BEFORE = 40;   // 첫 걸린 곳 앞으로 보여 줄 글자 수
const WIDTH = 110;   // 잘라 보여 줄 전체 길이

/** 단어가 걸린 문단을, 걸린 단어가 많은 순으로(같으면 라이브러리 순서대로). */
export function matchParagraphs(index: IndexVideo[], words: string[], limit: number): KeywordHit[] {
  if (!words.length) return [];
  const found: KeywordHit[] = [];
  for (const v of index) {
    for (const c of v.chunks) {
      const low = c.text.toLowerCase();
      const spots: [number, number][] = [];
      let hits = 0;
      for (const w of words) {
        let i = low.indexOf(w);
        if (i < 0) continue;
        hits++;
        for (; i >= 0; i = low.indexOf(w, i + w.length)) spots.push([i, i + w.length]);
      }
      if (!hits) continue;
      spots.sort((a, b) => a[0] - b[0]);
      const start = Math.max(0, spots[0][0] - BEFORE);
      const end = Math.min(c.text.length, start + WIDTH);
      const head = start > 0 ? "…" : "";
      const snippet = head + c.text.slice(start, end) + (end < c.text.length ? "…" : "");
      const ranges: [number, number][] = [];
      for (const [a, b] of spots) {
        if (a < start || b > end) continue;
        const r: [number, number] = [a - start + head.length, b - start + head.length];
        const last = ranges[ranges.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);   // 겹치면 하나로
        else ranges.push(r);
      }
      found.push({ video_id: v.video_id, title: v.title, seq: c.seq, t: c.t, hits, snippet, ranges });
    }
  }
  // sort 는 안정 정렬 — 같은 수면 라이브러리·문단 순서가 유지된다
  return found.sort((a, b) => b.hits - a.hits).slice(0, limit);
}
