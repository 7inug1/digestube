"use client";

/** 새 영상을 넣는 동안 보여주는 진행 화면.
 *
 *  전사가 영상 길이의 10~15% 를 먹는다(13.3분 영상 54초). 글자 한 줄로는
 *  멈춘 것과 구분이 안 돼서 v1 의 진행 화면을 v2 단계에 맞춰 다시 만들었다.
 *
 *  단계는 서버가 실제로 하는 일과 1:1 이다: 전사 → 문단 → 목차 → 검색 준비.
 *  목차·검색 준비는 남은 개수를 돌려주므로 그 비율을 그대로 쓴다.
 *  전사는 끝나기 전에는 얼마나 남았는지 알 수 없어 **퍼센트를 지어내지 않고**
 *  경과 시간만 보여준다.
 */
import Link from "next/link";

export type StageName = "전사" | "문단" | "목차" | "검색 준비";
export type StageState = "queued" | "running" | "done" | "error";

export type Progress = {
  vid: string | null;
  title?: string | null;
  stage: StageName;
  state: StageState;
  /** 목차·검색 준비처럼 개수를 아는 단계에서만 채운다. */
  ratio?: number | null;
  detail?: string;
  elapsedSec?: number;
  error?: string;
};

const STAGES: StageName[] = ["전사", "문단", "목차", "검색 준비"];
/** 전사가 제일 오래 걸린다. 막대가 실제 체감과 비슷하게 움직이도록 가중치를 둔다. */
const WEIGHT: Record<StageName, number> = {전사: 0.5, 문단: 0.05, 목차: 0.3, "검색 준비": 0.15};

const ICON: Record<StageState, string> = {queued: "○", running: "◐", done: "✓", error: "✕"};

/** 서버가 돌려준 문장에서 실패 종류를 가린다. 종류를 모르면 그대로 보여준다. */
export function failureKind(message: string): {icon: string; label: string} {
  const m = message ?? "";
  if (/quota|한도|429/i.test(m)) return {icon: "⏳", label: "하루 사용 한도 초과"};
  if (/credit|크레딧|잔액/i.test(m)) return {icon: "💳", label: "API 크레딧 부족"};
  if (/라이브|live/i.test(m)) return {icon: "🔴", label: "라이브 방송"};
  if (/비공개|제한|restricted|403/i.test(m)) return {icon: "🔒", label: "접근 제한"};
  if (/음성|no_speech|비어/i.test(m)) return {icon: "📭", label: "음성 없음"};
  if (/시간|timeout|오래/i.test(m)) return {icon: "⏱️", label: "시간 초과"};
  return {icon: "⚠️", label: "처리 실패"};
}

function percent(p: Progress): number {
  let done = 0;
  for (const s of STAGES) {
    if (STAGES.indexOf(s) < STAGES.indexOf(p.stage)) done += WEIGHT[s];
    else if (s === p.stage && p.ratio != null) done += WEIGHT[s] * Math.min(1, Math.max(0, p.ratio));
  }
  return Math.round(done * 100);
}

function stageState(p: Progress, s: StageName): StageState {
  if (p.state === "error" && s === p.stage) return "error";
  if (STAGES.indexOf(s) < STAGES.indexOf(p.stage)) return "done";
  if (s === p.stage) return p.state === "done" ? "done" : "running";
  return "queued";
}

export default function IngestProgress({progress}: {progress: Progress}) {
  const {vid, title, stage, state, detail, elapsedSec, error} = progress;
  // 전사 중에는 남은 양을 알 수 없다. 막대를 흐르게 두고 경과 시간만 적는다.
  const unknown = stage === "전사" && state === "running";
  const pct = percent(progress);
  const failed = state === "error";
  const kind = failed ? failureKind(error ?? "") : null;

  return (
    <div data-testid="ingest-progress" role={failed ? "alert" : "status"}
         className="mt-5 rounded-xl border border-line p-4">
      <div className="flex items-center gap-3">
        {vid ? (
          <img src={`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`} alt="" loading="lazy"
               className="h-[58px] w-[104px] shrink-0 rounded-md bg-muted object-cover" />
        ) : (
          <div className="h-[58px] w-[104px] shrink-0 animate-pulse rounded-md bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          {title ? (
            <p className="truncate text-[14px] font-medium">{title}</p>
          ) : (
            <div className="mb-1.5 h-3.5 w-[70%] animate-pulse rounded bg-muted" />
          )}
          <p className="truncate text-[12px] text-mfg">
            {failed ? `${kind!.icon} ${kind!.label}` : detail ?? `${stage} 중…`}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[12px] text-mfg">
          {failed ? "" : unknown ? `${elapsedSec ?? 0}초` : `${pct}%`}
        </span>
      </div>

      <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        {unknown ? (
          <div className="h-full w-1/3 animate-[ingest-slide_1.4s_ease-in-out_infinite] rounded-full bg-fg" />
        ) : (
          <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? "bg-red-500" : "bg-fg"}`}
               style={{width: `${failed ? 100 : pct}%`}} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {STAGES.map(s => {
          const st = stageState(progress, s);
          return (
            <span key={s} className={`flex items-center gap-1.5 text-[12px] ${
              st === "done" ? "text-mfg" : st === "error" ? "text-red-500"
              : st === "running" ? "font-medium text-fg" : "text-mfg opacity-40"}`}>
              <span className={`font-mono ${st === "running" ? "animate-pulse" : ""}`}>{ICON[st]}</span>
              {s}
            </span>
          );
        })}
      </div>

      {failed && (
        <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-[1.7] text-mfg">{error}</p>
      )}
      {vid && !failed && (
        <Link href={`/videos/${vid}`} className="mt-3 inline-block text-[12.5px] text-mfg underline">
          지금까지 만들어진 내용 보기
        </Link>
      )}
    </div>
  );
}
