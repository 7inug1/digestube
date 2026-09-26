import {test,expect} from '@playwright/test';

// 검색 화면도 처리가 다 끝난 뒤 최종 결과만 보여 준다. 먼저 보여 줬다가 순서를 바꾸지 않는다.
test('library search shows only the final order, without refining messages',async({page})=>{
  const h=(seq:number,title:string)=>({video_id:`v${seq}`,seq,t:seq,text:`문단 ${seq}`,score:0.5,title,channel:'채널',duration:600});
  await page.route(/\/api\/search/,route=>route.fulfill({status:200,contentType:'application/x-ndjson',
    body:[{t:'hits',hits:[h(1,'먼저 온 결과'),h(2,'나중 결과')]},{t:'reranked',hits:[h(2,'나중 결과'),h(1,'먼저 온 결과')]},{t:'done',reranked:true,weak:false}]
      .map(x=>JSON.stringify(x)).join('\n')+'\n'}));
  await page.route(/\/api\/rerank\/warm/,route=>route.fulfill({status:204,body:''}));
  await page.goto('/search?q=질문');
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.locator('article').first()).toContainText('나중 결과');
  await expect(page.getByText('정리하는 중')).toHaveCount(0);
  await expect(page.getByText('더 관련 있는 순서로 보기')).toHaveCount(0);
});
