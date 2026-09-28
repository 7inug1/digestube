/** 검색 창(팔레트)과 읽기 화면이 주고받는 작은 약속들. */

/** 같은 영상 페이지 안에서 문단으로 옮길 때 쓰는 이벤트 — 페이지를 새로 불러오지 않는다 */
export const JUMP_EVENT = "digestube:jump";

export function seqFromHash(hash: string): number | null {
  const m = hash.match(/^#ck(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function splitVideoHref(href: string): { path: string; seq: number } | null {
  const m = href.match(/^(\/videos\/[^#?]+)#ck(\d+)$/);
  return m ? { path: m[1], seq: Number(m[2]) } : null;
}

/** ⌘K·Ctrl+K 는 어디서든 연다. "/" 는 글을 쓰는 중이 아닐 때만 — 검색어에 / 를 칠 수 있어야 한다. */
export function isPaletteShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; typing: boolean }): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return true;
  return e.key === "/" && !e.metaKey && !e.ctrlKey && !e.typing;
}
