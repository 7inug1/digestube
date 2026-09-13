import Image from "next/image";
import Link from "next/link";
import readerShot from "../../public/shots/reader-light.png";
import IngestForm from "@/components/IngestForm";
import VideoThumb from "@/components/VideoThumb";
import {ClockIcon, Sec} from "@/components/ui";
import {listVideos, statsOf} from "@/lib/store";
import {readTime} from "@/lib/format";
import {meta, thumb} from "@/lib/youtube";

export const dynamic = "force-dynamic";

/** 저장만 해두고 안 본 영상들 — 썸네일만 쓴다. 아래로 흐려지며 목록이 이어지는 인상을 준다. */
const SHELF = ["Evx4V4Rsf1s", "-PmZ2KcfGCI", "VkYnrRicqxI",
               "aMJ9cPRAhSw", "i0NcKL1JLfg", "Kvs02l-4YLE"];

/** 샘플로 먼저 보여주고 싶은 순서. 말로 지식·경험을 전하는 영상들이다.
 *  여기 없거나 아직 문단이 없으면 라이브러리의 다른 완성본으로 채운다. */
const SAMPLE_ORDER = ["byVgbqzYJrs", "55eFm5tPCQY", "8cp0YvSpDA8", "pZjYP24kTjc", "JRJd1ZrHmgg"];
/** 하나만 둔다. 고르게 하는 자리가 아니라 "눌러서 들어가 보는" 자리다. */
const SAMPLE_COUNT = 1;

const FAQ = [
  {q: "어떤 영상에 잘 맞나요?",
   a: "강연·인터뷰·대담처럼 말로 지식과 경험을 전달하는 영상에 잘 맞아요."},
  {q: "음악이나 말이 없는 영상도 가능한가요?",
   a: "음악·자연음·무음 영상은 읽을 내용이 부족할 수 있어요. 화면 시연이 중심인 영상도 전사문만으로 이해하기 어려울 수 있어요."},
  {q: "내용은 요약되나요?",
   a: "요약 대신 발화 내용을 문단으로 나누고 목차를 붙여 보여줘요."},
];

async function samples() {
  const videos = await listVideos();
  const stats = await statsOf(videos.map(v => v.id));
  const ready = videos.filter(v => (stats[v.id]?.chunks ?? 0) > 0);
  const rank = (id: string) => {
    const i = SAMPLE_ORDER.indexOf(id);
    return i < 0 ? SAMPLE_ORDER.length : i;
  };
  const picked = ready.sort((a, b) => rank(a.id) - rank(b.id)).slice(0, SAMPLE_COUNT);
  return Promise.all(picked.map(async v => {
    const [m, src] = await Promise.all([meta(v.id), thumb(v.id)]);
    return {
      id: v.id, src,
      title: m?.title ?? v.title ?? v.id,
      channel: m?.channel ?? "채널 미확인",
      seconds: stats[v.id]?.seconds ?? 0,
      note: `${readTime(v.chars ?? 0)} 분량`,
    };
  }));
}

