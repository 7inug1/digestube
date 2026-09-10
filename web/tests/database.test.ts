import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

// These tests exercise real PostgreSQL transactions. Vector distance is out of scope;
// use a text domain for embedding storage because pgvector isn't bundled with PGlite.
test("migration, duplicate protection, atomic replacement and stale response guards",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create domain vector as text;
      create table video(id text primary key,title text,channel text,lang text,status text default '전사중',job text,pieces int,chars int,created_at timestamptz default now());
      create table chunk(id text primary key,video_id text references video(id) on delete cascade,seq int,t real,t_end real,text text not null,embedding vector,unique(video_id,seq));
      create table outline(id bigserial primary key,video_id text references video(id) on delete cascade,seq int,t real,label text,quote text,unique(video_id,seq));`);
    const migration=await readFile("supabase/migrations/20260910_finish_v2.sql","utf8");
    await db.exec(migration);await db.exec(migration);
    async function scalar(sql:string,params:unknown[]=[]) {return Object.values((await db.query<Record<string,unknown>>(sql,params)).rows[0])[0];}
    const begin=(replace:boolean,token:string)=>scalar("select begin_ingest('abcdefghijk',$1,$2,'native','ko')",[replace,token]);
    const finish=(token:string,chunks:unknown)=>scalar("select finish_ingest('abcdefghijk',$1,$2,$3)",[token,JSON.stringify({title:"새 제목",lang:"ko",chars:3,pieces:1}),JSON.stringify(chunks)]);
    const source=[{t:0,t_end:10,text:"원래 자막"}];
    assert.equal(await begin(false,"first"),"started");
    assert.equal(await begin(true,"concurrent"),"busy");
    assert.equal(await finish("first",source),true);
    await db.exec("insert into outline(video_id,seq,t,label,quote) values('abcdefghijk',0,0,'기존 목차','원래 자막'); update chunk set embedding='[1,2]';");
    assert.equal(await begin(false,"duplicate"),"exists");
    assert.equal(await begin(true,"replacement"),"started");
    assert.equal(await scalar("select text from chunk"),"원래 자막");
    await assert.rejects(finish("replacement",[{t:0,t_end:10,text:null}]));
    assert.equal(await scalar("select text from chunk"),"원래 자막");
    assert.equal(await scalar("select label from outline"),"기존 목차");
    await db.query("select cancel_ingest('abcdefghijk','replacement')");
    assert.equal(await scalar("select mode from video"),"native");
    assert.equal(await begin(true,"final"),"started");
    assert.equal(await finish("replacement",source),false);
    assert.equal(await finish("final",[{t:12,t_end:20,text:"교체된 자막"}]),true);
    assert.equal(await scalar("select count(*)::int from outline"),0);
    assert.equal(await scalar("select embedding from chunk"),null);
    const items=JSON.stringify([{seq:0,t:12,label:"교체된 자막",quote:"",source:"fallback",attempts:2,failure:"quote_mismatch"}]);
    assert.equal(await scalar("select save_outline_batch('abcdefghijk','first',$1)",[items]),false);
    assert.equal(await scalar("select save_outline_batch('abcdefghijk','final',$1)",[items]),true);
    await scalar("select refresh_video_status('abcdefghijk','final')");
    assert.equal(await scalar("select status from video"),"문단완료");
    const vectors=JSON.stringify([{seq:0,vector:[1,2]}]);
    assert.equal(await scalar("select save_embedding_batch('abcdefghijk','first',$1)",[vectors]),false);
    assert.equal(await scalar("select save_embedding_batch('abcdefghijk','final',$1)",[vectors]),true);
    await scalar("select refresh_video_status('abcdefghijk','final')");
    assert.equal(await scalar("select status from video"),"완료");
    assert.equal(await scalar("select requested_lang from video"),"ko");
    assert.ok(await scalar("select transcribed_at from video"));
    assert.equal(await scalar("select has_function_privilege('anon','begin_ingest(text,boolean,text,text,text)','execute')"),false);
  } finally {await db.close();}
});
