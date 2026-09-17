import LibraryGrid from "@/components/LibraryGrid";
import ShareLibrary from "@/components/ShareLibrary";
import SearchForm from "@/components/SearchForm";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Videos() {
  const user = await currentUser();
  return (
    <div className="mx-auto max-w-[1320px]">
      <h1 className="mb-1 text-[22px] font-[660] tracking-[-.03em]">라이브러리</h1>
      <p className="mb-6 text-small text-mfg">
        {user
          ? "담은 영상은 어느 기기에서든 여기 있어요."
          : "이 브라우저에 담은 영상이에요. 로그인하면 어느 기기에서든 볼 수 있어요."}
      </p>
      {/* 공유는 로그인한 사람만. 브라우저에만 있는 목록은 남에게 보여줄 주소가 없다 */}
      {/* 찾는 자리에 찾는 칸을 둔다. 헤더 글자만 있을 때는 "여기서 찾을 수 있다"는 걸
          아무도 몰랐다 — 라이브러리에 왔다는 건 무언가를 찾으러 왔다는 뜻이다. */}
      <div className="mb-6"><SearchForm q="" /></div>
      {user && <ShareLibrary />}
      <LibraryGrid signedIn={Boolean(user)} />
    </div>
  );
}
