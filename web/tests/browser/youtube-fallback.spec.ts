import {test,expect,type Page} from '@playwright/test';
const stub=`
window.__players=[];window.__seeks=[];
window.YT={Player:class{
 constructor(host,options){window.__players.push(options.events);}
 seekTo(t){window.__seeks.push(t);}
 playVideo(){}
 destroy(){}
}};window.onYouTubeIframeAPIReady();`;
async function setup(page:Page){
 await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'application/javascript',body:stub}));
 await page.goto('/videos/3KtrlNyd1ec');
 await page.waitForFunction(()=>Boolean((window as unknown as {__players:unknown[]}).__players?.length));
}
async function emit(page:Page,event:string,data?:number,index=-1){
 await page.evaluate(({event,data,index})=>{
  const events=(window as unknown as {__players:Record<string,(event:{data?:number})=>void>[]}).__players.at(index)!;
  events[event]({data});
 },{event,data,index});
}
test('error retains reading, timestamp link, and retry ignores stale callbacks',async({page})=>{
 await setup(page);await expect(page.getByRole('status')).toContainText('영상 불러오는 중');
 await emit(page,'onReady');await emit(page,'onError',101);
 await expect(page.getByTestId('youtube-player').getByRole('alert')).toContainText('외부 사이트에서 재생할 수 없어요');
 await page.locator('#ck2 button').click();
 await expect(page.getByTestId('youtube-player').getByRole('link',{name:'유튜브에서 보기',exact:true})).toHaveAttribute('href','https://www.youtube.com/watch?v=3KtrlNyd1ec&t=31s');
 await expect(page.locator('#ck2')).toBeVisible();
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.waitForFunction(()=>(window as unknown as {__players:unknown[]}).__players.length===2);
 await emit(page,'onError',100,0);await expect(page.getByTestId('youtube-player').getByRole('alert')).toHaveCount(0);
 await emit(page,'onReady');
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__seeks:number[]}).__seeks.at(-1))).toBe(31.36);
 await expect(page.getByRole('status')).toHaveCount(0);
});
test('failed script can be downloaded again on retry',async({page})=>{
 let requests=0;
 await page.route('https://www.youtube.com/iframe_api',route=>++requests===1?route.abort():route.fulfill({contentType:'application/javascript',body:stub}));
 await page.goto('/videos/3KtrlNyd1ec');
 await expect(page.getByTestId('youtube-player').getByRole('alert')).toContainText('유튜브에 연결하지 못했어요');
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.waitForFunction(()=>Boolean((window as unknown as {__players:unknown[]}).__players?.length));
 await emit(page,'onReady');await expect(page.getByTestId('youtube-player').getByRole('alert')).toHaveCount(0);expect(requests).toBe(2);
});
test('player that never becomes ready times out, but autoplay blocking leaves controls available',async({page})=>{
 await page.clock.install();await setup(page);await emit(page,'onStateChange',-1);
 await page.clock.fastForward(21000);
 await expect(page.getByTestId('youtube-player').getByRole('alert')).toContainText('연결이 지연');
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.waitForFunction(()=>(window as unknown as {__players:unknown[]}).__players.length===2);
 await emit(page,'onReady');await emit(page,'onAutoplayBlocked');
 await expect(page.getByRole('status')).toContainText('자동 재생이 차단');
 await expect(page.getByTestId('youtube-player').getByRole('alert')).toHaveCount(0);
 await emit(page,'onStateChange',1);await expect(page.getByRole('status')).toHaveCount(0);
});
test('private or removed video does not invent a definite cause, and buffering timeout can be retried',async({page})=>{
 await page.clock.install();await setup(page);await emit(page,'onReady');await emit(page,'onError',100);
 await expect(page.getByTestId('youtube-player').getByRole('alert')).toContainText('삭제되었거나 비공개로 전환된 영상일 수 있어요');
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.waitForFunction(()=>(window as unknown as {__players:unknown[]}).__players.length===2);
 await emit(page,'onReady');await emit(page,'onStateChange',3);await page.clock.fastForward(21000);
 await expect(page.getByTestId('youtube-player').getByRole('alert')).toContainText('연결이 지연');
});
