import {test,expect} from "@playwright/test";

test("library and saved reader render against current stored data",async({page})=>{
  await page.goto("/videos");
  const video=page.locator('a[href^="/videos/"]').first();
  await expect(video).toBeVisible();await video.click();
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator('section[id^="ck"]').first()).toBeVisible();
  await expect(page.getByText("목차",{exact:true})).toBeVisible();
});
