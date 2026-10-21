import {test,expect} from "@playwright/test";

// 이미 만들어진 영상을 랜딩에서 넣으면 변환 없이 읽기 화면으로 간다.
// 로그인하지 않은 사람은 이 브라우저의 목록에 담겨야 물어보기가 그 영상을 찾는다.
test("a ready video entered from the landing page is kept in the guest library",async({page})=>{
  await page.goto("/");
  await page.evaluate(()=>localStorage.removeItem("digestube.mine"));
  const box=page.getByRole("textbox",{name:"유튜브 주소"}).first();
  await box.fill("https://youtu.be/byVgbqzYJrs");
  await box.press("Enter");
  await expect(page).toHaveURL(/videos\/byVgbqzYJrs/);
  await expect(page.locator('section[id^="ck"]').first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("digestube.mine") ?? "[]"))).toContain("byVgbqzYJrs");
});

test("opening a video by its address alone does not add it to the guest library",async({page})=>{
  await page.goto("/");
  await page.evaluate(()=>localStorage.removeItem("digestube.mine"));
  await page.goto("/videos/byVgbqzYJrs");
  await expect(page.locator('section[id^="ck"]').first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("digestube.mine") ?? "[]"))).not.toContain("byVgbqzYJrs");
});
