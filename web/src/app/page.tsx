import IngestForm from "@/components/IngestForm";

export default function Home() {
  return (
    <div className="mx-auto max-w-[1040px] pb-16 text-center">
      <h1 className="mx-auto mb-8 max-w-[15ch] text-[34px] font-[680] leading-[1.22] tracking-[-.04em] sm:text-[46px]">
        <span className="font-semibold text-mfg">나중에 볼 동영상,</span>
        <br />이제 읽으세요
      </h1>
      <IngestForm />
      <p className="mt-4 text-[12.5px] text-mfg">
        전사 · 문단 나누기 · 목차까지 한 번에 만듭니다
      </p>
    </div>
  );
}
