import {test,expect} from "@playwright/test";

test("existing video requires explicit confirmation before replacement; cancellation does not ingest",async({page})=>{
  const bodies: {url:string;replace:boolean}[]=[];
  await page.route("**/api/ingest",async route=>{
    bodies.push(route.request().postDataJSON());
    await route.fulfill({status:bodies.at(-1)?.replace ? 502 : 409,json:bodies.at(-1)?.replace ?
      {error:"자막을 가져오지 못했습니다. 기존 내용은 유지됩니다."} :
      {code:"VIDEO_EXISTS",vid:"NtHSSWC04Do",title:"기존 영상",error:"이미 등록된 영상입니다."}});
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"유튜브 주소"}).fill("https://youtu.be/NtHSSWC04Do");
  await page.getByRole("button",{name:"넣기",exact:true}).click();
  await expect(page.getByRole("link",{name:"저장된 영상 보기"})).toBeVisible();
  await page.getByRole("button",{name:"자막 다시 가져오기"}).click();
  await page.getByRole("button",{name:"취소",exact:true}).click();
  expect(bodies).toHaveLength(1);
  await page.getByRole("button",{name:"자막 다시 가져오기"}).click();
  await page.getByRole("button",{name:"교체하기",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("기존 내용은 유지");
  expect(bodies).toHaveLength(2);expect(bodies[0].replace).toBe(false);expect(bodies[1].replace).toBe(true);
});

test("a failed outline is visible and resumes without a second transcript request",async({page})=>{
  let ingest=0,outline=0,embedding=0;
  await page.route("**/api/ingest",async route=>{ingest++;await route.fulfill({json:{state:"done",vid:"NtHSSWC04Do",chunks:5,chars:500}});});
  await page.route("**/api/outline",async route=>{
    outline++;
    if(outline===1) await route.fulfill({status:502,json:{error:"목차 저장 실패"}});
    else await route.fulfill({json:{done:outline===2 ? 4:1,kept:outline===2 ? 4:5,n:5,left:outline===2 ? 1:0}});
  });
  await page.route("**/api/embed",async route=>{embedding++;await route.fulfill({json:{done:5,left:0}});});
  await page.goto("/");
  await page.getByRole("textbox",{name:"유튜브 주소"}).fill("https://youtu.be/NtHSSWC04Do");
  await page.getByRole("button",{name:"넣기",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("목차 저장 실패");
  await page.getByRole("button",{name:"처리 이어하기"}).click();
  await expect(page).toHaveURL(/videos\/NtHSSWC04Do/);
  expect(ingest).toBe(1);expect(outline).toBe(3);expect(embedding).toBe(1);
});

test("library and saved reader render against current stored data",async({page})=>{
  await page.goto("/videos");
  const video=page.locator('a[href^="/videos/"]').first();
  await expect(video).toBeVisible();await video.click();
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator('section[id^="ck"]').first()).toBeVisible();
  await expect(page.getByText("목차",{exact:true})).toBeVisible();
});
