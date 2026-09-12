/** Synthetic data only. A local server imitates both Supabase and search. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('synthetic end-to-end run preserves raw errors, isolates holdout, and detects corpus changes',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'digestube-eval-test-'));
 const paragraph={video_id:'fixture',seq:0,t:10,t_end:20,text:'Synthetic fixture only.',embedding:'[0,1]'};
 const sha=createHash('sha256').update(paragraph.text).digest('hex');
 const common={review_status:'approved',split:'dev',category:'no_answer',targets:[]};
 const dataset={version:'synthetic-test',status:'frozen',scope:'all_corpus',corpus:[{video_id:'fixture',revision:'r1',transcript_sha256:sha}],questions:[
  {...common,id:'yes',question:'yes',category:'answerable',targets:[{video_id:'fixture',start:11,end:15,quote:'fixture'}]},
  {...common,id:'error',question:'error'}, {...common,id:'empty',question:'empty'},
  {...common,id:'malformed',question:'malformed'}, {...common,id:'held',question:'held',split:'holdout'}]};
 const requests:string[]=[];let chunksRead=0,change=false;
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://localhost');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/rest/v1/video')return res.end(JSON.stringify([{id:'fixture',revision:'r1',status:'완료'}]));
  if(url.pathname==='/rest/v1/chunk'){chunksRead++;return res.end(JSON.stringify([{...paragraph,embedding:change&&chunksRead>1?'[1,0]':paragraph.embedding}]))}
  if(url.pathname==='/api/search'){
   const q=url.searchParams.get('q')!;requests.push(q);assert.equal(url.searchParams.get('k'),'3');assert.equal(url.searchParams.has('vid'),false);
   if(q==='error'){res.statusCode=502;return res.end('{"error":"synthetic failure"}')}
   if(q==='malformed')return res.end('{"unexpected":true}');
   return res.end(JSON.stringify(q==='yes'?[{video_id:'fixture',seq:0,t:10,t_end:20,text:paragraph.text,score:.9}]:[]));
  }res.statusCode=404;res.end('{}');
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const file=join(temp,'questions.json');await writeFile(file,JSON.stringify(dataset));
  const args=['--experimental-websocket','--import','tsx',resolve('scripts/run-search-evaluation.ts'),file,'--run'];
  const env={...process.env,SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-only',EVAL_BASE:base,EVAL_DEPLOYMENT:'synthetic-not-production',EVAL_OUTPUT_DIR:join(temp,'runs')};
  await exec(process.execPath,args,{env});
  assert.deepEqual(requests,['yes','error','empty','malformed']);
  const folder=join(temp,'runs',(await readdir(join(temp,'runs')))[0]);
  const report=JSON.parse(await readFile(join(folder,'results.json'),'utf8'));
  assert.equal(report.corpus_stable,true);assert.equal(report.records.length,4);
  assert.equal(report.records[1].raw_response,'{"error":"synthetic failure"}');
  assert.equal(report.summary.correct_rejection.numerator,1);assert.equal(report.summary.correct_rejection.denominator,3);assert.equal(report.summary.errors,2);
  assert.match(await readFile(join(folder,'summary.md'),'utf8'),/\n\n- 데이터 유지: true\n/);
  requests.length=0;await writeFile(file,JSON.stringify({...dataset,status:'pending_human_review'}));
  await assert.rejects(exec(process.execPath,args,{env}),/검수/);assert.deepEqual(requests,[]);
  await writeFile(file,JSON.stringify(dataset));chunksRead=0;change=true;
  await assert.rejects(exec(process.execPath,args,{env}),/데이터 변경/);
  const folders=await readdir(join(temp,'runs'));assert.equal(folders.length,2);
  const reports=await Promise.all(folders.map(f=>readFile(join(temp,'runs',f,'results.json'),'utf8').then(JSON.parse)));
  assert.ok(reports.some(r=>r.corpus_stable===false));
 }finally{await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()));await rm(temp,{recursive:true,force:true});}
});
