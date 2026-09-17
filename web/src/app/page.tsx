import Image from "next/image";
import Link from "next/link";
import libraryShot from "../../public/shots/library-light.png";
import readerShot from "../../public/shots/reader-light.png";
import searchShot from "../../public/shots/search-light.png";
import IngestForm from "@/components/IngestForm";
import ShotCarousel from "@/components/ShotCarousel";
import VideoThumb from "@/components/VideoThumb";
import {ClockIcon, Sec} from "@/components/ui";
import {listVideos, statsOf} from "@/lib/store";
import {readTime} from "@/lib/format";
import {SAMPLE_IDS} from "@/lib/samples";
import {meta, thumb} from "@/lib/youtube";

export const dynamic = "force-dynamic";

/** 저장만 해두고 안 본 영상들 — 썸네일만 쓴다. 아래로 흐려지며 목록이 이어지는 인상을 준다.
 *  여기 적은 것만 쓴다. 라이브러리에서 빌려 오면 남이 변환한 영상이 랜딩에 걸린다. */
const SHELF = ["Evx4V4Rsf1s", "-PmZ2KcfGCI", "VkYnrRicqxI",
               "aMJ9cPRAhSw", "i0NcKL1JLfg", "Kvs02l-4YLE",
               "byVgbqzYJrs", "55eFm5tPCQY", "8cp0YvSpDA8"];

/** 샘플로 먼저 보여주고 싶은 순서. 말로 지식·경험을 전하는 영상들이다.
 *  라이브러리에 깔아 두는 맛보기와 같은 목록을 쓴다(lib/samples.ts) — 두 곳이
 *  다른 영상을 보여주면 따로 놀아 보인다. */
const SAMPLE_ORDER = SAMPLE_IDS;
/** 하나만 둔다. 고르게 하는 자리가 아니라 "눌러서 들어가 보는" 자리다. */
const SAMPLE_COUNT = 1;

const FAQ = [
  {q: "어떤 영상에 잘 맞나요?",
   a: "강연·인터뷰·대담처럼 말로 지식과 경험을 전하는 영상에 잘 맞아요. " +
      "말이 곧 내용인 영상일수록 글로 읽었을 때 남는 게 많아요."},
  {q: "자막이 없는 영상도 되나요?",
   a: "네, 괜찮아요. 유튜브 자막을 가져오는 게 아니라 음성을 직접 받아쓰거든요. " +
      "자막이 꺼져 있거나 자동 자막이 엉망인 영상도 그대로 넣어보세요. " +
      "한국어 영상을 기준으로 다듬었어요."},
  {q: "내용을 요약해 주나요?",
   a: "요약은 하지 않아요. 말한 내용을 빠짐없이 옮기고 문단과 목차만 붙여요. " +
      "요약본에서는 말한 사람의 표현이 먼저 지워지는데, 대개 그 표현이 좋아서 저장해 둔 영상이니까요. " +
      "대신 목차가 있어서 필요한 대목만 골라 읽을 수 있어요."},
  {q: "화면을 봐야 아는 영상은요?",
   a: "시연이나 자료 화면이 중심인 영상은 아쉬울 수 있어요. 음성만 받아쓰고 화면에 뜬 글자는 옮기지 않거든요. " +
      "음악·자연음·무음 영상도 옮길 말 자체가 적어요."},
  {q: "얼마나 넣을 수 있나요?",
   a: "하루에 다 합쳐 60분까지 무료예요. 30분짜리 두 편이든 10분짜리 여섯 편이든 같아요. " +
      "한 편의 길이 제한은 없지만, 하루치보다 긴 영상은 그날 안에 다 못 넣어요. " +
      "다음 날 0시(한국 시간)에 다시 채워져요."},
  {q: "안 되는 영상도 있나요?",
   a: "라이브 중이거나 예정된 영상, 비공개 영상, 연령 제한 영상은 받을 수 없어요. " +
      "넣어보시면 이유를 바로 알려드려요."},
  {q: "변환하는 데 얼마나 걸리나요?",
   a: "영상 길이에 따라 달라요. 링크를 넣으면 지금 어느 단계인지 화면에서 보여주니까, " +
      "창을 지켜보고 있지 않아도 괜찮아요."},
  {q: "한 번 변환한 영상은 어떻게 되나요?",
   a: "라이브러리에 남아요. 다시 넣지 않아도 언제든 열어서 읽고, 검색으로 그 대목을 다시 찾을 수 있어요."},
];


