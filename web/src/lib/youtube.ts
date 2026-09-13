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
