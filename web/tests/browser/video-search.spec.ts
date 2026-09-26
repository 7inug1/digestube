import {test,expect} from '@playwright/test';

// 읽기 화면의 검색은 그 영상 안에서만, 화면을 떠나지 않고 결과를 보여 준다(2026-09-26).
// 예전에는 검색 화면으로 넘어갔고, 거기서 다시 찾으면 "이 영상 안에서" 조건이 풀렸다.
const VID='byVgbqzYJrs';

test('searching inside a video stays on the page, scopes to that video, and jumps to the paragraph',async({page})=>{
  let asked='';
  const hit={video_id:VID,seq:9,t:445,text:'결과로 보여 줄 문단입니다.',score:0.6,title:'',channel:'',duration:640};
  await page.route(/\/api\/search/,route=>{asked=route.request().url();return route.fulfill({status:200,contentType:'application/x-ndjson',
    body:JSON.stringify({t:'hits',hits:[hit]})+'\n'+JSON.stringify({t:'done',reranked:false,weak:true})+'\n'});});
  await page.goto(`/videos/${VID}`);
  const box=page.getByLabel('이 영상에서 찾기');
  await box.fill('기대를 내려놓는 법');
  await box.press('Enter');

  const results=page.getByRole('list',{name:'이 영상에서 찾은 대목'});
  await expect(results.getByRole('button')).toHaveCount(1);
  expect(page.url()).toContain(`/videos/${VID}`);
  expect(new URL(asked).searchParams.get('vid')).toBe(VID);
  await expect(page.getByText('질문과 딱 맞는 대목은 없을 수 있어요')).toBeVisible();

  await results.getByRole('button').first().click();
  await expect(page.locator('#ck9')).toBeInViewport();
});
