import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Reader from "@/components/Reader";
import { chunk, MAXLEN, type Chunk } from "@/lib/chunker";
import { readTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Codex 가 전사문을 읽고 손으로 고른 경계. 이번 영상에 맞춘 시안이며
// 자동 분할의 정답도, 독립적인 성능 근거도 아니다. 참고용으로만 남긴다.
const CODEX = [0, 5, 9, 14, 18, 22, 24, 28, 30, 32, 35, 39, 41, 43, 48, 50, 53, 56, 60, 62];

const seconds = (value: string) => value.split(":").reduce((n, v) => n * 60 + Number(v), 0);

type Record_ = {
  key: string; provider: string; model: string; ms: number;
  error: string | null; starts: number[] | null; chunks: Chunk[] | null;
  usage: { input?: number; output?: number; thoughts?: number } | null;
  checks: { chunkCount: number; problems: string[]; textPreserved: boolean;
            lengths: { min: number; median: number; max: number } } | null;
};
type Finding = { between: string; type: string; why: string };

const TABS = [
  { key: "current", label: "현재 방식" },
  { key: "gemini", label: "Gemini Flash" },
  { key: "sonnet", label: "Sonnet" },
  { key: "sonnet-refined", label: "Sonnet 수정 후" },
  { key: "sonnet-balanced", label: "Sonnet 재조정" },
  { key: "haiku", label: "Haiku" },
  { key: "codex", label: "Codex 수동 시안" },
];

export default async function Preview({ searchParams }: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const mode = (await searchParams).mode ?? "current";

  const root = path.join(process.cwd(), "data/evals/chunking/topic");
  const runs = (await readdir(root).catch(() => [])).sort();
  if (!runs.length) {
    return <p className="mx-auto max-w-[620px]">
      실험 결과가 없습니다. <code>scripts/compare-topic-chunking.ts</code> 를 먼저 실행하세요.
    </p>;
  }
  const dir = path.join(root, runs.at(-1)!);
  const run = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")) as {
    source: string; transcriptModel: string; segments: number; ranAt: string;
    samplingNote?: string; results: { key: string; model: string }[];
  };
  const review = await readFile(path.join(dir, "review.json"), "utf8")
    .then(s => JSON.parse(s) as { caveat: string; reviews: Record<string, { findings?: Finding[] }> })
    .catch(() => null);

  const source = JSON.parse(await readFile(path.join(process.cwd(), run.source), "utf8")) as {
    segments: { start: string; end: string; text: string }[];
  };
  const pieces = source.segments.map(s => ({
    text: s.text, offset: seconds(s.start) * 1000,
    duration: (seconds(s.end) - seconds(s.start)) * 1000,
  }));

  // Codex 시안은 실험 실행에 들어있지 않다. 같은 보정 규칙으로 여기서 만든다.
  const codex: Record_ = {
    key: "codex", provider: "manual", model: "Codex 수동 시안 (참고용, 정답 아님)",
    ms: 0, error: null, starts: CODEX.map(i => i + 1), usage: null,
    chunks: CODEX.flatMap((start, i) => chunk(pieces.slice(start, CODEX[i + 1] ?? pieces.length), MAXLEN, MAXLEN)),
    checks: null,
  };

  const refinedRoot = path.join(process.cwd(), "data/evals/chunking/topic-refined");
  const refinedRuns = (await readdir(refinedRoot).catch(() => [])).sort();
  const balancedRoot = path.join(process.cwd(), "data/evals/chunking/topic-balanced");
  const balancedRuns = (await readdir(balancedRoot).catch(() => [])).sort();
  const load = async (key: string): Promise<Record_ | null> =>
    key === "codex" ? codex
      : key === "sonnet-balanced" ? (balancedRuns.length
        ? readFile(path.join(balancedRoot, balancedRuns.at(-1)!, "sonnet.json"), "utf8")
          .then(s => JSON.parse(s) as Record_).catch(() => null) : null)
      : key === "sonnet-refined" ? (refinedRuns.length
        ? readFile(path.join(refinedRoot, refinedRuns.at(-1)!, "sonnet.json"), "utf8")
          .then(s => JSON.parse(s) as Record_).catch(() => null) : null)
      : readFile(path.join(dir, `${key}.json`), "utf8").then(s => JSON.parse(s) as Record_).catch(() => null);

  const shown = await load(mode);
  const all = await Promise.all(TABS.map(t => load(t.key)));

  const total = seconds(source.segments.at(-1)!.end);
  const chunks = (shown?.chunks ?? []).map((c, seq) => ({ ...c, seq }));
  const findings = review?.reviews?.[mode]?.findings ?? [];

  return <div className="mx-auto max-w-[1320px]">
    <div className="mb-6 rounded-xl border border-line p-4">
      <p className="text-[15px] font-semibold">
        문단 나누기 비교 · 준비 실험 1편 — 최종 모델 선정 근거가 아닙니다
      </p>
      <p className="mt-1 text-[13px] text-mfg">
        같은 전사문({run.transcriptModel} · 발화 {run.segments}개)을 사용합니다. Sonnet 수정 후·재조정은 사용자 피드백을 반영한 별도 프롬프트입니다.
        번호 붙이는 방식과 긴 문단 보정({MAXLEN}자)은 후보 전체에 똑같이 적용했습니다.
        실행 {new Date(run.ranAt).toLocaleString("ko-KR")}.
      </p>
      {run.samplingNote && <p className="mt-2 text-[12.5px] text-mfg">⚠ {run.samplingNote}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t, i) => {
          const r = all[i];
          const on = t.key === mode;
          return <a key={t.key} href={`/local-chunking?mode=${t.key}`}
            className={`rounded-lg border px-3 py-2 text-[13px] ${
              on ? "border-fg bg-fg text-bg font-semibold" : "border-line hover:bg-muted"}`}>
            {t.label}
            <span className={`ml-2 font-mono text-[11px] ${on ? "opacity-70" : "text-mfg"}`}>
              {r?.error ? "실패" : r?.chunks ? `${r.chunks.length}문단` : "없음"}
            </span>
          </a>;
        })}
      </div>

      {shown && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
        <div><dt className="text-mfg">모델</dt><dd className="font-mono break-all">{shown.model}</dd></div>
        <div><dt className="text-mfg">걸린 시간</dt><dd className="font-mono">{shown.ms ? `${shown.ms}ms` : "—"}</dd></div>
        <div><dt className="text-mfg">토큰(입력/출력)</dt>
          <dd className="font-mono">{shown.usage ? `${shown.usage.input ?? "?"} / ${shown.usage.output ?? "?"}${
            shown.usage.thoughts ? ` (+${shown.usage.thoughts} 추론)` : ""}` : "—"}</dd></div>
        <div><dt className="text-mfg">문단 길이 min/중앙/max</dt>
          <dd className="font-mono">{shown.checks
            ? `${shown.checks.lengths.min} / ${shown.checks.lengths.median} / ${shown.checks.lengths.max}` : "—"}</dd></div>
      </dl>}

      {shown?.error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-500">
        이 후보는 실행하지 못했습니다 — {shown.error}
      </p>}

      {shown?.checks && <p className="mt-3 text-[13px]">
        <span className="text-mfg">코드 검사</span>{" "}
        {shown.checks.problems.length === 0
          ? <span className="font-medium">통과 — 원문·시각·순서·번호 이상 없음</span>
          : <span className="font-medium text-red-500">{shown.checks.problems.join(" ")}</span>}
      </p>}

      {findings.length > 0 && <div className="mt-3 rounded-lg border border-line bg-muted/40 p-3">
        <p className="text-[12.5px] font-semibold">AI 검토 초안 · 판정이 아닙니다</p>
        <ul className="mt-2 grid gap-1.5 text-[12.5px] text-mfg">
          {findings.map(f => <li key={f.between}>
            <span className="font-mono">{f.between}</span> · {f.type} — {f.why}
          </li>)}
        </ul>
        {review?.caveat && <p className="mt-2 text-[11.5px] text-mfg opacity-80">{review.caveat}</p>}
      </div>}

      {mode === "codex" && <p className="mt-3 text-[12.5px] text-mfg">
        사람이 이 영상 하나를 보고 고른 경계입니다. 자동 분할의 정답으로 취급하지 않습니다.
      </p>}
    </div>

    {chunks.length > 0 && <Reader key={mode} vid="JRJd1ZrHmgg" chunks={chunks} outline={[]}
      meta={{ title: "비전보드를 실행으로 연결하는 방법 · 문단 나누기 비교", channel: "실험용 화면",
        seconds: total, read: readTime(pieces.reduce((n, p) => n + p.text.length, 0)),
        mode: "generate", lang: "ko" }} />}
  </div>;
}
