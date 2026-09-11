/** Audit deployed data against captured caption sources without changing it.
 * node --experimental-websocket --env-file=.env.local --import tsx scripts/verify-timestamps.ts <source-directory>
 */
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
async function main(){
 const directory=process.argv[2];if(!directory)throw new Error('Source directory required');
 const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const v=await db.from('video').select('id,status,revision').order('id');if(v.error)throw v.error;
 let total=0;
 for(const video of v.data){
  const source=JSON.parse(await readFile(`${directory}/${video.id}-source.json`,'utf8'));
  const before=JSON.parse(await readFile(`${directory}/${video.id}-before.json`,'utf8'));
  const chunks=await db.from('chunk').select('seq,text,t,t_end,embedding').eq('video_id',video.id).order('seq');if(chunks.error)throw chunks.error;
  const titles=await db.from('outline').select('seq,t').eq('video_id',video.id);if(titles.error)throw titles.error;
  const normalize=(text:string)=>text.replace(/\s+/gu,' ').trim();
  assert.equal(normalize(chunks.data.map(c=>c.text).join(' ')),normalize(before.chunks.map((c:{text:string})=>c.text).join(' ')));
  assert.equal(video.status,'완료');assert.equal(chunks.data.length,titles.data.length);
  for(const [i,c] of chunks.data.entries()){
   assert.ok(c.embedding);assert.ok(c.t>=0&&c.t_end>=c.t&&(!i||c.t>=chunks.data[i-1].t));
   assert.ok(source.content.some((p:{offset:number})=>Math.abs(p.offset/1000-c.t)<.011),'Start not anchored to original caption');
   assert.ok(Math.abs(titles.data.find(o=>o.seq===c.seq)!.t-c.t)<.001);
  }
  const stored=await db.storage.from('transcript-sources').download(`${video.id}/${video.revision}.json`);if(stored.error)throw stored.error;
  total+=chunks.data.length;
  console.log(JSON.stringify({id:video.id,paragraphs:chunks.data.length,textPreserved:true,captionAnchored:true,outlineTimesMatch:true,sourceArchived:true}));
 }
 console.log(`VERIFIED ${v.data.length} videos / ${total} paragraphs`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
