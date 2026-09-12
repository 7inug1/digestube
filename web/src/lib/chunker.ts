/** Join caption fragments before finding sentence boundaries.
 * A caption fragment may contain several sentences or only part of one.
 * Timing stays anchored to the source caption containing each boundary; when
 * a caption contains multiple sentences their time ranges can overlap.
 */
export type Piece = { text: string; offset: number; duration: number };
export type Chunk = { t: number; t_end: number; text: string };

export const TARGET = 340;
export const MAXLEN = 700;

/** 말이 멈춘 자리를 문장 끝 후보로 쓸 때의 간격.
 *
 *  구두점이 없는 전사에서 문장 경계를 찾는 두 번째 방법이다. 어미 기반 분할과
 *  같은 문제를 다른 각도에서 푼다. 둘 중 무엇이 나은지는 아직 재지 않았으므로
 *  기본값은 0(끔)이고, 비교 실험에서만 켠다. `stats().cut_pct` 가 지표다.
 *
 *  실측(3분 영상 204조각): 조각 사이 간격 중앙값 -0.98초로 시간이 겹치고,
 *  0.3초를 넘는 간격은 9개였다. */
export const PAUSE_SEC = 0.3;
const ENDS = /[.!?。？！]["'”’」』）)\]]*$/;
const segmenter = new Intl.Segmenter("ko", { granularity: "sentence" });

/** Sentence boundaries take priority; only an individual overlong sentence
 * (including unpunctuated text) needs a size fallback. Prefer spaces there.
 */
export function chunk(pieces: Piece[], target = TARGET, maxlen = MAXLEN, pauseSec = 0): Chunk[] {
  if (!Number.isInteger(target) || !Number.isInteger(maxlen) || target < 1 || maxlen < target) {
    throw new Error("청킹 길이는 0 < target <= maxlen인 정수여야 합니다.");
  }
  let text = "";
  const spans: { start: number; end: number; t: number; t_end: number }[] = [];
  const pauses: number[] = [];
  let prevEnd: number | null = null;
  for (const p of pieces) {
    const value = p.text.replace(/\s+/gu, " ").trim();
    if (!value) continue;
    if (text) text += " ";
    const start = text.length;
    const t = p.offset / 1000;
    if (pauseSec > 0 && prevEnd !== null && t - prevEnd >= pauseSec) pauses.push(start);
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
  // Unpunctuated Korean captions: use conservative polite sentence endings only.
  // This is a boundary heuristic, not a grammatical or semantic guarantee.
  const bounded = sentences.flatMap(sentence => {
    if (sentence.segment.length <= maxlen || /[.!?。？！]/u.test(sentence.segment)) return [sentence];
    const out: {index:number;segment:string}[] = [];
    let at = 0;
    const endings = /[가-힣]+(?:니다|거든요|잖아요|는데요|어요|아요|해요|예요|에요|네요|군요|죠)(?=\s|$)/gu;
    for (const match of sentence.segment.matchAll(endings)) {
      const end = match.index! + match[0].length;
      out.push({index:sentence.index+at,segment:sentence.segment.slice(at,end)});
      at = end;
    }
    if (at < sentence.segment.length) out.push({index:sentence.index+at,segment:sentence.segment.slice(at)});
    return out;
  });
  // 무음 분할은 어미 분할 다음에 온다. 어미로 이미 갈린 문장을 더 잘게 나눌 뿐,
  // 어미가 찾은 경계를 덮어쓰지 않는다.
  const split = pauses.length === 0 ? bounded : bounded.flatMap(sentence => {
    const from = sentence.index, to = from + sentence.segment.length;
    const inside = pauses.filter(i => i > from && i < to);
    if (!inside.length) return [sentence];
    const out: {index:number;segment:string}[] = [];
    let at = from;
    for (const i of [...inside, to]) {
      if (i > at) out.push({index:at, segment:text.slice(at, i)});
      at = i;
    }
    return out;
  });

  for (const sentence of split) {
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
