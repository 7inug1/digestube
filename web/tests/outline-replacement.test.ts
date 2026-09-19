import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {outlineWhole} from '../src/lib/outline-whole';

test('whole replacement removes old rows, is repeatable, preserves partial batches, guards revisions', async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role; create domain vector as text;
 create table video(id text primary key,title text,channel text,lang text,status text,job text,pieces int,chars int);
 create table chunk(id text primary key,video_id text references video(id),seq int,t real,t_end real,text text,embedding vector,unique(video_id,seq));
 create table outline(id bigserial primary key,video_id text references video(id),seq int,t real,label text,quote text,unique(video_id,seq));`);
 await db.exec(await readFile('supabase/migrations/20260910_finish_v2.sql','utf8'));
 const migration=await readFile('supabase/migrations/20260919_outline_replace.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 await db.exec(`insert into video(id,revision) values('v','r'); insert into chunk values ('v:0','v',0,0,10,'a','[1]'),('v:1','v',1,10,20,'b','[1]'),('v:2','v',2,20,30,'c','[1]');`);
 const item=(seq:number)=>({seq,t:seq*10,label:'title',quote:'a',source:'model',attempts:1});
 const scalar=async(sql:string,params:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,params)).rows[0])[0];
 const batch=(seq:number)=>scalar("select save_outline_batch('v','r',$1)",[JSON.stringify([item(seq)])]);
 await batch(0);await batch(1);assert.equal(await scalar('select count(*)::int from outline'),2);
 const replace=(rev:string,items= [item(1),item(2)])=>scalar("select replace_outline('v',$1,$2,'[\"summary\"]')",[rev,JSON.stringify(items)]);
 assert.equal(await replace('old'),false);
 await replace('r');await replace('r');await batch(0);
 assert.deepEqual((await db.query('select seq from outline order by seq')).rows,[{seq:1},{seq:2}]);
 await scalar("select refresh_video_status('v','r')");assert.equal(await scalar('select status from video'),'완료');
 await assert.rejects(replace('r',[item(0),item(0)]));
 assert.deepEqual((await db.query('select seq from outline order by seq')).rows,[{seq:1},{seq:2}]);
 await assert.rejects(replace('r',[item(0),item(4)]));
 await db.exec("update video set revision='new'");
 assert.equal(await scalar('select outline_complete from video'),false);
 assert.equal(await scalar('select tldr from video'),null);
 } finally {await db.close();}
});

test('valid start does not bypass quote validation; verified quote may be in a later paragraph',async()=>{
 const original=globalThis.fetch;const key=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test';
 globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({points:[
 {label:'Bad',start:'Start here.',quote:'Invented evidence.'},
 {label:'Good',start:'Start here.',quote:'Actual evidence.'}
 ]})}]}}]}),{status:200});
 try {
 const result=await outlineWhole([{seq:0,t:0,text:'Start here.'},{seq:1,t:10,text:'Actual evidence.'}]);
 assert.equal(result.items.length,1);assert.equal(result.items[0].label,'Good');assert.equal(result.items[0].t,0);
 assert.ok(result.dropped.some(x=>x.includes('인용문')));
 } finally {globalThis.fetch=original;if(key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=key;}
});