export default async function Home() {
  const picks = await samples();

  return (
    <div className="mx-auto max-w-[620px] px-1 pb-16">
      {/* ① 후킹 — 입력창 주변은 간결하게 둔다 */}
      <div className="pb-16 text-center">
        <h1 className="mb-8 text-[34px] font-[680] leading-[1.22] tracking-[-.04em] sm:text-[46px]">
          <span className="font-semibold text-mfg">나중에 볼 동영상,</span>
          <br />이제 읽으세요
        </h1>
        <IngestForm />
      </div>

      {/* ② 문제 — 쌓이기만 하는 목록에 가위표를 치고, 그 위에 말을 얹는다.
          말이 그림 아래 따로 있으면 둘이 남남으로 읽힌다. 겹쳐야 한 문장이 된다. */}
      <div className="mb-4 flex flex-col items-center">
        <div className="mb-3 flex items-center gap-1.5 text-[11.5px] text-mfg">
          <ClockIcon /> 나중에 볼 동영상
        </div>
        <div className="relative w-full">
          <div className="grid w-full grid-cols-3 gap-2 opacity-50 grayscale"
               style={{maskImage: "linear-gradient(to bottom, #000 60%, transparent)",
                       WebkitMaskImage: "linear-gradient(to bottom, #000 60%, transparent)"}}>
            {SHELF.map(id => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={id} src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy"
                   className="aspect-video w-full rounded-md bg-muted object-cover" />
            ))}
          </div>

          {/* 가위표는 목록의 네 귀퉁이를 잇는다. 정사각형으로 그으면 가운데 한 칸만 지워져
              "영상 하나를 부정"하는 그림이 되고, 목록보다 크게 잡으면 잘려서 V 로 보인다.
              vectorEffect 로 획 굵기는 늘어나지 않게 고정한다 — 예전 가위표가 뭉개진 이유다. */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden
               className="pointer-events-none absolute inset-0 h-full w-full text-red-500">
            <line x1="4" y1="5" x2="96" y2="95" stroke="currentColor" strokeWidth="9"
                  strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <line x1="96" y1="5" x2="4" y2="95" stroke="currentColor" strokeWidth="9"
                  strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* 글자 자리만 배경색으로 덮는다. 네모난 칩을 얹으면 경계선이 생기고,
              다크에서는 그 칩이 흰 덩어리가 돼 혼자 튄다. 가운데가 진하고 가장자리로
              갈수록 사라지는 원이면 경계가 없고 라이트·다크가 같은 원리로 작동한다.
              가위표 위에 깔아서 가운데 교차점도 같이 흐려지게 한다 — 글자와 겹치는 자리다. */}
          <div aria-hidden className="pointer-events-none absolute inset-0"
               style={{background: "radial-gradient(ellipse 58% 56% at 50% 50%, " +
                 "var(--color-bg) 0%, " +
                 "color-mix(in srgb, var(--color-bg) 82%, transparent) 42%, " +
                 "transparent 72%)"}} />

          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {/* 이 줄이 ② 의 결론이라 크기를 키웠다. 가위표는 빨강이라 글자는 무채색으로
                둔다 — 빨강이 둘이면 어느 쪽을 볼지 알 수 없다 */}
            <p className="px-4 text-[20px] font-[760] leading-[1.35] tracking-[-.03em] sm:text-[24px]">
              더 이상 영상만 저장하는 건 그만!
            </p>
          </div>
        </div>
      </div>

      {/* ③ 제품 화면 — 지금까지는 전부 유튜브 썸네일이라 "유튜브 관련 뭔가"로만 읽힌다.
             읽는 화면을 한 번 보여줘야 무엇을 받는지가 분명해진다.
             scripts/shoot-reader.mjs 로 실제 화면을 찍는다. 손으로 그린 그림이 아니다. */}
      <Sec>
        <div className="relative overflow-hidden rounded-xl border border-line">
          <Image src={readerShot} alt="목차와 전사문이 나란히 있는 읽기 화면" priority={false}
                 sizes="(min-width: 640px) 620px, 100vw" className="w-full" />
          {/* 아래를 흐리게 덮어 잘린 자리가 사고처럼 보이지 않게 한다 */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20
                                      bg-gradient-to-t from-bg to-transparent" />
        </div>
        {/* 그림이 먼저 눈에 들어오고, 이 줄이 그 그림을 한마디로 받는다.
            ④ 의 부르는 말보다 크게 둬서 "설명 → 권유" 순서가 크기로도 보이게 한다 */}
        <p className="mt-6 text-[19px] font-[720] leading-[1.4] tracking-[-.03em] sm:text-[22px]">
          목차로 훑고, 전사문으로 읽어보세요!
        </p>
      </Sec>

      {/* ④ 체험 — 화면을 봤으니 이제 눌러보는 자리다.
             실제로 처리해 둔 영상이라 만들어낸 예시가 아니다 */}
      {picks.length > 0 && (
        <Sec>
          {/* 화면을 보여준 다음에 부르는 자리라 권유형으로 둔다 */}
          <p className="mb-6 text-[15px] font-semibold tracking-[-.02em]">지금 바로 Digestube를 만나보세요!</p>
          {picks.map(v => (
            /* 카드 하나라 "고르는 목록"이 아니라 "여는 문"처럼 보여야 한다.
               테두리로 눌리는 것임을 알리고, 화살표가 눌렀을 때 갈 곳을 말한다. */
            <Link key={v.id} href={`/videos/${v.id}`}
                  className="group block rounded-2xl border border-line p-3.5 text-left
                             transition hover:border-fg hover:shadow-lg focus-visible:border-fg">
              <VideoThumb v={v} />
              <div className="mt-3.5 flex items-center gap-1.5 border-t border-line pt-3 text-[13px] font-semibold">
                목차와 전사문 읽어보기
                <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </Link>
          ))}
        </Sec>
      )}

      {/* ⑤ FAQ — 한계는 여기에 모은다. 질문만 늘어놓으면 지나치기 쉬워서
          눌러서 펴는 줄로 만든다. details 라 자바스크립트 없이도 열린다. */}
      <Sec label="자주 묻는 것">
        {/* 상자 대신 구분선만 둔다. 카드로 감싸면 본문과 따로 노는 덩어리가 되고,
            질문이 길어질 때 가로가 먼저 답답해진다.
            name 을 같이 주면 한 번에 하나만 열린다 — 자바스크립트 없이 된다. */}
        <div className="border-t border-line text-left">
          {FAQ.map(({q, a}) => (
            <details key={q} name="faq" className="faq-item group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center gap-4 py-5
                                  text-[15.5px] font-semibold tracking-[-.02em]
                                  transition-colors group-open:text-fg hover:text-mfg">
                <span className="flex-1">{q}</span>
                <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                     className="shrink-0 text-mfg transition-transform duration-300 group-open:rotate-180">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <p className="pb-5 pr-8 text-[14px] leading-[1.85] text-mfg">{a}</p>
            </details>
          ))}
        </div>
      </Sec>

    </div>
  );
}
