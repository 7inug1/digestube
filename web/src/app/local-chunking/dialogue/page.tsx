import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Reader from "@/components/Reader";
import { readTime } from "@/lib/format";
import { chunk, type Chunk, type Piece } from "@/lib/chunker";

export const dynamic = "force-dynamic";

const seconds = (value: string) => value.split(":").reduce((n, v) => n * 60 + Number(v), 0);

export default async function Dialogue({searchParams}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const mode = (await searchParams).mode ?? "readable";
  const current = mode === "current";
  const root = path.join(process.cwd(), "data/evals/chunking/topic-dialogue");
  const runs = (await readdir(root).catch(() => [])).sort();
  if (!runs.length) return <p>대담 영상 분할 결과를 준비하고 있습니다.</p>;
  const dir = path.join(root, runs.at(-1)!);
  const readableRoot = path.join(process.cwd(), "data/evals/chunking/topic-readable");
  const readableRuns = (await readdir(readableRoot).catch(() => [])).sort();
  // 후보(Haiku·Gemini)는 같은 프롬프트·같은 긴 주제 8개로 따로 돌린 결과다.
  // 실패한 후보도 파일이 남으므로 결과가 있는 최신 실행을 고른다.
  const candRoot = path.join(process.cwd(), "data/evals/chunking/topic-readable-candidates");
  const candRuns = (await readdir(candRoot).catch(() => [])).sort();
  const candidate = mode === "haiku-readable" ? "haiku" : mode === "gemini-readable" ? "gemini" : null;
  let candidatePath: string | null = null;
  if (candidate) {
    for (const run of [...candRuns].reverse()) {
      const file = path.join(candRoot, run, `${candidate}.json`);
      const found = await readFile(file, "utf8").then(t => JSON.parse(t) as {chunks: unknown}).catch(() => null);
      if (found) { candidatePath = file; if (found.chunks) break; }
    }
  }
  const recordPath = candidatePath
    ? candidatePath
    : mode === "model-readable" && readableRuns.length
    ? path.join(readableRoot, readableRuns.at(-1)!, "sonnet.json")
    : path.join(dir, current ? "current.json" : "sonnet.json");
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    chunks: Chunk[] | null; error: string | null; ms: number; model?: string;
    starts: number[] | null;
    usage?: Record<string, number | undefined>;
    checks: {problems: string[]; textPreserved?: boolean; lengths?: {min: number; median: number; max: number}} | null;
  };
  let result = record.chunks ?? [];
  if (mode === "readable" && record.starts) {
    const source = JSON.parse(await readFile(path.join(process.cwd(), "data/evals/chunking/dialogue-source.json"), "utf8")) as {
      segments: {start: string; end: string; text: string}[];
    };
    const pieces: Piece[] = source.segments.map(s => ({
      text: s.text,
      offset: seconds(s.start) * 1000,
      duration: (seconds(s.end) - seconds(s.start)) * 1000,
    }));
    const starts = record.starts[0] === 1 ? record.starts : [1, ...record.starts];
    result = starts.flatMap((start, i) =>
      chunk(pieces.slice(start - 1, (starts[i + 1] ?? pieces.length + 1) - 1), 180, 240));
  }
  const chunks = result.map((c, seq) => ({...c, seq}));
  const label = current ? "현재 길이 방식" : mode === "topic" ? "Sonnet 주제 방식"
    : mode === "model-readable" ? "Sonnet 맥락+길이" : mode === "haiku-readable" ? "Haiku 맥락+길이"
    : mode === "gemini-readable" ? "Gemini 맥락+길이" : "코드 길이 보정";
  // 지금 비교하는 것만 앞에 둔다. 나머지는 지난 실험이라 접어둔다.
  const tabs = [
    {mode: "model-readable", name: "Sonnet"},
    {mode: "haiku-readable", name: "Haiku"},
    {mode: "gemini-readable", name: "Gemini"},
  ];
  const older = [
    {mode: "", name: "코드 180/240 보정"},
    {mode: "topic", name: "Sonnet 주제 12개"},
    {mode: "current", name: "현재 길이 방식"},
  ];
  const lengths = record.checks?.lengths;
  return <div className="mx-auto max-w-[1320px]">
    <div className="mb-6 rounded-xl border border-line p-4">
      <p className="font-semibold">한국어 대담 · {label} · {chunks.length}문단</p>
      <p className="mt-2 text-sm text-mfg">맥락+길이 판단은 Sonnet이 280~360자를 참고해 자연스러운 경계를 고르고, 코드는 700자 초과만 안전장치로 나눕니다.</p>
      {/* 같은 전사문·같은 프롬프트로 돌린 후보를 눌러가며 바로 대조한다 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {tabs.map(t => {
          const on = (mode === "readable" && t.mode === "") || mode === t.mode;
          return <a key={t.name} href={`/local-chunking/dialogue${t.mode ? `?mode=${t.mode}` : ""}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-fg bg-fg font-semibold text-bg" : "border-line text-mfg hover:bg-muted"}`}>
            {t.name}
          </a>;
        })}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-mfg">지난 실험도 보기</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {older.map(t => {
            const on = (mode === "readable" && t.mode === "") || mode === t.mode;
            return <a key={t.name} href={`/local-chunking/dialogue${t.mode ? `?mode=${t.mode}` : ""}`}
              className={`rounded-lg border px-3 py-1.5 text-xs ${on ? "border-fg font-semibold" : "border-line text-mfg hover:bg-muted"}`}>
              {t.name}
            </a>;
          })}
          <a href="/local-chunking?mode=sonnet-balanced"
             className="rounded-lg border border-line px-3 py-1.5 text-xs text-mfg hover:bg-muted">이전 설명 영상</a>
        </div>
      </details>
      <p className="mt-3 font-mono text-xs text-mfg">
        {record.model ?? "코드"} · {record.ms ? `${(record.ms / 1000).toFixed(1)}초` : "-"}
        {record.usage ? ` · 입력 ${record.usage.input ?? "-"} 출력 ${record.usage.output ?? "-"}` : ""}
        {lengths ? ` · 길이 ${lengths.min}/${lengths.median}/${lengths.max}자` : ""}
        {record.checks ? ` · 원문 보존 ${record.checks.textPreserved ? "O" : "X"}` : ""}
        {record.checks?.problems?.length ? ` · 검사 ${record.checks.problems.join(", ")}` : ""}
      </p>
      {record.error && <p className="mt-3 text-red-500">실행 실패: {record.error}</p>}
    </div>
    {chunks.length > 0 && <Reader key={mode} vid="byVgbqzYJrs" chunks={chunks} outline={[]}
      meta={{ title: "한국어 대담 · 주제 기반 문단 비교", channel: "실험용 화면",
        seconds: chunks.at(-1)!.t_end, read: readTime(chunks.reduce((n,c) => n+c.text.length,0)),
        mode: "generate", lang: "ko" }} />}
  </div>;
}
