/** 골든셋을 만들 코퍼스를 평가 스냅샷과 같은 영상으로 고정한다.
 *
 *  라이브러리 전체(`listVideos`)는 영상이 늘거나 빠지면 달라진다. 임베딩 비교와
 *  같은 영상·같은 문단으로 질문을 만들어야 두 결과를 이어서 말할 수 있으므로,
 *  스냅샷의 영상만 남기고 리비전·문단 수가 다르면 멈춘다.
 */
type SnapshotVideo = { video: { id: string }; revision: string | null; chunks: unknown[] };
export type CorpusSnapshot = { corpus: SnapshotVideo[] };

export function selectCorpus<T extends { id: string; revision: string | null; chunks: unknown[] }>(
  loaded: T[],
  snapshot: CorpusSnapshot,
): T[] {
  const byId = new Map(loaded.map(v => [v.id, v]));
  return snapshot.corpus.map(s => {
    const id = s.video.id;
    const v = byId.get(id);
    if (!v) throw new Error(`스냅샷 영상 ${id} 가 DB 에 없다`);
    if (v.revision !== s.revision) throw new Error(`${id} 리비전이 스냅샷과 다르다 (${s.revision} → ${v.revision})`);
    if (v.chunks.length !== s.chunks.length) {
      throw new Error(`${id} 문단 수가 스냅샷과 다르다 (${s.chunks.length} → ${v.chunks.length})`);
    }
    return v;
  });
}
