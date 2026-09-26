import {test,expect,type Page} from '@playwright/test';

// 읽기 화면의 검색은 그 영상 안에서만, 화면을 떠나지 않고 결과를 보여 준다(2026-09-26).
// 맞는 대목이 없어 보이면(weak) "찾지 못했어요"를 먼저 말하고 가까운 대목은 접어 둔다.
const VID='byVgbqzYJrs';
const hit={video_id:VID,seq:9,t:445,text:'결과로 보여 줄 문단입니다.',score:0.6,title:'',channel:'',duration:640};

async function answer(page:Page,weak:boolean|null,top:number|null=null){
  let asked='';
  await page.route(/\/api\/search/,route=>{asked=route.request().url();return route.fulfill({status:200,contentType:'application/x-ndjson',
    body:JSON.stringify({t:'hits',hits:[hit]})+'\n'+JSON.stringify({t:'done',reranked:false,weak,top,cut:-4})+'\n'});});
  await page.route(/\/api\/rerank\/warm/,route=>route.fulfill({status:204,body:''}));
  return ()=>asked;
}

test('searching inside a video stays on the page, scopes to that video, and jumps to the paragraph',async({page})=>{
  const asked=await answer(page,false);
  await page.goto(`/videos/${VID}`);
  const box=page.getByLabel('이 영상에서 찾기');
  await box.fill('기대를 내려놓는 법');
  await box.press('Enter');
  const results=page.getByRole('list',{name:'이 영상에서 찾은 대목'});
  await expect(results.getByRole('button')).toHaveCount(1);
  expect(page.url()).toContain(`/videos/${VID}`);
  // 범위·다듬기 같은 내부 사정은 말하지 않는다 — 사용자에게 필요한 건 결과뿐이다
  await expect(page.getByText('이 영상 안에서')).toHaveCount(0);
  await expect(page.getByText('정리하는 중')).toHaveCount(0);
  expect(new URL(asked()).searchParams.get('vid')).toBe(VID);
  await results.getByRole('button').first().click();
  await expect(page.locator('#ck9')).toBeInViewport();
});

test('a weak match says nothing was found first and folds the nearest paragraphs',async({page})=>{
  await answer(page,true,-7.83);
  await page.goto(`/videos/${VID}`);
  await page.getByLabel('이 영상에서 찾기').fill('비트코인 전망');
  await page.getByLabel('이 영상에서 찾기').press('Enter');
  await expect(page.getByText('이 영상에서 이 질문에 맞는 내용을 찾지 못했어요')).toBeVisible();
  const results=page.getByRole('list',{name:'이 영상에서 찾은 대목'});
  await expect(results).toHaveCount(0);
  await page.getByRole('button',{name:'그래도 가까운 대목 보기'}).click();
  await expect(results.getByRole('button')).toHaveCount(1);
  // 펼치면 왜 못 찾았다고 했는지 점수와 기준을 같이 보여 준다
  await expect(page.getByText('관련도 점수 -7.8')).toBeVisible();
  await expect(page.getByText('기준 -4')).toBeVisible();
});

test('while waiting it says what it is doing',async({page})=>{
  await page.route(/\/api\/rerank\/warm/,route=>route.fulfill({status:204,body:''}));
  await page.route(/\/api\/search/,async route=>{await new Promise(r=>setTimeout(r,1500));
    await route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({t:'hits',hits:[hit]})+'\n'+JSON.stringify({t:'done',reranked:false,weak:false})+'\n'});});
  await page.goto(`/videos/${VID}`);
  await page.getByLabel('이 영상에서 찾기').fill('질문');
  await page.getByLabel('이 영상에서 찾기').press('Enter');
  await expect(page.getByText('관련 있는 문단을 찾는 중')).toBeVisible();
  await expect(page.getByRole('list',{name:'이 영상에서 찾은 대목'})).toBeVisible();
});

test('the video page wakes the reranker once when it opens',async({page})=>{
  let warmed=0;
  await page.route(/\/api\/rerank\/warm/,route=>{warmed++;return route.fulfill({status:204,body:''});});
  await page.goto(`/videos/${VID}`);
  await expect.poll(()=>warmed).toBe(1);
});
