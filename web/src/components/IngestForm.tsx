"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Existing = {vid:string;url:string;title?:string};
class ApiError extends Error {
  constructor(message:string, public code?:string, public vid?:string, public title?:string) { super(message); }
}

export default function IngestForm() {
  const [url,setUrl] = useState("");
  const [msg,setMsg] = useState("");
  const [busy,setBusy] = useState(false);
  const [existing,setExisting] = useState<Existing | null>(null);
  const [confirmReplace,setConfirmReplace] = useState(false);
  const [resume,setResume] = useState<string | null>(null);
  const router = useRouter();

  async function post(path:string, body:unknown) {
    const r = await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const d = await r.json();
    if (!r.ok) throw new ApiError(d.error ?? `${r.status}`,d.code,d.vid,d.title);
    return d;
  }

  async function complete(vid:string,note:(s:string)=>void) {
    setResume(vid);
    note("목차 만드는 중…");
    let o;
    do {
      o = await post("/api/outline",{vid});
      note(`목차 ${o.kept}/${o.n}개 준비됨…`);
      if (o.left && !o.done) throw new Error("목차 처리가 멈췄습니다. 다시 이어서 처리해 주세요.");
    } while (o.left);
    note("검색 준비 중…");
    let e;
    do {
      e = await post("/api/embed",{vid});
      if (e.left && !e.done) throw new Error("검색 준비가 멈췄습니다. 다시 이어서 처리해 주세요.");
    } while (e.left);
    setResume(null);
    return vid;
  }

  async function one(videoUrl:string,note:(s:string)=>void,replace=false) {
    note("자막 가져오는 중…");
    let d = await post("/api/ingest",{url:videoUrl,replace});
    const deadline = Date.now()+10*60*1000;
    while (d.state === "working") {
      if (Date.now()>deadline) throw new Error("자막 처리가 오래 걸리고 있습니다. 잠시 후 확인해 주세요.");
      await new Promise(s=>setTimeout(s,5000));
      const query = new URLSearchParams({job:d.job,vid:d.vid,token:d.token});
      const r = await fetch(`/api/ingest?${query}`);
      d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${r.status}`);
    }
    return complete(d.vid,note);
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
      } else {setMsg((e as Error).message);}
    } finally {setBusy(false);}
  }

  async function continueProcessing(vid:string) {
    setBusy(true);
    try {await complete(vid,setMsg);router.push(`/videos/${vid}`);router.refresh();}
    catch(e) {setMsg((e as Error).message);}
    finally {setBusy(false);}
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="flex gap-2">
        <input value={url} disabled={busy} aria-label="유튜브 주소"
          onChange={e=>{setUrl(e.target.value);setExisting(null);setConfirmReplace(false);setResume(null);setMsg("");}}
          onKeyDown={e=>e.key === "Enter" && go()}
          placeholder="유튜브 영상 또는 플레이리스트 주소"
          className="h-[46px] min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5 outline-none placeholder:text-mfg focus:border-fg focus:bg-bg" />
        <button onClick={()=>go()} disabled={!url.trim() || busy}
          className="h-[46px] shrink-0 rounded-lg bg-fg px-5 text-[13.5px] font-semibold text-bg disabled:opacity-35">
          {busy ? "넣는 중…" : "넣기"}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-mfg">한국어 자막을 가져옵니다. 번역 자막이 사용될 수 있습니다.</p>
      {msg && <p role="status" className="mt-3 text-[13px] text-mfg">{msg}</p>}
      {existing && !busy && <div className="mt-4 rounded-lg border border-line p-4 text-[13px]">
        <p className="font-medium">{existing.title ?? "저장된 영상"}</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <Link className="underline" href={`/videos/${existing.vid}`}>저장된 영상 보기</Link>
          <button className="underline" onClick={()=>continueProcessing(existing.vid)}>처리 이어하기</button>
          <button className="underline" onClick={()=>setConfirmReplace(true)}>자막 다시 가져오기</button>
        </div>
        {confirmReplace && <div className="mt-4 border-t border-line pt-3">
          <p>새 자막을 가져오면 기존 전사문·목차·검색 데이터를 교체합니다. 계속할까요?</p>
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
