/** 로그인하지 않은 사람의 라이브러리 — 이 브라우저에만 남는다.
 *
 *  서버에 익명 식별자를 만들어 두는 방법도 있지만, 그러면 지우는 방법도 같이
 *  만들어야 하고 결국 로그인과 다를 바 없어진다. 브라우저에 두면 탭을 닫아도
 *  남고, 시크릿창·다른 기기에서는 안 보인다 — 그게 정직한 경계다.
 *  로그인하면 이 목록을 계정으로 옮기고 여기는 비운다.
 */
const KEY = "digestube.mine";


export function mine(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return []; // 시크릿창·저장소 차단에서는 조용히 빈 목록
  }
}

/** 최근에 담은 것이 앞에 온다. 같은 영상을 다시 담으면 앞으로 올라온다. */
export function remember(vid: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([vid, ...mine().filter(v => v !== vid)]));
  } catch {}
}

export function forget(vid: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mine().filter(v => v !== vid)));
  } catch {}
}

export function clearMine(): void {
  // 계정으로 옮긴 뒤 부른다
  try { localStorage.removeItem(KEY); } catch {}
}
