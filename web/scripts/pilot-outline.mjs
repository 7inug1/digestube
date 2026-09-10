/** Three-model human evaluation pilot. Read-only database access.
 * Run from web with Node 22+: node --env-file=.env.local scripts/pilot-outline.mjs
 * Node 20 additionally needs --experimental-websocket.
 * Snapshots inputs, original prompt, raw responses, usage, and blind review mapping.
 * One run per middle paragraph per video; calibration only, not a final ranking.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";

const GAP_MS = 2500;        // Groq 무료 한도에 걸리지 않게 간격을 둔다

const PROMPT = `다음은 영상 전사에서 잘라낸 문단이다. 목차에 걸 제목을 하나 만들어라.

규칙
- 제목은 한국어로 25자 이내.
- quote 는 이 문단에 **글자 그대로 들어 있는** 문장 하나를 옮긴다. 지어내지 않는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"label": "제목", "quote": "원문에 그대로 있는 문장"}

문단:
{text}`;

const CANDIDATES = [
  { name: "Claude Haiku 4.5", vendor: "anthropic", model: "claude-haiku-4-5-20251001" },
  { name: "Claude Sonnet 5",  vendor: "anthropic", model: "claude-sonnet-5" },
  { name: "gpt-oss-120b",     vendor: "groq",      model: "openai/gpt-oss-120b" },
  { name: "gpt-oss-20b",      vendor: "groq",      model: "openai/gpt-oss-20b" },
  { name: "qwen3.8-27b",      vendor: "groq",      model: "qwen/qwen3.8-27b" },
  { name: "qwen3.6-27b",      vendor: "groq",      model: "qwen/qwen3.6-27b" },
];

/* ── 판정 ────────────────────────────────────────────────────────── */
const DROP = /[\s.,!?…·"'“”‘’()\[\]{}~\-—]+/g;
const norm = (s) => (s ?? "").replace(DROP, "");
const holds = (quote, source) => {
  const q = norm(quote);
  return Boolean(q) && norm(source).includes(q);
};

function parseJson(text) {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) throw new Error("JSON 아님");
  return JSON.parse(m[0]);
}

/* ── 호출 ────────────────────────────────────────────────────────── */
/** Claude 5 세대는 temperature 를 받지 않는다("deprecated for this model").
    받는 모델에만 붙여 조건을 최대한 맞춘다. */
const TAKES_TEMP = (model) => /haiku-4-5|claude-3/.test(model);

async function anthropic(model, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(60000),
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model, max_tokens: 300,
      ...(TAKES_TEMP(model) ? { temperature: 0 } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return {
    text: (d.content ?? []).map((b) => b.text ?? "").join(""),
    out: d.usage?.output_tokens ?? 0, usage: d.usage,
  };
}

async function groq(model, prompt, attempt = 0) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 800, temperature: 0,
      messages: [{ role: "user", content: prompt }] }),
  });
  const d = await r.json();
  if (r.status === 429 && attempt < 2) {
    // 무료 한도다. 실력과 무관하므로 기다렸다 다시 부른다.
    const wait = Number(r.headers.get("retry-after") ?? 8) * 1000;
    await sleep(Math.min(wait, 30000));
    return groq(model, prompt, attempt + 1);
  }
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return {
    text: d.choices?.[0]?.message?.content ?? "",
    out: d.usage?.completion_tokens ?? 0, usage: d.usage,
  };
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const callers = { anthropic, groq };


// Small human-scored pilot; does not write to the service database.
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const {data, error} = await db.from("chunk").select("video_id,seq,text").order("video_id").order("seq");
if (error) throw error;
const groups = Map.groupBy ? Map.groupBy(data, x=>x.video_id) : data.reduce((m,x)=>m.set(x.video_id,[...(m.get(x.video_id)||[]),x]),new Map());
const inputs = [...groups.values()].map(xs=>xs[Math.floor(xs.length/2)]);
const candidates = CANDIDATES.filter(c=>["claude-sonnet-5","claude-haiku-4-5-20251001","openai/gpt-oss-120b"].includes(c.model));
const dir = `data/evals/pilot-${new Date().toISOString().replace(/[:.]/g,"-")}`;
await mkdir(dir,{recursive:true});
const manifest = {created_at:new Date().toISOString(), purpose:"human rubric calibration, not final model selection", selection:"middle paragraph of each current video, one run", mode:"unknown; existing corpus may mix native and generate", prompt:PROMPT, candidates, settings:{anthropic_max_tokens:300,groq_max_tokens:800,temperature:"0 except Sonnet omitted (unsupported)",timeout_ms:60000,retries:"Groq 429 at most 2"}, inputs};
await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2));
const rows=[];
for (let i=0;i<inputs.length;i++) {
 const ch=inputs[i];
 for (const c of candidates) {
  const start=Date.now();
  const row={input:i,...c};
  try {
   const result=await callers[c.vendor](c.model,PROMPT.replace("{text}",ch.text));
   Object.assign(row,{raw:result.text,usage:result.usage,ms:Date.now()-start});
   try {const parsed=parseJson(result.text); row.label=String(parsed.label??"").trim();row.quote=String(parsed.quote??"").trim();row.json_ok=true;row.len_ok=row.label.length>0&&row.label.length<=25;row.quote_ok=holds(row.quote,ch.text);row.pass=row.len_ok&&row.quote_ok;} catch {row.json_ok=false;row.pass=false;}
  } catch {row.error="Request failed; no successful response";row.ms=Date.now()-start;row.pass=false;}
  rows.push(row);
  await writeFile(`${dir}/results.json`,JSON.stringify(rows,null,2));
  console.log(`Paragraph ${i+1}/${inputs.length}: ${c.name} ${row.pass?"OK":"FAIL"}`);
  await sleep(GAP_MS);
 }
}
// Rotate display order by paragraph to reduce position bias; mapping saved separately.
const mapping=[];
let md="# 목차 블라인드 평가 — 1차 연습\n\n모델 선정 결과가 아닙니다. 각 항목 0·1·2점, 미채점은 빈칸으로 둡니다.\n\n- 핵심 대표: 0 핵심을 놓침 / 1 일부만 담음 / 2 중심 내용을 잘 대표\n- 원문 충실: 0 없는 주장 또는 왜곡 / 1 과장·모호한 확장 / 2 추가 주장 없이 충실\n- 내용 파악: 0 무엇을 다루는지 불명 / 1 대략적 주제만 앎 / 2 다루는 내용을 구체적으로 예상 가능\n\n먼저 제목만 읽어 내용 파악 점수를 적고, 원문을 펼쳐 나머지를 채점하세요. quote의 원문 일치는 제목의 정확성을 보장하지 않습니다. 원문 자체가 불명확하면 판단 보류라고 적으세요.\n\n";
for(let i=0;i<inputs.length;i++) {
 const ch=inputs[i];const rs=rows.filter(r=>r.input===i);const ordered=rs.slice(i%3).concat(rs.slice(0,i%3));
 md+=`## 문단 ${i+1}\n\n`;
 ordered.forEach((r,j)=>{const id=`${i+1}-${"ABC"[j]}`;mapping.push({id,model:r.model,input:i});md+=`**${id}: ${r.label??"[생성 실패]"}**\n\n핵심 대표: __ / 원문 충실: __ / 내용 파악: __ / 이유: __\n\n`;});
 md+=`<details><summary>원문 보기</summary>\n\n${ch.text}\n\n</details>\n\n`;
}
await writeFile(`${dir}/blind-review.md`,md);
await writeFile(`${dir}/answer-key.json`,JSON.stringify(mapping,null,2));
console.log(`Saved: ${dir}/blind-review.md`);
