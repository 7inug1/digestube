/** 랜딩 캐러셀에 쓸 화면 캡처.
 *
 *    node scripts/shoot-screens.mjs          # 개발 서버가 떠 있어야 한다
 *
 *  UI 를 고치면 다시 돌린다. 손으로 그린 그림을 랜딩에 걸면 실제 화면과 어긋난다.
 *  라이트만 찍는다 — 다크까지 두면 고칠 때마다 두 장씩 맞춰야 한다.
 *  읽기 화면은 shoot-reader.mjs 가 따로 찍는다(유튜브 iframe 을 갈아끼워야 해서).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const OUT = "public/shots";

/** 찍을 화면. wait 는 그 화면이 다 그려졌다는 신호다 — 없으면 빈 화면이 찍힌다. */
const SCREENS = [
  {name: "search-light", path: "/search?q=" + encodeURIComponent("인간관계"), wait: "text=관련 문단", height: 900},
  // 랜딩 캐러셀 틀이 16:10 이다. 더 납작하게 찍으면 좌우가 잘려 로고까지 날아간다.
  // 1280x800 이 딱 16:10 — 카드 두 줄이 다 들어오고 잘리는 데도 없다.
  {name: "library-light", path: "/videos", wait: "text=라이브러리", height: 800},
];

mkdirSync(OUT, {recursive: true});
const browser = await chromium.launch();
for (const s of SCREENS) {
  const page = await browser.newPage({
    // 읽기 화면 캡처와 같은 크기여야 캐러셀에서 장마다 크기가 튀지 않는다
    viewport: {width: 1280, height: s.height},
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await page.emulateMedia({colorScheme: "light", reducedMotion: "reduce"});
  await page.goto(`${BASE}${s.path}`, {waitUntil: "networkidle"});
  // 개발 서버 배지(왼쪽 아래 동그라미)는 우리 화면이 아니다. 찍히면 지워야 한다
  await page.addStyleTag({content: "nextjs-portal{display:none!important}"});
  await page.waitForSelector(s.wait);
  await page.waitForTimeout(400);
  await page.screenshot({path: `${OUT}/${s.name}.png`});
  await page.close();
  console.log(`${OUT}/${s.name}.png`);
}
await browser.close();
