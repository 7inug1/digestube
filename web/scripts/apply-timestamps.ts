/** Apply reviewed caption alignment while retaining text, titles and vectors.
 * node --experimental-websocket --env-file=.env.local --import tsx scripts/apply-timestamps.ts <snapshot directory>
 */
import {readFile,writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import assert from "node:assert/strict";

type Plan={seq:number;t:number;t_end:number;safe:boolean};
async function main(){
 const directory=process.argv[2];if(!directory)throw new Error("Snapshot directory required");
 const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const report=JSON.parse(await readFile(`${directory}/alignment.json`,"utf8")) as {vid:string;revision:string|null;plans:Plan[]}[];
 // Reviewed against the captured caption text: old transcripts contain repeated/misordered words.
 // Use the first recoverable phrase's actual caption, never interpolate a speech time.
 const reviewed=new Map([
  ["-Z11mZaJU0w:4","Existing text repeats 'I have a survey'; caption at 52.16 contains its first recoverable start."],
  ["3KtrlNyd1ec:10","Existing 'So you never know' prefix is duplicated; align the remaining 'you want ...' phrase to caption at 165.04."],
 ]);
 for(const item of report){
  const {vid,plans}=item;
  const snapshot=JSON.parse(await readFile(`${directory}/${vid}-before.json`,"utf8"));
  const reference=JSON.parse(await readFile(`${directory}/${vid}-source.json`,"utf8"));
  for(const p of plans){
   if(!p.safe && !reviewed.has(`${vid}:${p.seq}`))throw new Error(`Unreviewed alignment: ${vid}:${p.seq}`);
   assert.ok(p.t>=0 && p.t_end>=p.t);
  }
  assert.ok(plans.every((p,i)=>i===0 || p.t>=plans[i-1].t));
  const old=snapshot.video;
  const current=await db.from("video").select("revision").eq("id",vid).single();
  if(current.error || current.data.revision!==item.revision)throw new Error(`Video changed: ${vid}`);
  const bookmarks=await db.from("bookmark").select("id").in("chunk_id",snapshot.chunks.map((c:{id:string})=>c.id));
  if(bookmarks.error || bookmarks.data.length)throw new Error(`Bookmarks need migration: ${vid}`);
  const token=crypto.randomUUID();
  const archived=await db.storage.from("transcript-sources").upload(`${vid}/${token}.json`,JSON.stringify({kind:"timing-repair",video_id:vid,revision:token,reference,plans,review_notes:Object.fromEntries(reviewed),original_chunks:snapshot.chunks.map((c:{seq:number;text:string;t:number;t_end:number})=>({seq:c.seq,text:c.text,t:c.t,t_end:c.t_end}))}),{contentType:"application/json"});
  if(archived.error)throw new Error(archived.error.message);
  const reservation=await db.rpc("begin_ingest",{p_vid:vid,p_replace:true,p_token:token,p_mode:old.mode,p_lang:old.requested_lang});
  if(reservation.error || reservation.data!=="started")throw new Error(`Could not reserve ${vid}`);
  try{
   const latest=await db.from("video").select("revision").eq("id",vid).single();
   if(latest.error || latest.data.revision!==item.revision)throw new Error(`Concurrent change: ${vid}`);
   const chunks=snapshot.chunks.map((c:{seq:number;text:string})=>{const p=plans.find(p=>p.seq===c.seq);if(!p)throw new Error("Missing time");return {text:c.text,t:p.t,t_end:p.t_end};});
   const saved=await db.rpc("finish_ingest",{p_vid:vid,p_token:token,p_meta:old,p_chunks:chunks});
   if(saved.error || saved.data!==true)throw new Error(saved.error?.message ?? "Stale write");
   const provenance=await db.from("video").update({transcribed_at:old.transcribed_at}).eq("id",vid).eq("revision",token).select("id");
   if(provenance.error || provenance.data.length!==1)throw new Error("Provenance restore failed");
   const vectors=snapshot.chunks.map((c:{seq:number;embedding:string|number[]})=>({seq:c.seq,vector:typeof c.embedding==="string"?JSON.parse(c.embedding):c.embedding}));
   const embedded=await db.rpc("save_embedding_batch",{p_vid:vid,p_revision:token,p_items:vectors});if(embedded.error || embedded.data!==true)throw new Error("Vector restore failed");
   const outlines=snapshot.outline.map((o:{seq:number;label:string;quote:string;source:string;attempts:number|null;failure:string|null})=>({...o,t:plans.find(p=>p.seq===o.seq)!.t}));
   const titles=await db.rpc("save_outline_batch",{p_vid:vid,p_revision:token,p_items:outlines});if(titles.error || titles.data!==true)throw new Error("Outline restore failed");
   const status=await db.rpc("refresh_video_status",{p_vid:vid,p_revision:token});if(status.error || status.data!==true)throw new Error("Status update failed");
  }catch(e){await db.rpc("cancel_ingest",{p_vid:vid,p_token:token});throw e;}
  const checked=await db.from("chunk").select("seq,text,t,t_end,embedding").eq("video_id",vid).order("seq");if(checked.error)throw new Error(checked.error.message);
  assert.deepEqual(checked.data.map(c=>c.text),snapshot.chunks.map((c:{text:string})=>c.text));
  for(const c of checked.data){const p=plans.find(p=>p.seq===c.seq)!;assert.ok(Math.abs(c.t-p.t)<0.001);assert.ok(c.embedding);}
  const checkedOutlines=await db.from("outline").select("seq,t,label,quote").eq("video_id",vid).order("seq");if(checkedOutlines.error)throw new Error(checkedOutlines.error.message);
  assert.deepEqual(checkedOutlines.data.map(o=>[o.label,o.quote]),snapshot.outline.map((o:{label:string;quote:string})=>[o.label,o.quote]));
  assert.ok(checkedOutlines.data.every(o=>Math.abs(o.t-plans.find(p=>p.seq===o.seq)!.t)<0.001));
  await writeFile(`${directory}/${vid}-applied.json`,JSON.stringify({vid,revision:token,plans},null,2));
  console.log("VERIFIED",vid,plans.length,"paragraph and outline timestamps; original text and titles retained");
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
