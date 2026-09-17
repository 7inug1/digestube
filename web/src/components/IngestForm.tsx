"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { remember } from "@/lib/mine";
import IngestProgress, {type Progress, type StageName} from "./IngestProgress";

type Existing = {vid:string;url:string;title?:string};
class ApiError extends Error {
  constructor(message:string, public code?:string, public vid?:string, public title?:string) { super(message); }
}

export default function IngestForm() {
  const [url,setUrl] = useState("");
  const [msg,setMsg] = useState("");
  const [progress,setProgress] = useState<Progress | null>(null);
  const [elapsed,setElapsed] = useState(0);
  const startedAt = useRef<number>(0);
  const [busy,setBusy] = useState(false);
  const [existing,setExisting] = useState<Existing | null>(null);
  const [confirmReplace,setConfirmReplace] = useState(false);
  const [resume,setResume] = useState<string | null>(null);
  const router = useRouter();

  // 전사 중에만 경과 시간을 센다 — 남은 양을 모르는 단계라 시간이 유일한 신호다.
  useEffect(() => {
    if (progress?.stage !== "전사" || progress.state !== "running") return;
    const id = setInterval(()=>setElapsed(Math.round((Date.now()-startedAt.current)/1000)),1000);
    return ()=>clearInterval(id);
  }, [progress?.stage, progress?.state]);

  function step(stage:StageName, detail:string, ratio:number|null = null, vid:string|null = null) {
    setProgress(p=>({vid: vid ?? p?.vid ?? null, title: p?.title ?? null, stage, state:"running", ratio, detail}));
  }

  async function post(path:string, body:unknown) {
    const r = await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const d = await r.json();
    if (!r.ok) throw new ApiError(d.error ?? `${r.status}`,d.code,d.vid,d.title);
    return d;
  }

  async function complete(vid:string,note:(s:string)=>void) {
    setResume(vid);
    note("목차 만드는 중…");
    step("목차","목차 만드는 중…",0,vid);
    let o;
    do {
      o = await post("/api/outline",{vid});
      note(`목차 ${o.kept}/${o.n}개 준비됨…`);
      step("목차",`목차 ${o.kept}/${o.n}개`, o.n ? o.kept/o.n : null, vid);
      if (o.left && !o.done) throw new Error("목차 처리가 멈췄습니다. 다시 이어서 처리해 주세요.");
    } while (o.left);
    note("검색 준비 중…");
    step("검색 준비","검색 준비 중…",0,vid);
    let e, total = 0;
    do {
      e = await post("/api/embed",{vid});
      total = total || (e.done + e.left);
      step("검색 준비",`문단 ${total-e.left}/${total}개 준비됨`, total ? (total-e.left)/total : null, vid);
      if (e.left && !e.done) throw new Error("검색 준비가 멈췄습니다. 다시 이어서 처리해 주세요.");
    } while (e.left);
    setProgress(p=>p && ({...p, stage:"검색 준비", state:"done", ratio:1, detail:"완료"}));
    setResume(null);
    return vid;
  }

  async function one(videoUrl:string,note:(s:string)=>void,replace=false) {
    note("전사 중…");
    startedAt.current = Date.now();
    setElapsed(0);
    const guess = /[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/.exec(videoUrl);
    step("전사","영상 소리를 받아쓰는 중…",null,guess?.[1] ?? guess?.[2] ?? null);
    let d = await post("/api/ingest",{url:videoUrl,replace});
    // 이미 변환돼 있던 영상. 전사를 건너뛰고 담기만 한다 — 비용도 기다림도 없다.
    if (d.state === "added") { remember(d.vid); return d.vid as string; }
    const deadline = Date.now()+10*60*1000;
    while (d.state === "working") {
      if (Date.now()>deadline) throw new Error("자막 처리가 오래 걸리고 있습니다. 잠시 후 확인해 주세요.");
      await new Promise(s=>setTimeout(s,5000));
      const query = new URLSearchParams({job:d.job,vid:d.vid,token:d.token});
      const r = await fetch(`/api/ingest?${query}`);
      d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${r.status}`);
    }
    step("문단","문단으로 나누는 중…",1,d.vid);
    const vid = await complete(d.vid,note);
    // 로그인했으면 서버가 이미 담았다. 여기 적어 두는 건 로그인하지 않은 경우다 —
    // 로그인해도 적어 두면 나중에 로그인할 때 합쳐지므로 해롭지 않다.
    remember(vid);
    return vid;
  }

  async function go(replace=false) {
    if (!url.trim() || busy) return;
    const input = replace && existing ? existing.url : url;
    setBusy(true);setConfirmReplace(false);setResume(null);
    try {
      if (/[?&]list=/.test(input)) {
        const {total,todo} = await post("/api/playlist",{url:input});
        if (!todo.length) {setMsg(`플레이리스트 ${total}편 — 이미 모두 등록되어 있습니다.`);return;}
        const failures:string[]=[];
        for (const [i,vid] of todo.entries()) {
          try { await one(`https://www.youtube.com/watch?v=${vid}`,s=>setMsg(`${i+1}/${todo.length}편 · ${s}`)); }
          catch(e) { failures.push(`${vid}: ${(e as Error).message}`); }
        }
        if (failures.length) {setMsg(`일부 영상 처리에 실패했습니다. ${failures.join(" / ")}`);return;}
        router.push("/videos");
      } else {
        const vid = await one(input,setMsg,replace);
        setExisting(null);router.push(`/videos/${vid}`);router.refresh();
      }
    } catch(e) {
      if (e instanceof ApiError && e.code === "VIDEO_EXISTS" && e.vid) {
        setExisting({vid:e.vid,url:input,title:e.title});setMsg("이미 등록된 영상입니다.");
      } else {
        setMsg((e as Error).message);
        setProgress(p=>p && ({...p, state:"error", error:(e as Error).message}));
      }
    } finally {setBusy(false);}
  }

  async function continueProcessing(vid:string) {
    setBusy(true);
    try {await complete(vid,setMsg);router.push(`/videos/${vid}`);router.refresh();}
    catch(e) {setMsg((e as Error).message);}
    finally {setBusy(false);}
  }

  return (
    <div>
      <div className="flex gap-2">
        <input value={url} disabled={busy} aria-label="유튜브 주소"
          onChange={e=>{setUrl(e.target.value);setExisting(null);setConfirmReplace(false);setResume(null);setMsg("");setProgress(null);}}
          onKeyDown={e=>e.key === "Enter" && go()}
          placeholder="유튜브 링크를 붙여넣어 주세요"
          className="h-[46px] min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5 outline-none placeholder:text-mfg focus:border-fg focus:bg-bg" />
        <button onClick={()=>go()} disabled={!url.trim() || busy}
          className="h-[46px] shrink-0 whitespace-nowrap rounded-lg bg-fg px-4 text-small font-semibold text-bg disabled:opacity-35 sm:px-5">
          {busy ? "변환하는 중…" : "글로 변환하기"}
        </button>
      </div>
      {progress ? <IngestProgress progress={{...progress, elapsedSec: elapsed}} />
        : msg && <p role="status" className="mt-3 text-[13px] text-mfg">{msg}</p>}
      {existing && !busy && <div className="mt-4 rounded-lg border border-line p-4 text-[13px]">
        <p className="font-medium">{existing.title ?? "저장된 영상"}</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <Link className="underline" href={`/videos/${existing.vid}`}>저장된 영상 보기</Link>
          <button className="underline" onClick={()=>continueProcessing(existing.vid)}>처리 이어하기</button>
          <button className="underline" onClick={()=>setConfirmReplace(true)}>자막 다시 가져오기</button>
        </div>
        {confirmReplace && <div className="mt-4 border-t border-line pt-3">
          <p>새 자막을 가져오면 지금 저장된 글과 목차를 새로 만들어요. 계속할까요?</p>
          <div className="mt-3 flex gap-4">
            <button className="font-semibold underline" onClick={()=>go(true)}>교체하기</button>
            <button onClick={()=>setConfirmReplace(false)}>취소</button>
          </div>
        </div>}
      </div>}
      {resume && !busy && !existing && <div className="mt-3 flex gap-4 text-[13px]">
        <button className="underline" onClick={()=>continueProcessing(resume)}>처리 이어하기</button>
        <Link className="underline" href={`/videos/${resume}`}>저장된 내용 보기</Link>
      </div>}
    </div>
  );
}
