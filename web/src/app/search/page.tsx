import SearchForm from "@/components/SearchForm";
import SearchResults from "@/components/SearchResults";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Search({
  searchParams,
}: { searchParams: Promise<{ q?: string; vid?: string }> }) {
  const { q = "", vid } = await searchParams;
  const user = await currentUser();

  return (
    <div className="mx-auto max-w-[720px]">
      {/* 범위를 넘겨받아야 결과 화면에서 다시 찾아도 "이 영상 안에서"가 풀리지 않는다 */}
      <SearchForm q={q} vid={vid} />
      {/* q 가 바뀌면 결과 컴포넌트를 새로 만든다 — 지난 결과가 잠깐 남지 않는다 */}
      <SearchResults key={`${q}|${vid ?? ""}`} q={q} vid={vid} signedIn={Boolean(user)} />
    </div>
  );
}
