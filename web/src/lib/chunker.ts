/** Join caption fragments before finding sentence boundaries.
 * A caption fragment may contain several sentences or only part of one.
 * Timing stays anchored to the source caption containing each boundary; when
 * a caption contains multiple sentences their time ranges can overlap.
 */
export type Piece = { text: string; offset: number; duration: number };
export type Chunk = { t: number; t_end: number; text: string };

export const TARGET = 340;
export const MAXLEN = 700;

/** 말이 멈춘 자리를 문장 끝 대신 쓴다.
 *
 *  구두점이 아예 없는 전사가 있다. Supadata 가 자막을 가져오는 mode=native 는
 *  물론이고 받아쓰기도 영상에 따라 구두점을 안 붙인다. 그러면 문장 경계를 못 찾아
 *  MAXLEN 마다 잘리고, 말 중간에서 끊긴 문단이 나온다.
 *
 *  전사 조각에는 시각이 붙어 있으므로 조각 사이의 침묵을 경계로 쓸 수 있다.
 *  실측(3분 영상 204조각): 간격 중앙값이 -0.98초로 조각끼리 시간이 겹치고,
 *  0.3초를 넘는 간격은 9개뿐이었다. 드물기 때문에 목표 길이를 넘겼을 때만
 *  이 자리를 쓴다 — 침묵마다 자르면 문단이 너무 잘아진다. */
export const PAUSE_SEC = 0.3;
const ENDS = /[.!?。？！]["'”’」』）)\]]*$/;
const segmenter = new Intl.Segmenter("ko", { granularity: "sentence" });

/** Sentence boundaries take priority; only an individual overlong sentence
 * (including unpunctuated text) needs a size fallback. Prefer spaces there.
 */
export function chunk(pieces: Piece[], target = TARGET, maxlen = MAXLEN): Chunk[] {
  if (!Number.isInteger(target) || !Number.isInteger(maxlen) || target < 1 || maxlen < target) {
    throw new Error("청킹 길이는 0 < target <= maxlen인 정수여야 합니다.");
  }
  let text = "";
  const spans: { start: number; end: number; t: number; t_end: number }[] = [];
  // 앞 조각이 끝나고 이 조각이 시작하기까지 쉰 자리 — 문장 끝 후보
  const pauses: number[] = [];
  let prevEnd: number | null = null;
  for (const p of pieces) {
    const value = p.text.replace(/\s+/gu, " ").trim();
    if (!value) continue;
    if (text) text += " ";
    const start = text.length;
    const t = p.offset / 1000;
    if (prevEnd !== null && t - prevEnd >= PAUSE_SEC) pauses.push(start);
    text += value;
    prevEnd = (p.offset + p.duration) / 1000;
    spans.push({start, end:text.length, t, t_end:prevEnd});
  }
  if (!text) return [];

  const ranges: { start: number; end: number }[] = [];
  let buffered: { start: number; end: number } | null = null;
  const flush = () => { if (buffered) ranges.push(buffered); buffered = null; };
  const sentences: {index:number;segment:string}[] = [];
  for (const part of segmenter.segment(text)) {
    const previous = sentences.at(-1);
    // ICU can split Korean reported speech after the closing quote.
    if (previous && /[”’"’」』]$/u.test(previous.segment) && /^(?:라고|하고|라는|라며|이라|이라고)/u.test(part.segment)) {
      previous.segment += part.segment;
    } else sentences.push({index:part.index,segment:part.segment});
  }
  /* 침묵을 문장 경계로 쓴다.
   *
   *  구두점이 없으면 Intl.Segmenter 가 전체를 한 문장으로 본다. 그러면 아래
   *  누적 로직이 통째로 건너뛰고 MAXLEN 에서만 잘려 말 중간이 끊긴다.
   *  조각 사이가 쉰 자리를 문장 끝으로 쳐서 잘게 나눠 두면, 그다음은 원래
   *  로직이 목표 길이까지 다시 이어 붙인다. */
  const bySilence: { index: number; segment: string }[] = [];
  for (const sentence of sentences) {
    const from = sentence.index;
    const to = from + sentence.segment.length;
    const inside = pauses.filter((i) => i > from && i < to);
    let at = from;
    for (const i of [...inside, to]) {
      if (i > at) bySilence.push({ index: at, segment: text.slice(at, i) });
      at = i;
    }
  }

  for (const sentence of bySilence) {
    let start = sentence.index;
    let end = start + sentence.segment.length;
    while (start < end && /\s/u.test(text[start])) start++;
    while (end > start && /\s/u.test(text[end-1])) end--;
    if (start === end) continue;
    if (buffered && end - buffered.start > target) flush();

    while (end - start > maxlen) {
      flush();
      const limit = start + maxlen;
      let cut = limit;
      // If the limit already falls at a word end, keep the complete word.
      if (!/\s/u.test(text[limit])) {
        const spaces = [...text.slice(start,limit).matchAll(/\s+/gu)];
        const last = spaces.at(-1);
        if (last && last.index! > 0) cut = start + last.index!;
      }
      // Never split a surrogate pair when there are no word boundaries.
      if (/[\uD800-\uDBFF]/u.test(text[cut-1]) && /[\uDC00-\uDFFF]/u.test(text[cut])) cut--;
      // An exceptionally small caller-supplied limit may be shorter than one code point.
      if (cut <= start) cut = start + (text.codePointAt(start)! > 0xffff ? 2 : 1);
      ranges.push({start,end:cut});
      start = cut;
      while (start < end && /\s/u.test(text[start])) start++;
    }
    if (start < end) {
      buffered = buffered ? {start:buffered.start,end} : {start,end};
      if (end - buffered.start >= target) flush();
    }
  }
  flush();

  return ranges.map(({start,end}) => {
    const covered = spans.filter(p => p.end > start && p.start < end);
    return {
      t:round(covered[0].t),
      t_end:round(Math.max(...covered.map(p=>p.t_end))),
      text:text.slice(start,end).trim(),
    };
  });
}

/** Punctuation-ending counts are diagnostic, not a semantic quality score. */
export function stats(chunks: Chunk[]) {
  if (!chunks.length) return { n: 0 };
  const ls = chunks.map(c=>c.text.length);
  const cut = chunks.filter(c=>!ENDS.test(c.text.trim())).length;
  return {n:chunks.length,avg:Math.round(ls.reduce((a,b)=>a+b,0)/ls.length),
    min:Math.min(...ls),max:Math.max(...ls),cut,cut_pct:Math.round(cut/chunks.length*100)};
}
const round = (n: number) => Math.round(n * 100) / 100;
