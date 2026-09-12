/** Apply a reviewed paragraph plan. Prepare all derived data before replacing content.
 * node --experimental-websocket --env-file=.env.local --import tsx scripts/apply-boundary-repair.ts <vid> <aligned.json> <source.json>
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {label} from '../src/lib/outline';
import {embed} from '../src/lib/embed';
import assert from 'node:assert/strict';
async function main(){
 const [vid,planPath,sourcePath]=process.argv.slice(2);if(!vid||!planPath||!sourcePath)throw new Error('vid, reviewed plan and timed source are required');
 const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const cs=JSON.parse(await readFile(planPath,'utf8')) as {seq:number;text:string;t:number;t_end:number}[];
 const source=JSON.parse(await readFile(sourcePath,'utf8'));
 const v=await db.from('video').select('*').eq('id',vid).single();if(v.error)throw v.error;
 const before=await db.from('chunk').select('*').eq('video_id',vid).order('seq');if(before.error)throw before.error;
 const os=await db.from('outline').select('*').eq('video_id',vid);if(os.error)throw os.error;
 const normalize=(s:string)=>s.replace(/\s+/gu,' ').trim();
 assert.equal(normalize(cs.map(c=>c.text).join(' ')),normalize(before.data.map(c=>c.text).join(' ')));
 assert.ok(cs.length && cs.every((c,i)=>c.seq===i&&c.t>=0&&c.t_end>=c.t&&(!i||c.t>=cs[i-1].t)));
 const marks=await db.from('bookmark').select('id').in('chunk_id',before.data.map(c=>c.id));if(marks.error||marks.data.length)throw new Error('Bookmarks require migration');
 const dir=`data/repairs/boundaries-${Date.now()}`;await mkdir(dir,{recursive:true});
 await writeFile(`${dir}/${vid}-before.json`,JSON.stringify({video:v.data,chunks:before.data,outline:os.data}));
 const outlines=[];for(const c of cs){outlines.push(await label(c));console.log('Prepared title',c.seq);}
 const vectors=await embed(cs.map(c=>c.text));assert.equal(vectors.length,cs.length);console.log('Prepared vectors',vectors.length);
 const token=crypto.randomUUID();
 const archive=await db.storage.from('transcript-sources').upload(`${vid}/${token}.json`,JSON.stringify({kind:'boundary-repair',video_id:vid,revision:token,reference:source,original_chunks:before.data.map(({text,seq,t,t_end})=>({text,seq,t,t_end})),chunks:cs}),{contentType:'application/json'});if(archive.error)throw archive.error;
 const old=v.data;
 const lock=await db.rpc('begin_ingest',{p_vid:vid,p_replace:true,p_token:token,p_mode:old.mode,p_lang:old.requested_lang});if(lock.error||lock.data!=='started')throw new Error('Reservation failed');
 try{
  const current=await db.from('video').select('revision').eq('id',vid).single();if(current.error||current.data.revision!==old.revision)throw new Error('Video changed');
  for(const [name,args] of [
   ['finish_ingest',{p_vid:vid,p_token:token,p_meta:old,p_chunks:cs}],
   ['save_outline_batch',{p_vid:vid,p_revision:token,p_items:outlines}],
   ['save_embedding_batch',{p_vid:vid,p_revision:token,p_items:cs.map((c,i)=>({seq:c.seq,vector:vectors[i]}))}],
   ['refresh_video_status',{p_vid:vid,p_revision:token}],
  ] as const){const r=await db.rpc(name,args);if(r.error||r.data!==true)throw new Error(`${name}: ${r.error?.message??'stale write'}`);}
  const provenance=await db.from('video').update({transcribed_at:old.transcribed_at}).eq('id',vid).eq('revision',token).select('id');if(provenance.error||provenance.data.length!==1)throw new Error('Provenance restore failed');
 }catch(e){await db.rpc('cancel_ingest',{p_vid:vid,p_token:token});throw e;}
 const checked=await db.from('chunk').select('seq,text,t,t_end,embedding').eq('video_id',vid).order('seq');if(checked.error)throw checked.error;
 assert.deepEqual(checked.data.map(({seq,text,t,t_end})=>({seq,text,t,t_end})),cs);
 assert.ok(checked.data.every(c=>c.embedding));
 await writeFile(`${dir}/${vid}-applied.json`,JSON.stringify({vid,revision:token,chunks:cs}));console.log('VERIFIED',vid,cs.length,dir);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