async function samples() {
  // 라이브러리 전체에서 고르지 않는다. 쓰는 사람이 늘면 남이 변환한 영상이
  // 랜딩 첫 화면에 걸리는데, 무엇이 걸릴지 우리가 모르는 자리는 두면 안 된다.
  // SAMPLE_ORDER 에 적어 둔 것만 쓴다.
  const videos = (await listVideos()).filter(v => SAMPLE_ORDER.includes(v.id));
  const stats = await statsOf(videos.map(v => v.id));
  const ready = videos.filter(v => (stats[v.id]?.chunks ?? 0) > 0);
  const rank = (id: string) => SAMPLE_ORDER.indexOf(id);
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
      {/* ① 후킹 — h1 은 "나중에 볼 동영상"이라는 유튜브 기능 이름을 그대로 쓴다.
          쓰는 사람이 1초에 자기 얘기로 읽는 자리라 바꾸지 않았다.
          설명 줄과 처리량 숫자를 붙여 봤는데 뺐다. 입력창까지 가는 길에 읽을 게
          늘어날 뿐이었다. 무엇을 받는지는 바로 아래 ② 가 그림으로 말한다. */}
      <div className="pb-12 text-center">
        <h1 className="mb-5 text-[34px] font-[680] leading-[1.22] tracking-[-.04em] sm:text-[46px]">
          <span className="font-semibold text-mfg">나중에 볼 동영상,</span>
          <br />이제 읽어보세요!
        </h1>
        <IngestForm />
      </div>

      {/* ② 문제 — 묻는 말 하나와 쌓인 목록 하나. 그걸로 끝낸다.
          한때 여기 오른쪽에 "이렇게 바뀐다"는 카드를 붙이고 화살표로 이었는데 뺐다.
          바로 아래 ③ 이 실제 화면으로 같은 말을 하고, 두 번 하면 ② 가 ③ 의
          축소판처럼 읽힌다. 이 자리는 문제만 말한다. */}
      <div className="mb-14">
        {/* 혼잣말처럼 진술하면 남 얘기로 읽힌다. 읽는 사람에게 직접 물어야
            "내 얘기네" 가 된다 — 탓하는 말이 아니라 묻는 말이다 */}
        <p className="mb-7 text-center text-[22px] font-[740] leading-[1.3] tracking-[-.03em] sm:text-[28px]">
          저장만 하고 안 본 영상,<br />쌓이기만 하지 않나요?
        </p>

        {/* 유튜브의 "나중에 볼 동영상" 표기를 그대로 쓴다: 시계 아이콘 + 같은 이름 + 개수.
            쓰는 사람이 매일 보는 표기라 설명 없이 "내 그 목록"으로 읽힌다.
            개수는 적지 않는다 — 숫자를 박으면 "그것뿐"으로 읽힌다.
            색도 죽이지 않는다. 회색으로 빼면 방치는 말하지만 목록이 초라해 보인다.
            쌓인다는 말은 아래로 흐려지는 마스크와 ⋮ 가 맡는다 — 끝이 안 보여야
            "계속 쌓인다"가 된다. */}
        {/* 왼쪽 구석에 작은 회색 글씨로 뒀더니 그냥 지나쳤다. 이 줄이 아래 더미를
            "유튜브의 그 목록"으로 읽히게 하는 열쇠라 가운데로 옮기고, 테두리를 둘러
            하나의 표딱지로 만든다. 위 물음(28)보다는 작게 둔다 — 이건 이름표지 말이 아니다. */}
        <div className="mb-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line
                           px-3 py-1 text-small font-semibold text-mfg">
            <ClockIcon /> 나중에 볼 동영상
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5"
             style={{maskImage: "linear-gradient(to bottom, #000 55%, transparent)",
                     WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent)"}}>
          {SHELF.map(id => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy"
                 className="aspect-video w-full rounded bg-muted object-cover" />
          ))}
        </div>
        {/* ⋮ 는 글자로 찍으면 폰트마다 점 간격과 높이가 달라 어떤 데서는 티끌로 보인다.
            점 세 개를 직접 그려 간격을 못박는다 — 아래로 계속 이어진다는 뜻이라
            마지막 칸이 흐려지는 자리와 세로로 맞춘다. */}
        <div aria-hidden className="mt-3 flex flex-col items-center gap-[5px]">
          <span className="h-[3px] w-[3px] rounded-full bg-mfg/70" />
          <span className="h-[3px] w-[3px] rounded-full bg-mfg/50" />
          <span className="h-[3px] w-[3px] rounded-full bg-mfg/30" />
        </div>
      </div>

      {/* ③ 체험 — 화면 석 장을 돌려 보여주고, 그 아래에서 진짜로 열어보게 한다.
             한 장만 걸었더니 "영상 하나 읽는 것"으로만 읽혔다. 읽기·검색·라이브러리를
             차례로 보여줘야 무엇을 받는지가 다 전해진다.
             석 장 다 scripts/shoot-screens.mjs · shoot-reader.mjs 로 찍은 실제 화면이다 —
             UI 를 고치면 다시 찍는다. 손으로 그린 그림을 걸면 실제와 어긋난다. */}
      {picks.length > 0 && (
        <Sec>
          {/* ② 가 문제를 물었으니 여기서 답한다. "목차로 훑어요" 같은 기능 설명은
              왜 영상 대신 글이어야 하는지를 말하지 않는다. 영상은 10분을 다 흘려보내야
              무슨 말인지 아는데 글은 눈으로 건너뛴다 — 이 제품이 서 있는 자리가 거기다 */}
          <p className="mb-6 text-[22px] font-[740] leading-[1.3] tracking-[-.03em] sm:text-[28px]">
            보지 않으면 알 수 없던 영상,<br />이제 글로 훑어보세요!
          </p>

          <ShotCarousel shots={[
            {src: readerShot, alt: "목차와 글이 나란히 있는 읽기 화면", label: "영상을 보기 쉽게 글로 변환해줘요. 목차와 함께 확인해보세요!"},
            {src: searchShot, alt: "검색 결과에서 관련 문단이 노랗게 표시된 화면", label: "영상에서 궁금했던 내용을 검색해볼 수 있어요. 검색어가 정확하지 않아도 의미로 검색해줘요."},
            {src: libraryShot, alt: "읽어 둔 영상이 카드로 늘어선 라이브러리 화면", label: "라이브러리에서 변환한 영상을 골라보세요"},
          ]} />

          {/* 캐러셀은 "이렇게 생겼다"까지만 말한다. 이 줄이 카드를 소개해야
              그림 다음에 오는 네모가 "눌러볼 것"으로 읽힌다 */}
          {/* 섹션 머리말(22/28) 과 본문(17) 사이 한 단. 이 줄만 15 로 두니
              혼자 작아 보였다 — 카드를 여는 말이지 각주가 아니다 */}
          <p className="mb-5 mt-10 text-[19px] font-[740] leading-[1.4] tracking-[-.03em] sm:text-[22px]">
            미리 변환된 영상을<br />아래에서 바로 만나보세요!
          </p>
          {picks.map(v => (
            /* 캐러셀은 보는 자리라 링크를 안 걸었다. 누르는 자리는 여기 하나뿐이어야
               어디를 눌러야 하는지가 헷갈리지 않는다.
               "열어서 읽어보기"는 뭘 여는지가 없었다. 위 버튼이 "글로 변환하기"라고
               말했으니, 여기는 그렇게 변환해 둔 것을 보러 가는 자리라고 말한다. */
            <Link key={v.id} href={`/videos/${v.id}`}
                  className="group mt-6 block rounded-2xl border border-line p-3.5 text-left
                             transition hover:border-fg hover:shadow-lg focus-visible:border-fg">
              {/* 이게 "남이 만들어 둔 예시"라는 걸 그림 위에서 한 번에 말한다.
                  글로 "예시입니다"를 붙이면 CTA 앞에 읽을 거리가 하나 더 생긴다. */}
              <div className="relative">
                <VideoThumb v={v} />
                {/* 마우스를 올리면 유튜브 썸네일 자리에 전사된 화면이 겹쳐 뜬다.
                    "이 영상이 저 화면이 된다"를 카드 하나 안에서 보여준다 — 위 캐러셀처럼
                    돌리지 않는다. 카드가 저절로 움직이면 누르려던 손이 멈칫한다.
                    썸네일이 VideoThumb 맨 위 aspect-video 자리라 같은 비율로 덮는다. */}
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0
                                            aspect-video overflow-hidden rounded-xl">
                  <Image src={readerShot} alt="" sizes="(min-width: 640px) 620px, 100vw"
                         className="h-full w-full object-cover object-top opacity-0
                                    transition-opacity duration-300
                                    group-hover:opacity-100 group-focus-visible:opacity-100" />
                </div>
                <span className="absolute left-2.5 top-2.5 rounded-md bg-bg/85 px-2 py-0.5
                                 text-label font-semibold backdrop-blur">
                  샘플
                </span>
              </div>
              <div className="mt-3.5 flex items-center gap-1.5 border-t border-line pt-3 text-small font-semibold">
                변환된 글 보러 가기
                <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </Link>
          ))}
        </Sec>
      )}

      {/* ⑤ FAQ — 한계는 여기에 모은다. 질문만 늘어놓으면 지나치기 쉬워서
          눌러서 펴는 줄로 만든다. details 라 자바스크립트 없이도 열린다. */}
      <Sec>
        <p className="mb-6 text-[19px] font-[740] leading-[1.4] tracking-[-.03em] sm:text-[22px]">
          궁금한 게 있으신가요?
        </p>
        {/* 상자 대신 구분선만 둔다. 카드로 감싸면 본문과 따로 노는 덩어리가 되고,
            질문이 길어질 때 가로가 먼저 답답해진다.
            name 을 같이 주면 한 번에 하나만 열린다 — 자바스크립트 없이 된다. */}
        <div className="border-t border-line text-left">
          {FAQ.map(({q, a}) => (
            <details key={q} name="faq" className="faq-item group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center gap-4 py-5
                                  text-body font-semibold tracking-[-.02em]
                                  transition-colors group-open:text-fg hover:text-mfg">
                <span className="flex-1">{q}</span>
                <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                     className="shrink-0 text-mfg transition-transform duration-300 group-open:rotate-180">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <p className="pb-5 pr-8 text-small leading-[1.85] text-mfg">{a}</p>
            </details>
          ))}
        </div>
      </Sec>

      {/* ⑥ 마지막 CTA — 입력창을 한 번 더 둔다. 읽어 내려온 사람이 다시 맨 위로
          스크롤하게 두면 거기서 끝난다. 위와 같은 폼이라 새로 배울 것도 없다. */}
      <Sec>
        <p className="mb-5 text-[22px] font-[740] leading-[1.3] tracking-[-.03em] sm:text-[28px]">
          쌓아놨던 영상,<br />지금 바로 읽어보세요!
        </p>
        <IngestForm />
      </Sec>

    </div>
  );
}
