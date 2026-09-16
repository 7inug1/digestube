import Link from "next/link";

/** 없는 주소. Next 기본 404 는 영어라 사이트 밖으로 튕겨 나간 느낌을 준다. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-[620px] py-24 text-center">
      <p className="mb-3 text-[22px] font-[740] tracking-[-.03em] sm:text-[28px]">
        여기엔 아무것도 없어요
      </p>
      <p className="mb-8 text-small text-mfg">주소가 바뀌었거나 지워진 영상일 수 있어요.</p>
      <Link href="/" className="rounded-lg bg-fg px-4 py-2.5 text-small font-semibold text-bg">
        처음으로
      </Link>
    </div>
  );
}
