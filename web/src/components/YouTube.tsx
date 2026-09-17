"use client";

import { useEffect, useRef, useState } from "react";

type Player = {
  seekTo(seconds:number,allowSeekAhead:boolean): void;
  playVideo(): void;
  destroy(): void;
};
type PlayerOptions = {width:string;height:string;videoId:string;playerVars:Record<string,number|string>;events:{
  onReady:()=>void;onError:(event:{data:number})=>void;
  onStateChange:(event:{data:number})=>void;onAutoplayBlocked:()=>void;
}};
declare global {
  interface Window {
    YT?: {Player: new (host:HTMLElement,options:PlayerOptions)=>Player};
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve,reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    const tag = document.createElement("script");
    let settled = false;
    const finish = (error?:Error) => {
      if(settled)return;settled=true;clearTimeout(timer);
      if(window.onYouTubeIframeAPIReady===callback)window.onYouTubeIframeAPIReady=prev;
      tag.onerror=null;
      if(error){tag.remove();reject(error);}else resolve();
    };
    const callback = () => { try { prev?.(); } finally { finish(); } };
    const timer = setTimeout(()=>finish(new Error("API timeout")),15000);
    window.onYouTubeIframeAPIReady = callback;
    tag.onerror=()=>finish(new Error("API unavailable"));
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }).catch(error=>{apiPromise=null;throw error;});
  return apiPromise;
}

// YouTube only identifies groups of causes; do not claim to know deletion vs privacy.
// https://developers.google.com/youtube/iframe_api_reference#onError
function errorMessage(code:number) {
  if(code===100)return "삭제되었거나 비공개로 전환된 영상일 수 있어요.";
  if(code===101||code===150)return "이 영상은 외부 사이트에서 재생할 수 없어요.";
  if(code===2)return "영상 주소를 확인할 수 없어요.";
  if(code===5)return "현재 브라우저에서 영상 재생에 문제가 생겼어요.";
  return "유튜브 연결 또는 재생 중 문제가 생겼어요.";
}

type Props = {
  videoId:string;seek:number;nonce?:number;autoplay?:boolean;
  /** 사람이 재생을 시작했을 때. 만드는 화면이 "보는 중"인지 알아야 하기 때문이다 —
   *  보는 중에 화면을 갈아치우면 재생이 처음으로 돌아간다. */
  onPlay?:()=>void;
};
/** Remount on retry/video change so old callbacks cannot affect the new player. */
export default function YouTube(props:Props) {
  const [attempt,setAttempt]=useState(0);
  return <PlayerSurface key={`${props.videoId}:${attempt}`} {...props} onRetry={()=>setAttempt(n=>n+1)} />;
}

function PlayerSurface({videoId,seek,nonce=0,autoplay=true,onPlay,onRetry}:Props&{onRetry:()=>void}) {
  const host=useRef<HTMLDivElement>(null);
  const player=useRef<Player|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [autoplayBlocked,setAutoplayBlocked]=useState(false);
  const safeSeek=Number.isFinite(seek)?Math.max(0,seek):0;
  const watchUrl=`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(safeSeek)}s`;

  useEffect(()=>{
    let dead=false,failed=false;
    let timer:ReturnType<typeof setTimeout>;
    const fail=(message:string)=>{
      if(dead||failed)return;failed=true;clearTimeout(timer);
      setError(message);setReady(false);
      player.current?.destroy();player.current=null;
    };
    const wait=()=>{clearTimeout(timer);timer=setTimeout(()=>fail("영상 연결이 지연되고 있어요. 잠시 후 다시 시도해 주세요."),20000);};
    wait();
    loadApi().then(()=>{
      if(dead||failed||!host.current||!window.YT)return;
      const mount=document.createElement("div");host.current.appendChild(mount);
      player.current=new window.YT.Player(mount,{
        width:"100%",height:"100%",videoId,
        playerVars:{rel:0,playsinline:1,start:Math.floor(safeSeek),origin:window.location.origin},
        events:{
          onReady:()=>{if(!dead&&!failed){clearTimeout(timer);setReady(true);}},
          onError:event=>fail(errorMessage(event.data)),
          onStateChange:event=>{
            if(dead||failed)return;
            if(event.data===3)wait();else if([0,1,2,5].includes(event.data))clearTimeout(timer);
            if(event.data===1){setAutoplayBlocked(false);onPlay?.();}
          },
          onAutoplayBlocked:()=>{if(!dead&&!failed){clearTimeout(timer);setAutoplayBlocked(true);}},
        },
      });
    }).catch(()=>fail("유튜브에 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."));
    return ()=>{dead=true;clearTimeout(timer);player.current?.destroy();player.current=null;};
    // A keyed mount represents one video/retry. Updated seeks run after readiness below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(!ready||!player.current)return;
    let cancelled=false;
    Promise.resolve().then(()=>{
      if(cancelled||!player.current)return;
      player.current.seekTo(safeSeek,true);
      if(autoplay)player.current.playVideo();
    }).catch(()=>{
      if(cancelled)return;
      player.current?.destroy();player.current=null;
      setError("영상 재생 중 문제가 생겼어요. 다시 시도해 주세요.");
    });
    return ()=>{cancelled=true;};
  },[safeSeek,nonce,autoplay,ready]);

  return <div>
    <div className="relative aspect-video min-h-[210px] w-full overflow-hidden bg-black md:rounded-xl" data-testid="youtube-player">
      <div ref={host} className={`h-full w-full ${error?"hidden":""}`} />
      {!ready&&!error&&<div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black text-sm text-white/80">영상 불러오는 중…</div>}
      {error&&<div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-muted px-5 py-4 text-center text-fg">
        <p className="font-medium">영상을 여기서 재생할 수 없어요.</p>
        <p className="text-sm text-mfg">{error}<br />전사문과 목차는 계속 읽을 수 있어요.</p>
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-fg px-4 py-2 text-bg">유튜브에서 보기</a>
          <button type="button" onClick={onRetry} className="rounded-lg border border-line px-4 py-2">다시 시도</button>
        </div>
      </div>}
    </div>
    {autoplayBlocked&&!error&&<p role="status" className="mt-2 text-sm text-mfg">자동 재생이 차단됐어요. 영상의 재생 버튼을 눌러주세요.</p>}
  </div>;
}
