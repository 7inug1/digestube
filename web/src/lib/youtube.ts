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

/** 영상 한 편에 딸린, 화면에 쓸 만한 것들.
 *
 *  oEmbed 는 제목과 채널 이름만 준다. Data API 는 한 번에 채널 번호·올린 날·조회수까지
 *  주므로, 이미 부르고 있는 김에 같이 받아 둔다. 채널 사진만 한 번 더 부른다 —
 *  영상 응답에는 채널 사진이 없다.
 *
 *  키가 없거나 API 가 죽으면 null 이다. 화면은 그때 예전처럼 글자만 보여준다 —
 *  꾸밈 때문에 읽기가 막히면 안 된다.
 */
export type About = {
  title: string; channel: string; channelId: string | null;
  avatar: string | null; published: string | null; views: number | null;
};

export async function about(vid: string): Promise<About | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${vid}&key=${key}`,
      { signal: AbortSignal.timeout(5000), next: { revalidate: 3600 } });
    if (!r.ok) return null;
    const item = (await r.json()).items?.[0];
    if (!item) return null;
    const channelId: string | null = item.snippet?.channelId ?? null;
    return {
      title: item.snippet?.title ?? vid,
      channel: item.snippet?.channelTitle ?? "채널 미확인",
      channelId,
      avatar: channelId ? await avatarOf(channelId, key) : null,
      published: item.snippet?.publishedAt ?? null,
      views: Number(item.statistics?.viewCount ?? 0) || null,
    };
  } catch {
    return null;
  }
}

/** 채널 사진. 채널은 거의 안 바뀐다 — 하루에 한 번만 물어본다. */
async function avatarOf(channelId: string, key: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${key}`,
      { signal: AbortSignal.timeout(5000), next: { revalidate: 86400 } });
    if (!r.ok) return null;
    const t = (await r.json()).items?.[0]?.snippet?.thumbnails;
    return t?.medium?.url ?? t?.default?.url ?? null;
  } catch {
    return null;
  }
}

/** 1234567 → "123만". 정확한 자릿수는 여기서 쓸모가 없다 — 규모만 보이면 된다. */
export function countText(n: number): string {
  if (n >= 100000000) return `${Math.floor(n / 10000000) / 10}억`;
  if (n >= 10000) return `${Math.floor(n / 1000) / 10}만`;
  if (n >= 1000) return `${Math.floor(n / 100) / 10}천`;
  return `${n}`;
}

/** ISO 날짜 → "2026년 9월". 날짜까지 적으면 줄이 길어지고, 어차피 대략만 필요하다. */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}
