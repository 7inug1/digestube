/** 목차 생성 모델 1차 라운드 — 자동 통과율만 본다.
 *
 *   node --env-file=.env.local scripts/bench-outline.mjs
 *
 * notes/09-outline-model-evaluation.md 의 1차 자동 탈락 기준을 그대로 쓴다.
 *   JSON 파싱 불가 · label 이 비었거나 25자 초과 · quote 가 원문에 없음 · 호출 오류
 *
 * 프롬프트는 모델마다 손대지 않는다. 손대면 후보를 나란히 놓고 잴 수 없다.
 * 결과는 data/evals/ 에 남긴다 — 나중에 다시 볼 수 있어야 한다.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";

const RUNS = 2;             // 같은 문단을 두 번씩 — 고정했는데도 흔들리는지 본다
const GAP_MS = 2500;        // Groq 무료 한도에 걸리지 않게 간격을 둔다
const MAXLEN = 25;          // label 길이 상한

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
    method: "POST",
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
    out: d.usage?.output_tokens ?? 0,
  };
}

async function groq(model, prompt) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 800, temperature: 0,
      messages: [{ role: "user", content: prompt }] }),
  });
  const d = await r.json();
  if (r.status === 429) {
    // 무료 한도다. 실력과 무관하므로 기다렸다 다시 부른다.
    const wait = Number(r.headers.get("retry-after") ?? 8) * 1000;
    await sleep(Math.min(wait, 30000));
    return groq(model, prompt);
  }
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return {
    text: d.choices?.[0]?.message?.content ?? "",
    out: d.usage?.completion_tokens ?? 0,
  };
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const callers = { anthropic, groq };

/* ── 실행 ────────────────────────────────────────────────────────── */
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const { data: chunks, error } = await db
  .from("chunk").select("video_id,seq,text").order("video_id").order("seq");
if (error) throw error;
// 인자를 주면 그 후보만 돌린다 — 한 모델만 다시 잴 때 쓴다
const only = process.argv[2];
const RUN_LIST = only ? CANDIDATES.filter((c) => c.model.includes(only) || c.name.includes(only)) : CANDIDATES;
console.log(`문단 ${chunks.length}개 · 후보 ${RUN_LIST.length}개 · ${RUNS}회씩\n`);

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
const all = [];

for (const c of RUN_LIST) {
  const rows = [];
  const t0 = Date.now();
  for (const ch of chunks) {
    for (let run = 0; run < RUNS; run++) {
      const rec = { video_id: ch.video_id, seq: ch.seq, run };
      const s = Date.now();
      try {
        const { text, out } = await callers[c.vendor](c.model, PROMPT.replace("{text}", ch.text));
        rec.ms = Date.now() - s;
        rec.out = out;
        const d = parseJson(text);
        rec.label = String(d.label ?? "").trim();
        rec.quote = String(d.quote ?? "").trim();
        rec.json_ok = true;
        rec.len_ok = rec.label.length > 0 && rec.label.length <= MAXLEN;
        rec.quote_ok = holds(rec.quote, ch.text);
        rec.pass = rec.len_ok && rec.quote_ok;
      } catch (e) {
        rec.ms = Date.now() - s;
        rec.json_ok = false;
        rec.pass = false;
        rec.error = String(e.message).slice(0, 120);
      }
      rows.push(rec);
      process.stdout.write(rec.pass ? "." : "x");
      if (c.vendor === "groq") await sleep(GAP_MS);
    }
  }
  const n = rows.length;
  const sum = {
    name: c.name, model: c.model, vendor: c.vendor, n,
    json: rows.filter((r) => r.json_ok).length,
    len: rows.filter((r) => r.len_ok).length,
    quote: rows.filter((r) => r.quote_ok).length,
    pass: rows.filter((r) => r.pass).length,
    avg_ms: Math.round(rows.reduce((a, r) => a + r.ms, 0) / n),
    avg_out: Math.round(rows.reduce((a, r) => a + (r.out ?? 0), 0) / n),
    // 같은 문단 두 회차가 다른 제목을 냈나 — 고정했으면 0 이어야 한다
    wobble: [...new Set(rows.map((r) => `${r.video_id}:${r.seq}`))]
      .filter((k) => {
        const two = rows.filter((r) => `${r.video_id}:${r.seq}` === k && r.pass);
        return two.length === 2 && two[0].label !== two[1].label;
      }).length,
    total_s: Math.round((Date.now() - t0) / 1000),
  };
  all.push(sum);
  console.log(`\n  ${c.name}: 통과 ${sum.pass}/${n} · JSON ${sum.json}/${n} · 인용 ${sum.quote}/${n} · ${sum.avg_ms}ms`);
  await mkdir("data/evals", { recursive: true });
  await writeFile(`data/evals/${stamp}-${c.model.replace(/\//g, "_")}.json`,
    JSON.stringify({ candidate: c, prompt: PROMPT, runs: RUNS, summary: sum, rows }, null, 1));
}

console.log("\n" + "─".repeat(62));
console.log("후보              통과      인용   흔들림  평균ms  출력tok");
for (const s of all.sort((a, b) => b.pass - a.pass)) {
  const pct = ((s.pass / s.n) * 100).toFixed(0).padStart(3);
  console.log(`${s.name.padEnd(18)}${pct}% ${String(s.pass).padStart(3)}/${s.n}  ` +
    `${String(s.quote).padStart(4)}  ${String(s.wobble).padStart(5)}  ${String(s.avg_ms).padStart(6)}  ${String(s.avg_out).padStart(6)}`);
}
await writeFile(`data/evals/${stamp}-summary.json`, JSON.stringify(all, null, 1));
console.log(`\ndata/evals/${stamp}-*.json 에 남김`);
