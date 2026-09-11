import {createClient} from '@supabase/supabase-js';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:videos,error}=await db.from('video').select('*').order('id');if(error)throw error;
const dir=process.argv[2] ?? `data/repairs/timing-${Date.now()}`;await mkdir(dir,{recursive:true});
for(const video of videos){
 const {data:chunks,error}=await db.from('chunk').select('*').eq('video_id',video.id).order('seq');if(error)throw error;
 const o=await db.from('outline').select('*').eq('video_id',video.id).order('seq');if(o.error)throw o.error;
 try { await writeFile(`${dir}/${video.id}-before.json`,JSON.stringify({video,chunks,outline:o.data}),{flag:'wx'}); } catch(e) { if(e.code!=='EEXIST')throw e; }
 try{await readFile(`${dir}/${video.id}-source.json`);console.log(video.id,'cached');continue;}catch{}
 const url=new URL('https://api.supadata.ai/v1/transcript');url.search=new URLSearchParams({url:`https://youtu.be/${video.id}`,mode:'native',lang:video.lang});
 let result;
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(url,{headers:{'x-api-key':process.env.SUPADATA_API_KEY.trim()},signal:AbortSignal.timeout(45000)});
  if(r.status===429){await new Promise(r=>setTimeout(r,15000));continue;}
  if(!r.ok)throw new Error(`${video.id} Supadata status ${r.status}`);
  result=await r.json();break;
 }
 if(!result||!Array.isArray(result.content)||result.lang!==video.lang)throw new Error(`${video.id} unusable timing source`);
 await writeFile(`${dir}/${video.id}-source.json`,JSON.stringify({mode:'native',requested_lang:video.lang,...result}));
 console.log(video.id,result.lang,result.content.length,'timed captions');
 await new Promise(r=>setTimeout(r,3000));
}
