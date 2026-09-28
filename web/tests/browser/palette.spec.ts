import {test,expect,type Page} from '@playwright/test';

// 헤더 🔍 → 지금 페이지 위에 검색 창. 결과를 고르면 그 영상의 그 문단으로 가서 잠깐 반짝인다(2026-09-28).
const VID='byVgbqzYJrs';
const hits=[{video_id:VID,seq:2,t:88,text:'곁에서 지켜보며 측은하게 여긴다.',hl:'곁에서 지켜보며 측은하게 여긴다.',score:0.6,title:'인간관계에서 스트레스 받지 않는 사람의 특징',channel:'채널',duration:640}];

async function mock(page:Page){
  await page.route(/\/api\/rerank\/warm/,r=>r.fulfill({status:204,body:''}));
  await page.route(/\/api\/search/,r=>r.fulfill({status:200,contentType:'application/x-ndjson',
    body:[{t:'hits',hits},{t:'done',reranked:true,weak:false,top:3,by:'score',why:null}].map(x=>JSON.stringify(x)).join('\n')+'\n'}));
  await page.route(/\/api\/ask/,r=>r.fulfill({status:200,contentType:'application/x-ndjson',
    body:JSON.stringify({t:'done',text:'곁에서 지켜보라고 해요 [1].',cites:[1],declined:false})+'\n'}));
}

test('the header icon opens search over the current page and Esc returns focus',async({page})=>{
  await mock(page);
  await page.goto('/videos');
  const icon=page.getByRole('button',{name:/검색/});
  await icon.click();
  const dialog=page.getByRole('dialog',{name:'라이브러리 검색'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toBeFocused();
  expect(page.url()).toContain('/videos');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(icon).toBeFocused();
});

test('⌘K also opens it',async({page})=>{
  await mock(page);
  await page.goto('/videos');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog',{name:'라이브러리 검색'})).toBeVisible();
});

test('choosing a result goes to that paragraph of that video and flashes it',async({page})=>{
  await mock(page);
  await page.goto('/videos');
  await page.getByRole('button',{name:/검색/}).click();
  const box=page.getByRole('dialog',{name:'라이브러리 검색'}).getByRole('combobox');
  await box.fill('싫은 사람 대하는 법');
  await box.press('Enter');
  const dialog=page.getByRole('dialog',{name:'라이브러리 검색'});
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await expect(dialog.getByRole('region',{name:'AI 답'})).toContainText('곁에서 지켜보라고');
  await box.press('ArrowDown');
  await box.press('Enter');
  await page.waitForURL(new RegExp(`/videos/${VID}#ck2`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const para=page.locator('#ck2');
  await expect(para).toBeInViewport();
  await expect(para).toHaveAttribute('data-flash','on');
});

test('on a phone the search sheet covers the whole screen, not just the header',async({page})=>{
  await mock(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/videos');
  await page.getByRole('button',{name:/검색/}).click();
  const box=await page.getByRole('dialog',{name:'라이브러리 검색'}).boundingBox();
  expect(box!.height).toBeGreaterThan(800);
});

test('a search button runs the search without Enter, and an x closes',async({page})=>{
  await mock(page);
  await page.goto('/videos');
  await page.getByRole('button',{name:/검색/}).first().click();
  const dialog=page.getByRole('dialog',{name:'라이브러리 검색'});
  await dialog.getByRole('combobox').fill('싫은 사람 대하는 법');
  await dialog.getByRole('button',{name:'찾기'}).click();
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await dialog.getByRole('button',{name:'검색 창 닫기'}).click();
  await expect(dialog).toHaveCount(0);
});

// 입력하는 동안 글자가 맞는 대목을 바로 보여 준다 — Enter 전, 서버 검색 없이(2026-09-28)
test('while typing, paragraphs containing the words show up with the words marked',async({page})=>{
  await mock(page);
  let searched=0;
  page.on('request',r=>{ if(/\/api\/search/.test(r.url())) searched++; });
  await page.route(/\/api\/library\/text/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({videos:[
    {video_id:VID,title:'인간관계에서 스트레스 받지 않는 사람의 특징',chunks:[{seq:0,t:0,text:'오늘 이야기는 관계입니다.'},{seq:2,t:88,text:'곁에서 지켜보며 측은하게 여긴다.'}]},
  ]})}));
  await page.goto('/videos');
  await page.getByRole('button',{name:/검색/}).first().click();
  const dialog=page.getByRole('dialog',{name:'라이브러리 검색'});
  await dialog.getByRole('combobox').pressSequentially('측은하게 여기는 사람은');
  const preview=dialog.getByRole('listbox',{name:/글자가 맞는 대목/});
  await expect(preview).toBeVisible();
  await expect(dialog).toContainText('1편 1곳');
  await expect(preview.locator('mark')).toHaveText(['측은하게']);
  expect(searched).toBe(0);
  await preview.getByRole('option').first().click();
  await page.waitForURL(new RegExp(`/videos/${VID}#ck2`));
  await expect(page.locator('#ck2')).toHaveAttribute('data-flash','on');
});

test('arrow keys pick a preview line and Enter jumps there; with nothing picked Enter searches by meaning',async({page})=>{
  await mock(page);
  await page.route(/\/api\/library\/text/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({videos:[
    {video_id:VID,title:'인간관계',chunks:[{seq:2,t:88,text:'곁에서 지켜보며 측은하게 여긴다.'}]},
  ]})}));
  await page.goto('/videos');
  await page.getByRole('button',{name:/검색/}).first().click();
  const dialog=page.getByRole('dialog',{name:'라이브러리 검색'});
  const box=dialog.getByRole('combobox');
  await box.pressSequentially('측은하게');
  await expect(dialog.getByRole('listbox',{name:/글자가 맞는 대목/})).toBeVisible();
  await box.press('Enter');
  await expect(dialog.getByRole('region',{name:'AI 답'})).toBeVisible();
  await expect(dialog.getByRole('listbox',{name:/글자가 맞는 대목/})).toHaveCount(0);
  await box.fill('');
  await box.pressSequentially('지켜보며');
  await box.press('ArrowDown');
  await box.press('Enter');
  await page.waitForURL(new RegExp(`/videos/${VID}#ck2`));
});
