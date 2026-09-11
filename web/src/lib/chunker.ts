/** Join caption fragments before finding sentence boundaries.
 * A caption fragment may contain several sentences or only part of one.
 * Timing stays anchored to the source caption containing each boundary; when
 * a caption contains multiple sentences their time ranges can overlap.
 */
export type Piece = { text: string; offset: number; duration: number };
export type Chunk = { t: number; t_end: number; text: string };

export const TARGET = 340;
export const MAXLEN = 700;
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
  for (const p of pieces) {
    const value = p.text.replace(/\s+/gu, " ").trim();
    if (!value) continue;
    if (text) text += " ";
    const start = text.length;
    text += value;
    spans.push({start, end:text.length, t:p.offset / 1000, t_end:(p.offset + p.duration) / 1000});
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
  for (const sentence of bounded) {
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
