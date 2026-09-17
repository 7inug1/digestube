/** 유튜브에서 제목과 채널을 가져온다 — oEmbed.
 *
 *  키가 필요 없고, 영상을 내려받는 경로와 달리 서버에서도 막히지 않는다.
 *  전사 응답에는 제목이 없어서 이쪽에서 채운다.
 */
export type Meta = { title: string; channel: string };

export async function meta(vid: string): Promise<Meta | null> {
  // 안쪽 주소를 인코딩하지 않으면 그 안의 ?v= 가 바깥 요청의 파라미터로 잘린다
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`);
  const url = `https://www.youtube.com/oembed?url=${target}&format=json`;
  try {
    // 제목은 거의 안 바뀐다. 하루에 한 번만 물어본다.
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), next: { revalidate: 86400 } });
    if (!r.ok) return null;
    const d = await r.json();
    return { title: d.title, channel: d.author_name };
  } catch {
    return null;
  }
}

/** 유튜브가 주는 썸네일 중 가장 큰 것. 큰 자리에 작은 그림을 늘려 넣으면 뭉개진다.
 *
 *  maxresdefault(1280x720)·hq720 은 없는 영상이 있고, sddefault·hqdefault 는
 *  4:3 이라 16:9 자리에서 위아래가 잘린다. 있는 것부터 내려오며 고른다.
 *  없는 주소는 404 가 아니라 회색 자리표시 그림이 오는 경우가 있어 크기로도 거른다. */
const SIZES = ["maxresdefault", "hq720", "sddefault", "hqdefault"] as const;

export async function thumb(vid: string): Promise<string> {
  for (const name of SIZES) {
    const url = `https://i.ytimg.com/vi/${vid}/${name}.jpg`;
    try {
      // 썸네일은 거의 안 바뀐다. 하루에 한 번만 물어본다.
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000), next: { revalidate: 86400 } });
      if (r.ok && Number(r.headers.get("content-length") ?? 0) > 2000) return url;
    } catch { /* 다음 크기로 내려간다 */ }
  }
  return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
}

/** 제출한 영상이 받을 수 있는 영상인지 보려면 길이와 공개 상태가 필요한데
 *  oEmbed 는 둘 다 안 준다. YouTube Data API 가 공식으로 주는 유일한 길이다.
 *  키는 무료(하루 1만 회). 없으면 null — 부르는 쪽이 "확인 못 함"으로 다룬다. */
export type Details = {
  seconds: number;
  live: "none" | "live" | "upcoming";
  privacy: "public" | "unlisted" | "private";
  ageRestricted: boolean;
  embeddable: boolean;
};

export async function details(vid: string): Promise<Details | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const url = "https://www.googleapis.com/youtube/v3/videos" +
    `?part=contentDetails,status,snippet&id=${vid}&key=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), next: { revalidate: 3600 } });
    if (!r.ok) return null;
    const item = (await r.json()).items?.[0];
    // 목록이 비면 없는 영상이거나 비공개다 — 둘 다 받을 수 없다
    if (!item) return { seconds: 0, live: "none", privacy: "private", ageRestricted: false, embeddable: false };
    return {
      seconds: isoSeconds(item.contentDetails?.duration ?? ""),
      live: item.snippet?.liveBroadcastContent ?? "none",
      privacy: item.status?.privacyStatus ?? "public",
      ageRestricted: item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted",
      embeddable: item.status?.embeddable !== false,
    };
  } catch {
    return null;
  }
}

/** "PT1H2M3S" → 3723. 라이브는 "P0D" 로 온다 → 0. */
export function isoSeconds(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, se] = m.map(x => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + se;
}
