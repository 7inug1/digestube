"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AnswerCard from "./AnswerCard";
import { useSearchStream } from "@/lib/use-search";
import { stageOf, STAGE_TEXT } from "@/lib/search-stream";
import { JUMP_EVENT, isPaletteShortcut, splitVideoHref } from "@/lib/palette";
import { warmReranker } from "@/lib/warm";
import { matchParagraphs, terms, type IndexVideo, type KeywordHit } from "@/lib/keyword";
import { mine } from "@/lib/mine";

const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PREVIEW = 5;

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    out.push(text.slice(at, a), <mark key={a} className="rounded-[3px] bg-keep/55 px-0.5 font-semibold text-fg">{text.slice(a, b)}</mark>);
    at = b;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

/** 헤더 🔍 → 지금 페이지 위에 뜨는 라이브러리 검색 창.
 *
 *  예전에는 검색 화면으로 넘어가 읽던 자리를 잃었다. 창으로 띄우면 닫았을 때 보던 페이지와
 *  스크롤이 그대로다. 결과·각주를 고르면 그 영상의 그 문단으로 가서 잠깐 반짝인다.
 *  헤더(레이아웃)에 살아 있어서 페이지를 옮겨도 마지막 검색이 남는다.
 *  접근성은 WAI-ARIA 대화상자 + 콤보박스 패턴 — 열면 입력창, 닫으면 아이콘으로 포커스가 돌아온다.
 *  입력하는 동안에는 글자가 맞는 대목을 먼저 보여 준다(lib/keyword). 뜻으로 찾기는 Enter·찾기.
 */
