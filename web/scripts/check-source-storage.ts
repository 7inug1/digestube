import {saveTranscriptSource} from '../src/lib/transcript-source';
import {db} from '../src/lib/supabase';
async function main(){
 const id='verification';const revision=crypto.randomUUID();const path=`${id}/${revision}.json`;
 try{
  await saveTranscriptSource(id,revision,{lang:'en',content:[{text:'Storage verification.',offset:1230,duration:1500}]} as Parameters<typeof saveTranscriptSource>[2],'en');
  const r=await db().storage.from('transcript-sources').download(path);if(r.error)throw r.error;
  const j=JSON.parse(await r.data.text());if(j.result.content[0].offset!==1230)throw new Error('Timing changed');console.log('Original caption storage round trip passed');
 }finally{const r=await db().storage.from('transcript-sources').remove([path]);if(r.error)throw r.error;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
