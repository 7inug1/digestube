import {test,expect} from '@playwright/test';

// 긴 영상 제목이 휴대폰 화면을 옆으로 밀면 안 된다(2026-09-26 운영에서 발견: 390px 에서 폭 572px).
test('long video title does not push the search page sideways on a phone',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  const hit={video_id:'LHpplKlnXes',seq:0,t:0,text:'If you want to become an AI engineer, you might not need a computer science degree.',score:0.6,
    title:'[한영자막] AI 엔지니어가 되려면 무엇부터 배워야 할까요? (필수 기술 스택과 로드맵 전체 정리 완전판)',channel:'채널',duration:640};
  await page.route(/\/api\/search/,route=>route.fulfill({status:200,contentType:'application/x-ndjson',
    body:JSON.stringify({t:'hits',hits:[hit]})+'\n'+JSON.stringify({t:'done',reranked:false,weak:null})+'\n'}));
  await page.goto('/search?q=test');
  await expect(page.getByText('가까운 영상 1편')).toBeVisible();
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
