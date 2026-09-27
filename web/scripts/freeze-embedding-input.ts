/** 임베딩 비교용 입력을 현재 배포 데이터에서 고정한다.
 *
 *  compare-embedding-models.ts 는 얼린 검색 실행 결과(results.json)를 입력으로 받는다.
 *  그런데 기존 실행은 native 전사 시절 리비전이라 지금 DB 와 맞지 않는다.
 *  여기서는 검색을 부르지 않고 현재 문단만 스냅샷으로 떠서 같은 모양의 파일을 만든다.
 *
 *  질문은 이미 검수된 평가셋을 그대로 쓴다. 정답은 문단 번호가 아니라 시간 구간이라
 *  전사문이 바뀌어도 그대로 유효하다.
 *
 *  node --env-file=.env.local --import tsx scripts/freeze-embedding-input.ts <dataset.json>
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

type Question = { id: string; review_status?: string };
type Dataset = { version: string; questions: Question[]; corpus: { video_id: string }[] };

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("평가셋 파일 경로가 필요합니다.");
  const raw = await readFile(path, "utf8");
  const dataset = JSON.parse(raw) as Dataset;

  const unreviewed = dataset.questions.filter((q) => q.review_status !== "approved");
  if (unreviewed.length) throw new Error(`검수되지 않은 문항: ${unreviewed.map((q) => q.id).join(", ")}`);

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  async function snapshot() {
    const videos = await db.from("video").select("id,revision,status,title").order("id");
    if (videos.error) throw new Error("영상 조회 실패");
    const out = [];
    for (const v of videos.data) {
      const chunks = await db.from("chunk").select("video_id,seq,t,t_end,text").eq("video_id", v.id).order("seq");
      if (chunks.error) throw new Error(`문단 조회 실패: ${v.id}`);
      out.push({ video: v, chunks: chunks.data });
    }
    return out;
  }

  // DB 에는 평가셋 이후에 넣은 영상도 있다. 비교는 평가셋 8편으로 한정한다 —
  // 검색 범위가 달라지면 이전 측정과 나란히 놓을 수 없다.
  const wanted = new Set(dataset.corpus.map((c) => c.video_id));
  const all = await snapshot();
  const before = all.filter((v) => wanted.has(v.video.id));
  const missing = [...wanted].filter((id) => !before.some((v) => v.video.id === id));
  if (missing.length) throw new Error(`평가셋 영상이 DB 에 없습니다: ${missing.join(", ")}`);
  const extra = all.length - before.length;
  for (const v of before) {
    // 여기서 쓰는 건 문단 글뿐이다(벡터는 후보 모델로 새로 만든다).
    // 상태는 목차 재생성 뒤 갱신이 안 된 경우가 있어 막지 않고 기록만 한다.
    if (!v.chunks.length) throw new Error(`문단 없음: ${v.video.id}`);
  }

  // 뜨는 동안 데이터가 바뀌지 않았는지 한 번 더 확인한다.
  const after = (await snapshot()).filter((v) => wanted.has(v.video.id));
  const stable = JSON.stringify(before) === JSON.stringify(after);

  const folder = `data/evals/search/runs/${new Date().toISOString().replace(/[:.]/g, "-")}-embedding-refresh`;
  await mkdir(folder, { recursive: true });

  const report = {
    protocol_version: "embedding-input-snapshot-v1",
    note: "검색 API 를 호출하지 않은 데이터 스냅샷이다. 임베딩 모델 비교 입력으로만 쓴다.",
    created_at: new Date().toISOString(),
    dataset_sha256: hash(raw),
    dataset: { version: dataset.version, questions: dataset.questions },
    corpus_stable: stable,
    corpus_scope: `평가셋 ${before.length}편으로 한정. DB 의 나머지 ${extra}편은 검색 범위에서 제외했다.`,
    corpus: before.map((v) => ({
      video: v.video,
      revision: v.video.revision,
      transcript_sha256: hash(v.chunks.map((c) => c.text).join(" ")),
      chunks: v.chunks,
    })),
  };
  await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2) + "\n");

  console.log(`DB ${all.length}편 중 평가셋 ${before.length}편 · 문단 ${before.reduce((n, v) => n + v.chunks.length, 0)}개`);
  console.log(`corpus_stable: ${stable}`);
  console.log(`${folder}/results.json`);
}

main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
