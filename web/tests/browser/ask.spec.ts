import {test,expect,type Page} from '@playwright/test';

// 전체 검색에서 "답이 있다"고 판단하면 검색 결과 위에 AI 답을 흘려 보여 준다(2026-09-27).
// 문장마다 각주 [n] — 누르면 그 영상·그 시각(문단)으로 간다. "찾지 못했어요"면 답을 만들지 않는다.
const hit=(vid:string,seq:number,t:number,title:string)=>({video_id:vid,seq,t,text:`${title} 문단`,score:0.5,title,channel:'채널',duration:600});
const hits=[hit('3KtrlNyd1ec',3,69,'코난 오브라이언'),hit('PlawByYfV8k',3,89,'조바심에 관한 한 가지 깨달음')];

async function mock(page:Page,weak:boolean,ask?:string[]){
  let asked:unknown=null;
  await page.route(/\/api\/rerank\/warm/,r=>r.fulfill({status:204,body:''}));
  await page.route(/\/api\/search/,r=>r.fulfill({status:200,contentType:'application/x-ndjson',
    body:[{t:'hits',hits},{t:'done',reranked:true,weak,top:weak?-9:3,by:'score',why:null}].map(x=>JSON.stringify(x)).join('\n')+'\n'}));
  await page.route(/\/api\/ask/,r=>{asked=r.request().postDataJSON();return r.fulfill({status:200,contentType:'application/x-ndjson',body:(ask??[]).join('\n')+'\n'});});
  return ()=>asked;
}

test('a found answer streams above the results with citations that jump to the video time',async({page})=>{
  const text='준비가 안 됐어도 잡으라고 해요 [1]. 대비만 하다 할 일을 놓치지 말래요 [2].';
  const asked=await mock(page,false,[JSON.stringify({t:'delta',text:'준비가 안 됐어도 '}),JSON.stringify({t:'done',text,cites:[1,2],declined:false})]);
  await page.goto('/search?q=준비가 덜 됐는데 기회가 오면');
  const card=page.getByRole('region',{name:'AI 답'});
  await expect(card).toContainText('준비가 안 됐어도 잡으라고 해요');
  await expect(card.getByRole('link',{name:'근거 1: 코난 오브라이언 1:09'})).toHaveAttribute('href','/videos/3KtrlNyd1ec#ck3');
  await expect(card.getByRole('link',{name:'근거 2: 조바심에 관한 한 가지 깨달음 1:29'})).toHaveAttribute('href','/videos/PlawByYfV8k#ck3');
  await expect(card).toContainText('아래 문단만 근거로');
  expect((asked() as {q:string;hits:unknown[]}).hits).toHaveLength(2);
  // 근거 문단(검색 결과)은 답 아래에 그대로 있다
  await expect(page.locator('article')).toHaveCount(2);
});

test('when nothing matches it does not ask for an answer',async({page})=>{
  const asked=await mock(page,true);
  await page.goto('/search?q=비트코인 전망');
  await expect(page.getByText('라이브러리에서 이 질문에 맞는 내용을 찾지 못했어요')).toBeVisible();
  await expect(page.getByRole('region',{name:'AI 답'})).toHaveCount(0);
  expect(asked()).toBeNull();
});

test('if the model declines, it says so plainly and keeps the paragraphs',async({page})=>{
  await mock(page,false,[JSON.stringify({t:'done',text:'찾은 문단만으로는 답하기 어려워요.',cites:[],declined:true})]);
  await page.goto('/search?q=애매한 질문');
  await expect(page.getByRole('region',{name:'AI 답'})).toContainText('아래 문단을 직접 확인해 보세요');
  await expect(page.locator('article')).toHaveCount(2);
});
