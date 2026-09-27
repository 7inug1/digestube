/** 골든셋 v3 로 운영 검색을 한 번 돌려 결과를 저장하고, 지금 방식(A: 리랭커 1위 점수 < -4)을 채점한다.
 *
 *    node evals/search/goldenset-run.mjs dev      # 개발용 15개
 *    node evals/search/goldenset-run.mjs test     # 확인용 15개 — 방법을 고른 뒤 한 번만
 *
 *  검색 결과(문단·벡터 점수·리랭커 점수·본문)를 그대로 저장한다. 다른 판단 방법(B·C)은
 *  이 저장본으로 채점해 같은 검색 결과 위에서 비교한다 — 다시 검색하면 결과가 흔들린다.
 *  범위는 스냅샷 8편. 로그인 없이 ids 로 넘기고, 서비스가 붙이는 샘플도 8편 안에 있다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.DIGESTUBE_BASE ?? "https://digestube.vercel.app";
const split = process.argv[2];
if (split !== "dev" && split !== "test") throw new Error("dev 또는 test");
const gold = JSON.parse(readFileSync("data/evals/search/questions.v3.json", "utf8"));
const snap = JSON.parse(readFileSync(gold.corpus_snapshot.path, "utf8"));
const IDS = snap.corpus.map(v => v.video.id);
const questions = gold.questions.filter(q => q.split === split);

async function search(q) {
  const url = `${BASE}/api/search?${new URLSearchParams({ q, k: "3", rerank: "1", ids: IDS.join(",") })}`;
  // 리랭커가 잠들어 있으면 판단을 건너뛴다(weak=null). 깨어날 때까지 세 번까지 다시 부른다.
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
    const d = await r.json();
    if (d.rerank?.weak !== null && d.rerank?.weak !== undefined) return { ...d, ms: Date.now() - t0, tries: i + 1 };
  }
  throw new Error(`리랭커 판단을 세 번 모두 받지 못함: ${q}`);
}

await fetch(`${BASE}/api/rerank/warm`, { method: "POST" }).catch(() => {});
const rows = [];
for (const q of questions) {
  const d = await search(q.question);
  const hits = d.hits.map(h => ({ video_id: h.video_id, seq: h.seq, score: h.score, rerank_score: h.rerank_score, text: h.text }));
  const required = q.evidence.filter(e => e.role === "required");
  const found = required.filter(e => hits.some(h => h.video_id === e.video_id && e.seqs.includes(h.seq)));
  const trapHit = q.evidence.filter(e => e.role === "trap").some(e => hits.some(h => h.video_id === e.video_id && e.seqs.includes(h.seq)));
  const answerable = q.category === "answerable";
  rows.push({
    id: q.id, kind: q.kind, question: q.question, answerable,
    required: required.length, found: found.length, trap_in_top3: trapHit,
    weak: d.rerank.weak, top: d.rerank.top, cut: d.rerank.cut, ms: d.ms, tries: d.tries,
    // A 판정이 맞았나: 답 있으면 "찾지 못함"이 아니어야, 답 없으면 "찾지 못함"이어야 한다
    a_correct: answerable ? d.rerank.weak === false : d.rerank.weak === true,
    hits,
  });
  console.log(`${q.id} ${q.kind.padEnd(9)} 근거 ${found.length}/${required.length}  top ${d.rerank.top}  weak ${d.rerank.weak}  A ${rows.at(-1).a_correct ? "맞음" : "틀림"}`);
}

const ans = rows.filter(r => r.answerable), none = rows.filter(r => !r.answerable);
const summary = {
  split, n: rows.length, base: BASE, run_at: new Date().toISOString(), gold_version: gold.version,
  search: {
    required_found: `${ans.reduce((n, r) => n + r.found, 0)}/${ans.reduce((n, r) => n + r.required, 0)}`,
    all_found_questions: `${ans.filter(r => r.found === r.required).length}/${ans.length}`,
  },
  method_A: {
    rule: "리랭커 1위 점수 < -4 이면 찾지 못함",
    correct: `${rows.filter(r => r.a_correct).length}/${rows.length}`,
    answerable_not_rejected: `${ans.filter(r => r.a_correct).length}/${ans.length}`,
    no_answer_rejected: `${none.filter(r => r.a_correct).length}/${none.length}`,
  },
};
console.log(JSON.stringify(summary, null, 2));
mkdirSync("evals/search/runs", { recursive: true });
const file = `evals/search/runs/${summary.run_at.replace(/[:.]/g, "-")}-goldenset-${split}.json`;
writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
console.log("저장:", file);
