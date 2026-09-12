/**
 * Read-only embedding comparison over a frozen search run.
 * It never writes to Supabase or changes the deployed model.
 *
 * node --env-file=.env.local --import tsx scripts/compare-embedding-models.ts \
 *   data/evals/search/runs/<run>/results.json
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type Chunk = { video_id: string; seq: number; t: number; t_end: number; text: string };
type Target = { video_id: string; start: number; end: number };
type Question = { id: string; question: string; category: "answerable" | "no_answer"; targets: Target[] };
type FrozenRun = {
  dataset: { version: string; questions: Question[] };
  corpus_stable: boolean;
  corpus: { chunks: Chunk[] }[];
};

const MODELS = ["nlpai-lab/KURE-v1", "BAAI/bge-m3"] as const;
const BATCH = 16;
const TOP_K = 3;

function token() {
  const value = process.env.HF_TOKEN?.trim();
  if (!value) throw new Error("HF_TOKEN이 필요합니다.");
  return value;
}

async function embed(model: string, texts: string[]) {
  const vectors: number[][] = [];
  const timings: number[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const started = performance.now();
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}/pipeline/feature-extraction`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json" },
        body: JSON.stringify({ inputs: texts.slice(i, i + BATCH), normalize: true }),
        signal: AbortSignal.timeout(65_000),
      },
    );
    timings.push(Math.round(performance.now() - started));
    if (!response.ok) throw new Error(`${model}: HTTP ${response.status} ${(await response.text()).slice(0, 160)}`);
    const value: unknown = await response.json();
    if (!Array.isArray(value) || value.length !== Math.min(BATCH, texts.length - i)) {
      throw new Error(`${model}: 응답 개수 오류`);
    }
    for (const vector of value) {
      if (!Array.isArray(vector) || vector.length !== 1024 || vector.some((n) => !Number.isFinite(n))) {
        throw new Error(`${model}: 1024차원 벡터가 아님`);
      }
      vectors.push(vector as number[]);
    }
  }
  return { vectors, timings };
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const overlaps = (chunk: Chunk, target: Target) =>
  chunk.video_id === target.video_id && chunk.t < target.end && chunk.t_end > target.start;

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error("기준선 results.json 경로가 필요합니다.");
  const raw = await readFile(sourcePath, "utf8");
  const source = JSON.parse(raw) as FrozenRun;
  if (!source.corpus_stable) throw new Error("데이터가 안정적이지 않은 기준선은 비교하지 않습니다.");
  const chunks = source.corpus.flatMap((video) => video.chunks);
  const questions = source.dataset.questions;
  if (!chunks.length || !questions.length) throw new Error("문단 또는 질문이 없습니다.");

  const output = {
    protocol: "embedding-ranking-comparison-v1",
    created_at: new Date().toISOString(),
    source_run: basename(dirname(sourcePath)),
    source_sha256: createHash("sha256").update(raw).digest("hex"),
    dataset_version: source.dataset.version,
    fixed_conditions: { chunks: chunks.length, questions: questions.length, top_k: TOP_K, threshold: null, similarity: "cosine via normalized dot product" },
    decision_rule: "답 있는 질문의 hit@3가 KURE-v1보다 낮아지면 교체하지 않는다. 이를 유지하면서 정답 문단 순위가 개선되는지 확인한다. 의미 품질은 별도 검토한다.",
    models: [] as unknown[],
  };

  for (const model of MODELS) {
    const documentEmbeddings = await embed(model, chunks.map((chunk) => chunk.text));
    const queryEmbeddings = await embed(model, questions.map((question) => question.question));
    const records = questions.map((question, qi) => {
      const ranked = chunks
        .map((chunk, ci) => ({ ...chunk, score: dot(queryEmbeddings.vectors[qi], documentEmbeddings.vectors[ci]) }))
        .sort((a, b) => b.score - a.score);
      const correctRank = question.category === "answerable"
        ? ranked.findIndex((chunk) => question.targets.some((target) => overlaps(chunk, target))) + 1
        : null;
      return {
        id: question.id,
        category: question.category,
        correct_rank: correctRank || null,
        hit_at_3: question.category === "answerable" ? Boolean(correctRank && correctRank <= TOP_K) : null,
        top: ranked.slice(0, TOP_K).map(({ video_id, seq, t, t_end, text, score }) => ({ video_id, seq, t, t_end, text, score })),
      };
    });
    const answerable = records.filter((record) => record.category === "answerable");
    output.models.push({
      model,
      dimensions: 1024,
      document_batch_ms: documentEmbeddings.timings,
      query_batch_ms: queryEmbeddings.timings,
      answer_hit_at_3: answerable.filter((record) => record.hit_at_3).length,
      answer_questions: answerable.length,
      answer_top_1: answerable.filter((record) => record.correct_rank === 1).length,
      reciprocal_rank_sum: answerable.reduce((sum, record) => sum + (record.correct_rank ? 1 / record.correct_rank : 0), 0),
      records,
    });
    console.log(`${model}: 완료`);
  }

  const folder = join(dirname(sourcePath), "embedding-comparison-2026-09-12");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "results.json"), JSON.stringify(output, null, 2) + "\n");
  const rows = output.models as {model:string;answer_hit_at_3:number;answer_questions:number;answer_top_1:number;reciprocal_rank_sum:number;records:{id:string;correct_rank:number|null}[]}[];
  const questionsTable = questions.filter((q) => q.category === "answerable").map((q) => {
    const ranks = rows.map((m) => m.records.find((r) => r.id === q.id)?.correct_rank ?? "—");
    return `| ${q.id} | ${ranks.join(" | ")} |`;
  }).join("\n");
  const summary = `# 임베딩 모델 개발 비교\n\n기준: 답 있는 질문의 hit@3를 유지하면서 정답 문단 순위가 개선되는지 확인. 자동 순위는 시간 구간 겹침 기준이며 의미 품질은 별도 검토한다. 운영 모델은 변경하지 않았다.\n\n| 모델 | hit@3 | 정답 1위 | MRR |\n|---|---:|---:|---:|\n${rows.map((m) => `| ${m.model} | ${m.answer_hit_at_3}/${m.answer_questions} | ${m.answer_top_1}/${m.answer_questions} | ${(m.reciprocal_rank_sum/m.answer_questions).toFixed(3)} |`).join("\n")}\n\n| 질문 | ${rows.map((m) => m.model).join(" | ")} |\n|---|${rows.map(() => "---:").join("|")}|\n${questionsTable}\n\n주의: 기존 10문항을 재사용한 개발 비교다. 모델 선정과 이력서 수치 확정 전 결과 본문을 검토하고 새 질문으로 확인해야 한다.\n`;
  await writeFile(join(folder, "summary.md"), summary);
  console.log(folder);
}

main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
