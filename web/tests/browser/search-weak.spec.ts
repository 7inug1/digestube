import {test,expect} from '@playwright/test';

// 라이브러리 검색도 같다 — 맞는 대목이 없어 보이면 "찾지 못했어요"를 먼저, 가까운 결과는 접어 둔다.
test('library search folds results behind a not-found message when the match is weak',async({page})=>{
  const hit={video_id:'byVgbqzYJrs',seq:1,t:33,text:'가까운 문단',score:0.5,title:'제목',channel:'채널',duration:640};
  await page.route(/\/api\/search/,route=>route.fulfill({status:200,contentType:'application/x-ndjson',
    body:JSON.stringify({t:'hits',hits:[hit]})+'\n'+JSON.stringify({t:'done',reranked:false,weak:true})+'\n'}));
  await page.route(/\/api\/rerank\/warm/,route=>route.fulfill({status:204,body:''}));
  await page.goto('/search?q=비트코인');
  await expect(page.getByText('라이브러리에서 이 질문에 맞는 내용을 찾지 못했어요')).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByRole('button',{name:'그래도 가까운 대목 보기'}).click();
  await expect(page.locator('article')).toHaveCount(1);
});
