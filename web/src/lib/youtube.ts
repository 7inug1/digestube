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
    const r = await fetch(url, { next: { revalidate: 86400 } });
    if (!r.ok) return null;
    const d = await r.json();
    return { title: d.title, channel: d.author_name };
  } catch {
    return null;
  }
}
