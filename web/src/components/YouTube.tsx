"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/** 영상과 재생 위치를 props로 받는 플레이어. 위치가 바뀌면 그 지점으로 점프한다. */
export default function YouTube({ videoId, seek, nonce = 0, autoplay = true }: {
  videoId: string;
  seek: number;
  /** 같은 시각을 다시 눌렀을 때도 움직이도록 하는 값 */
  nonce?: number;
  autoplay?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const loaded = useRef<string>("");

  useEffect(() => {
    let dead = false;
    loadApi().then(() => {
      if (dead || !host.current || player.current) return;
      player.current = new window.YT.Player(host.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(seek) },
        events: { onReady: () => (loaded.current = videoId) },
      });
    });
    return () => { dead = true; };
    // 처음 한 번만 만든다. 이후 이동은 아래 effect 가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const p = player.current;
    if (!p?.loadVideoById) return;
    const t = Math.floor(seek);
    if (loaded.current !== videoId) {
      loaded.current = videoId;
      p.loadVideoById({ videoId, startSeconds: t });
    } else {
      p.seekTo(t, true);
      if (autoplay) p.playVideo?.();
    }
  }, [videoId, seek, nonce, autoplay]);

  return (
    <div className="aspect-video w-full overflow-hidden bg-black md:rounded-xl">
      <div ref={host} className="h-full w-full" />
    </div>
  );
}