export default function SearchPalette({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [asked, setAsked] = useState("");
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState<IndexVideo[] | null>(null);
  const s = useSearchStream(asked, { signedIn });
  const hits = s.done && s.hits && !s.weak ? s.hits : [];
  // 아직 찾기 전인 입력이 있으면 글자가 맞는 대목을 보여 준다. 타자가 빠를 땐 한 박자 늦게 따라온다
  const typed = useDeferredValue(input.trim());
  const previewing = Boolean(input.trim()) && input.trim() !== asked;
  const matched = useMemo(() => index ? matchParagraphs(index, terms(typed), Infinity) : [], [index, typed]);
  const shown = previewing ? matched.slice(0, PREVIEW) : [];
  const list: { video_id: string; seq: number }[] = previewing ? shown : hits;
  // 결과가 바뀌면 고른 줄이 범위를 벗어날 수 있다 — 벗어나면 고르지 않은 것으로 본다
  const current = active < list.length ? active : -1;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  // 결과·각주를 고르면 그 영상의 그 문단으로 간다. 같은 영상이면 새로 불러오지 않고 바로 옮긴다.
  const go = useCallback((href: string) => {
    close(false);
    const v = splitVideoHref(href);
    if (v && v.path === pathname) {
      window.history.pushState(null, "", href);
      window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { seq: v.seq } }));
    } else router.push(href);
  }, [close, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
      if (!open && isPaletteShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, typing })) {
        e.preventDefault(); setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    warmReranker();
    requestAnimationFrame(() => { box.current?.focus(); box.current?.select(); });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";   // 뒤 페이지가 같이 구르지 않게
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // 전사문은 처음 열 때 한 번만 받는다. 못 받으면 미리보기 없이 뜻으로 찾기만 된다
  useEffect(() => {
    if (!open || index) return;
    const p = new URLSearchParams();
    if (!signedIn) p.set("ids", mine().join(","));
    fetch(`/api/library/text?${p}`).then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.videos) setIndex(d.videos); }).catch(() => {});
  }, [open, index, signedIn]);

  const submit = () => {
    const q = input.trim();
    if (!q) return;
    // 미리보기 줄을 골랐으면 그 대목으로 간다. 고르지 않았으면 뜻으로 찾는다
    if (previewing && current >= 0) {
      const h = shown[current];
      go(`/videos/${h.video_id}#ck${h.seq}`);
      return;
    }
    // 같은 검색어에서 Enter 는 고른 결과(없으면 첫 결과)로 간다
    if (q === asked && s.done && hits.length) {
      const h = hits[Math.max(0, current)];
      go(`/videos/${h.video_id}#ck${h.seq}`);
      return;
    }
    setActive(-1);
    setAsked(q);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "ArrowDown" && list.length) { e.preventDefault(); setActive(Math.min(list.length - 1, current + 1)); }
    else if (e.key === "ArrowUp" && list.length) { e.preventDefault(); setActive(Math.max(0, current - 1)); }
  };

  // 창 안의 영상 링크(답 각주·근거 목록)도 같은 방식으로 옮긴다
  const onClickCapture = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (href && splitVideoHref(href)) { e.preventDefault(); go(href); }
  };

  // Tab 이 창 밖으로 나가지 않게 한다
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>("a,button,input")].filter(el => !el.hasAttribute("disabled"));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
              aria-label="검색 (⌘K)" title="검색 (⌘K)"
              className="grid h-8 w-8 place-items-center rounded-md text-fg/65 transition-colors hover:bg-muted hover:text-fg">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      {/* 헤더(backdrop-blur) 안에 두면 fixed 가 헤더 크기에 갇힌다 — 문서 맨 아래에 그린다 */}
      {open && createPortal(
        <div className="fixed inset-0 z-50" onKeyDown={trap}>
          <div className="absolute inset-0 bg-fg/25 backdrop-blur-[2px]" onClick={() => close()} aria-hidden />
          <div ref={panel} role="dialog" aria-modal="true" aria-label="라이브러리 검색" onClickCapture={onClickCapture}
               className="absolute inset-0 flex flex-col overflow-hidden bg-bg sm:inset-x-0 sm:top-[8vh] sm:bottom-auto sm:mx-auto
                          sm:max-h-[84vh] sm:w-[min(680px,92vw)] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0 text-mfg" aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input ref={box} value={input} onChange={e => { setInput(e.target.value); setActive(-1); }} onKeyDown={onKeyDown}
                     role="combobox" aria-expanded={list.length > 0} aria-controls="palette-results" aria-autocomplete="none"
                     aria-activedescendant={current >= 0 ? `palette-opt-${current}` : undefined}
                     placeholder="라이브러리에서 뜻으로 찾아요 — 영상에 없는 표현도 괜찮아요"
                     className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-mfg" />
              {/* Enter 를 치기 어려운 환경(일부 휴대폰 키보드·마우스만 쓰는 경우)을 위해 버튼으로도 찾는다 */}
              <button type="button" onClick={submit} disabled={!input.trim()}
                      className="h-8 shrink-0 rounded-lg bg-fg px-3.5 text-[13px] font-semibold text-bg disabled:cursor-default disabled:opacity-35">
                찾기
              </button>
              <button type="button" onClick={() => close()} aria-label="검색 창 닫기" title="닫기 (Esc)"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mfg hover:bg-muted hover:text-fg">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {previewing ? (
                <Preview all={matched} shown={shown} current={current} loading={!index} words={terms(typed).length}
                         onPick={h => go(`/videos/${h.video_id}#ck${h.seq}`)} onHover={setActive} />
              ) : !asked ? (
                <p className="mt-4 text-small text-mfg">저장한 영상 전체에서 찾아요. Enter 로 검색, ↑↓ 로 고르고 Enter 로 그 대목에 가요.</p>
              ) : s.failed ? (
                <p className="mt-4 text-small text-mfg">검색에 실패했어요 — {s.failed}</p>
              ) : !s.done ? (
                <p className="mt-4 text-small text-mfg" role="status" aria-live="polite">{STAGE_TEXT[stageOf(s) === "check" ? "check" : "find"]}</p>
              ) : s.weak || !hits.length ? (
                <div className="mt-4" role="status">
                  <p className="text-[15px] font-semibold">라이브러리에서 이 질문에 맞는 내용을 찾지 못했어요.</p>
                  <Link href={`/search?q=${encodeURIComponent(asked)}`} onClick={() => close(false)}
                        className="mt-2 inline-block text-small text-mfg underline underline-offset-4 hover:text-fg">
                    검색 페이지에서 가까운 대목 보기
                  </Link>
                </div>
              ) : (
                <>
                  <AnswerCard q={asked} hits={hits} />
                  <ul id="palette-results" role="listbox" aria-label="검색 결과" className="mt-4 grid gap-1">
                    {hits.map((h, i) => (
                      <li key={`${h.video_id}:${h.seq}`} id={`palette-opt-${i}`} role="option" aria-selected={i === current}>
                        <button type="button" onClick={() => go(`/videos/${h.video_id}#ck${h.seq}`)} onMouseEnter={() => setActive(i)}
                                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${i === current ? "bg-muted" : "hover:bg-muted/60"}`}>
                          <span className="flex min-w-0 items-baseline gap-2 text-[12.5px] text-mfg">
                            <span className="truncate font-semibold text-fg/80">{h.title}</span>
                            <span className="shrink-0 font-mono">{mm(h.t)}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[14px] leading-[1.6]">{h.hl ?? h.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Link href={`/search?q=${encodeURIComponent(asked)}`} onClick={() => close(false)}
                        className="mt-3 inline-block text-small text-mfg underline underline-offset-4 hover:text-fg">
                    전체 결과 페이지로 보기 →
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** 입력하는 동안의 "글자가 맞는 대목" 목록. 뜻으로 찾은 결과가 아니라는 것을 제목에 밝힌다. */
function Preview({ all, shown, current, loading, words, onPick, onHover }: {
  all: KeywordHit[]; shown: KeywordHit[]; current: number; loading: boolean; words: number;
  onPick: (h: KeywordHit) => void; onHover: (i: number) => void;
}) {
  if (loading || !words) return <p className="mt-4 text-small text-mfg">Enter 나 찾기를 누르면 뜻으로 찾아요.</p>;
  if (!all.length) return <p className="mt-4 text-small text-mfg">글자가 맞는 대목은 없어요 — 찾기를 누르면 뜻으로 찾아요.</p>;
  const videos = new Set(all.map(h => h.video_id)).size;
  return (
    <>
      <p className="mt-3 text-[12.5px] text-mfg" aria-live="polite">
        글자가 맞는 대목 · {videos}편 {all.length}곳 <span className="text-mfg/80">(뜻으로 찾으려면 찾기)</span>
      </p>
      <ul id="palette-results" role="listbox" aria-label="글자가 맞는 대목" className="mt-1.5 grid gap-1">
        {shown.map((h, i) => (
          <li key={`${h.video_id}:${h.seq}`} id={`palette-opt-${i}`} role="option" aria-selected={i === current}>
            <button type="button" onClick={() => onPick(h)} onMouseEnter={() => onHover(i)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${i === current ? "bg-muted" : "hover:bg-muted/60"}`}>
              <span className="flex min-w-0 items-baseline gap-2 text-[12.5px] text-mfg">
                <span className="truncate font-semibold text-fg/80">{h.title}</span>
                <span className="shrink-0 font-mono">{mm(h.t)}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[14px] leading-[1.6]"><Marked text={h.snippet} ranges={h.ranges} /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
