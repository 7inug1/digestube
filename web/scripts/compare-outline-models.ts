/** 목차 모델 비교 — Sonnet 5 vs Gemini 3.8 Flash.
 *  기준은 notes/23-outline-rerun.md 에 실행 전에 적은 것을 그대로 쓴다:
 *  통과 = JSON 파싱 + label 1~25자 + quote 가 원문에 글자 그대로 있음.
 *  같은 문단, 같은 프롬프트, 후보당 2회(흔들림).
 *  운영 DB 는 읽기만 한다.
 */
import {mkdirSync, writeFileSync} from "node:fs";
import {db} from "../src/lib/supabase";
import {holds} from "../src/lib/verify";

const RUNS = 2, SAMPLE = 12, MAXLEN = 25;
const PRICE: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10], "gemini-3.8-flash": [0.75, 3.75],
};
const PROMPT = `다음은 영상 전사에서 잘라낸 문단이다. 목차에 걸 제목을 하나 만들어라.

규칙
- 제목은 한국어로 25자 이내.
- quote 는 이 문단에 **글자 그대로 들어 있는** 문장 하나를 옮긴다. 지어내지 않는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"label": "제목", "quote": "원문에 그대로 있는 문장"}

문단:
{text}`;

type Out = {text: string; input: number; output: number};

async function sonnet(text: string): Promise<Out> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model: "claude-sonnet-5", max_tokens: 300, messages: [{role: "user", content: PROMPT.replace("{text}", text)}]}),
    signal: AbortSignal.timeout(60000),
  });
  const d = await r.json() as {content?: {text?: string}[]; usage?: {input_tokens: number; output_tokens: number}};
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return {text: (d.content ?? []).map(b => b.text ?? "").join(""), input: d.usage?.input_tokens ?? 0, output: d.usage?.output_tokens ?? 0};
}

async function gemini(text: string): Promise<Out> {
  const key = process.env.GEMINI_API_KEY!.trim();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({contents: [{parts: [{text: PROMPT.replace("{text}", text)}]}],
      generationConfig: {responseMimeType: "application/json", maxOutputTokens: 2000, temperature: 0}}),
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 120).replaceAll(key, "***")}`);
  const d = JSON.parse(body) as {candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[]; usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number}};
  const c = d.candidates?.[0];
  if (c?.finishReason !== "STOP") throw new Error(`미완료 ${c?.finishReason}`);
  return {text: c.content?.parts?.map(p => p.text ?? "").join("") ?? "",
    input: d.usageMetadata?.promptTokenCount ?? 0,
    output: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0)};
}

async function main() {
  const got = await db().from("chunk").select("video_id,seq,text").order("video_id").order("seq");
  if (got.error) throw got.error;
  const all = got.data ?? [];
  // 영상별로 고르게. 출력을 보기 전에 입력을 고정한다.
  const byVideo = new Map<string, typeof all>();
  for (const c of all) { const l = byVideo.get(c.video_id) ?? []; l.push(c); byVideo.set(c.video_id, l); }
  const sample: typeof all = [];
  for (const [, list] of byVideo) {
    if (sample.length >= SAMPLE) break;
    sample.push(list[Math.floor(list.length / 2)]);
    if (list.length > 2 && sample.length < SAMPLE) sample.push(list[Math.floor(list.length / 4)]);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `data/evals/outline-models/${stamp}`;
  mkdirSync(dir, {recursive: true});
  const summary: Record<string, unknown>[] = [];

  for (const [name, ask] of [["claude-sonnet-5", sonnet], ["gemini-3.8-flash", gemini]] as const) {
    const rows: Record<string, unknown>[] = [];
    for (const c of sample) {
      for (let run = 0; run < RUNS; run++) {
        const t = Date.now();
        try {
          const out = await ask(c.text);
          const m = /\{[\s\S]*\}/.exec(out.text);
          const j = m ? JSON.parse(m[0]) as {label?: string; quote?: string} : null;
          const label = (j?.label ?? "").trim(), quote = (j?.quote ?? "").trim();
          const lenOk = label.length > 0 && Array.from(label).length <= MAXLEN;
          const quoteOk = holds(quote, c.text);
          rows.push({video_id: c.video_id, seq: c.seq, run, ms: Date.now() - t, label, quote,
            input: out.input, output: out.output, pass: Boolean(j) && lenOk && quoteOk, lenOk, quoteOk});
        } catch (e) {
          rows.push({video_id: c.video_id, seq: c.seq, run, ms: Date.now() - t, error: (e as Error).message, pass: false});
        }
      }
    }
    const passed = rows.filter(r => r.pass).length;
    const errors = rows.filter(r => r.error).length;
    const [ip, op] = PRICE[name];
    const cost = rows.reduce((n, r) => n + ((r.input as number ?? 0) * ip + (r.output as number ?? 0) * op) / 1e6, 0);
    let wobble = 0;
    for (const c of sample) {
      const [a, b] = rows.filter(r => r.video_id === c.video_id && r.seq === c.seq);
      if (a?.label && b?.label && a.label !== b.label) wobble++;
    }
    const stat = {model: name, attempts: rows.length, passed,
      pass_rate: +(passed / rows.length * 100).toFixed(1), errors, wobble,
      avg_ms: Math.round(rows.reduce((n, r) => n + (r.ms as number), 0) / rows.length),
      cost_usd: +cost.toFixed(4), per_chunk_usd: +(cost / rows.length).toFixed(5)};
    summary.push(stat);
    writeFileSync(`${dir}/${name}.json`, JSON.stringify({model: name, prompt: PROMPT, rows}, null, 2));
    console.log(JSON.stringify(stat));
  }
  writeFileSync(`${dir}/summary.json`, JSON.stringify({sample: sample.map(s => ({video_id: s.video_id, seq: s.seq})), summary}, null, 2));
  console.log(`저장: ${dir}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
