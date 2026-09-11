import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
test('review decisions persist and partial export does not freeze the questions',async({page})=>{
 await page.goto(pathToFileURL(resolve('../notes/search-review.html')).href);
 await expect(page.locator('#question')).toContainText('아이를 데리러');
 await expect(page.locator('#progress-text')).toContainText('6 / 10');
 await page.getByRole('button',{name:'괜찮음',exact:true}).click();
 await page.locator('#next').click();
 await page.locator('#memo').fill('질문을 더 짧게');
 await page.getByRole('button',{name:'수정 필요',exact:true}).click();
 await page.reload();await expect(page.locator('#progress-text')).toContainText('8 / 10');
 const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending;
 const data=JSON.parse(await readFile((await download.path())!,'utf8'));
 expect(data.status).toBe('pending_human_review');expect(data.search_executed).toBe(false);
 expect(data.questions[3].review_status).toBe('approved');expect(data.questions[4].reviewer_notes).toBe('질문을 더 짧게');
});
test('only individual approval of every question yields a frozen export',async({page})=>{
 await page.goto(pathToFileURL(resolve('../notes/search-review.html')).href);
 for(let i=0;i<3;i++)await page.locator('#prev').click();
 for(let i=0;i<10;i++){
  await page.getByRole('button',{name:'괜찮음',exact:true}).click();if(i<9)await page.locator('#next').click();
 }
 const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending;
 const data=JSON.parse(await readFile((await download.path())!,'utf8'));
 expect(data.status).toBe('frozen');expect(data.questions.every((q:{review_status:string})=>q.review_status==='approved')).toBe(true);
 expect(data.search_executed).toBe(false);
});
