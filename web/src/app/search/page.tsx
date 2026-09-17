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
      <SearchForm q={q} />
      {/* q 가 바뀌면 결과 컴포넌트를 새로 만든다 — 지난 결과가 잠깐 남지 않는다 */}
      <SearchResults key={`${q}|${vid ?? ""}`} q={q} vid={vid} signedIn={Boolean(user)} />
    </div>
  );
}
