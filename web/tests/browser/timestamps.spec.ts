import {test,expect} from "@playwright/test";

test("a timestamp click before player readiness is retained at fractional precision",async({page})=>{
 await page.route("https://www.youtube.com/iframe_api",route=>route.fulfill({contentType:"application/javascript",body:`
 window.__seeks=[];
 window.YT={Player:class {
  constructor(host,options){window.__playerReady=()=>options.events.onReady();}
  seekTo(t){window.__seeks.push(t);}
  loadVideoById(o){window.__seeks.push(o.startSeconds);}
  playVideo(){}
  destroy(){}
 }};
 window.onYouTubeIframeAPIReady();
 `}));
 await page.goto("/videos/3KtrlNyd1ec");
 await page.waitForFunction(()=>Boolean((window as unknown as {__playerReady?:()=>void}).__playerReady));
 await page.locator("#ck2 button").click();
 expect(await page.evaluate(()=>(window as unknown as {__seeks:number[]}).__seeks)).toEqual([]);
 await page.evaluate(()=>(window as unknown as {__playerReady:()=>void}).__playerReady());
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__seeks:number[]}).__seeks.at(-1))).toBe(31.36);
 await expect(page.locator("#ck2 button")).toHaveClass(/bg-fg/);
 await expect(page.locator("#ck1 button")).not.toHaveClass(/bg-fg/);
});
