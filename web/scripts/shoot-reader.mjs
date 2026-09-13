/** 랜딩에 쓸 읽기 화면 캡처.
 *
 *    node scripts/shoot-reader.mjs            # 개발 서버가 떠 있어야 한다
 *    node scripts/shoot-reader.mjs <영상ID>
 *
 *  UI 를 고치면 다시 돌린다. 손으로 찍어 두면 실제 화면과 어긋난 그림을 팔게 된다.
 *  라이트만 찍는다 — 다크까지 두면 고칠 때마다 두 장을 맞춰야 한다.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const VIDEO = process.argv[2] ?? "byVgbqzYJrs";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const OUT = "public/shots";

const browser = await chromium.launch();
const page = await browser.newPage({
  // 2단 배치가 나오는 폭. 화면 배율 2 로 찍어야 큰 자리에 넣어도 글자가 뭉개지지 않는다.
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  // 움직임을 끄고 찍는다. 전환 중간 프레임이 잡히면 흐릿하게 나온다.
  reducedMotion: "reduce",
});

// newPage 의 colorScheme 만으로는 안 걸리는 경우가 있어 한 번 더 못박는다.
await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
await page.goto(`${BASE}/videos/${VIDEO}`, { waitUntil: "networkidle" });
await page.waitForSelector("text=목차");

// 유튜브 플레이어는 남의 iframe 이라 로딩 상태가 그대로 찍힌다.
// 자리는 남기고 안쪽만 영상 썸네일로 채운다 — 실제 화면과 크기·배치가 같다.
await page.evaluate(async (vid) => {
  const host = document.querySelector('[data-testid="youtube-player"]');
  if (!host) return;
  const img = document.createElement("img");
  img.src = `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
  img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
  host.replaceChildren(img);
  await img.decode().catch(() => {});
}, VIDEO);

// 개발 서버 배지와 자동재생 차단 안내는 실제 방문자가 보는 화면에 없다. 빼고 찍는다.
await page.evaluate(() => {
  document.querySelector("nextjs-portal")?.remove();
  for (const el of document.querySelectorAll('[role="status"]')) {
    if (el.textContent?.includes("자동 재생")) el.remove();
  }
});

mkdirSync(OUT, { recursive: true });
// 첫 화면만 찍는다. 요소 전체를 찍으면 전사문 끝까지 따라가 세로로 한없이 길어진다.
await page.screenshot({ path: `${OUT}/reader-light.png`, scale: "device" });

await browser.close();
console.log(`저장: ${OUT}/reader-light.png`);
