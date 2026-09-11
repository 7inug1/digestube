/** Read-only evaluation. Default checks the draft offline; --run requires a frozen, reviewed dataset.
 * node --experimental-websocket --env-file=.env.local --import tsx scripts/run-search-evaluation.ts <dataset> [--run] [--holdout]
 * EVAL_BASE and EVAL_DEPLOYMENT must identify the tested release when running.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {validateDataset,requireReviewed,validateHits,score,summarize,type Dataset,type Row,type ResultHit} from './search-evaluation';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
async function main(){
 if(process.argv.slice(3).some(arg=>!['--run','--holdout'].includes(arg)))throw new Error('알 수 없는 실행 옵션입니다.');
 const path=process.argv[2];if(!path)throw new Error('평가셋 파일 경로가 필요합니다.');
 const raw=await readFile(path,'utf8');const dataset=JSON.parse(raw) as Dataset;validateDataset(dataset);
 const run=process.argv.includes('--run');const split=process.argv.includes('--holdout')?'holdout':'dev';
 if(!run){console.log(JSON.stringify({mode:'offline-check',questions:dataset.questions.length,approved:dataset.questions.filter(q=>q.review_status==='approved').length,status:dataset.status,search_requests:0},null,2));return;}
 const questions=requireReviewed(dataset,split);
 const base=process.env.EVAL_BASE, deployment=process.env.EVAL_DEPLOYMENT;
 if(!base||!deployment)throw new Error('EVAL_BASE와 EVAL_DEPLOYMENT를 지정하세요.');
 const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('인증정보·쿼리 없는 서비스 URL을 사용하세요.');
 const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 async function snapshot(){
  const videos=await db.from('video').select('id,revision,status').order('id');if(videos.error)throw new Error('영상 스냅샷 조회 실패');
  if(JSON.stringify(videos.data.map(v=>v.id).sort())!==JSON.stringify(dataset.corpus.map(v=>v.video_id).sort()))throw new Error('평가셋과 영상 목록이 다릅니다.');
  const out=[];
  for(const v of videos.data){
   const chunks=await db.from('chunk').select('video_id,seq,t,t_end,text,embedding').eq('video_id',v.id).order('seq');if(chunks.error)throw new Error('문단 스냅샷 조회 실패');
   const expected=dataset.corpus.find(c=>c.video_id===v.id)!;
   if(v.revision!==expected.revision||hash(chunks.data.map(c=>c.text).join(' '))!==expected.transcript_sha256||v.status!=='완료'||chunks.data.some(c=>!c.embedding))throw new Error(`평가 데이터가 변경되었거나 미완료: ${v.id}`);
   out.push({video:v,chunks:chunks.data.map(({embedding,...c})=>({...c,embedding_sha256:hash(JSON.stringify(embedding))}))});
  }
  return out;
 }
 const before=await snapshot();
 const folder=`${process.env.EVAL_OUTPUT_DIR ?? "data/evals/search/runs"}/${new Date().toISOString().replace(/[:.]/g,'-')}-${split}`;await mkdir(folder,{recursive:true});
 const records:(Row&{question:string;ms:number;http_status:number|null;hits:ResultHit[];raw_response:string;manual_relevance:'pending'})[]=[];
 const report={protocol_version:"search-time-overlap-v1",started_at:new Date().toISOString(),completed_at:null as string|null,dataset_sha256:hash(raw),dataset,split,top_k:3,base:url.origin,deployment_declared:deployment,model_declared:process.env.EVAL_MODEL??'nlpai-lab/KURE-v1',threshold_declared:process.env.EVAL_THRESHOLD??'none',runner_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runner_dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),corpus:before,corpus_stable:null as boolean|null,records,summary:summarize(records),limitations:['Time overlap is not semantic relevance.','Errors stay in denominators and never count as correct rejections.','Latency includes HTTP and highlighting; no cold/warm claim.','Deployment/model/threshold are caller declarations, not remotely attested.']};
 const save=()=>writeFile(`${folder}/results.json`,JSON.stringify(report,null,2)+'\n');await save();
 for(const q of questions){
  const start=performance.now();let rawResponse='',status:number|null=null,hits:ResultHit[]=[],error:string|null=null;
  try{
   const endpoint=new URL('/api/search',url);endpoint.searchParams.set('q',q.question);endpoint.searchParams.set('k','3');
   const r=await fetch(endpoint,{signal:AbortSignal.timeout(65000)});status=r.status;rawResponse=await r.text();if(!r.ok)throw new Error(`HTTP ${status}`);
   const value:unknown=JSON.parse(rawResponse);validateHits(value);hits=value;
   for(const h of hits){const c=before.find(v=>v.video.id===h.video_id)?.chunks.find(c=>c.seq===h.seq);if(!c||c.text!==h.text||Math.abs(c.t-h.t)>.001||Math.abs(c.t_end-h.t_end)>.001)throw new Error('검색 응답과 데이터 스냅샷 불일치');}
  }catch(e){error=(e as Error).name==='TimeoutError'?'timeout':(e as Error).message;}
  records.push({...score(q,hits,error),question:q.question,ms:Math.round(performance.now()-start),http_status:status,hits,raw_response:rawResponse,manual_relevance:'pending'});report.summary=summarize(records);await save();console.log(q.id,error??'recorded');
 }
 try{report.corpus_stable=hash(JSON.stringify(before))===hash(JSON.stringify(await snapshot()));}catch{report.corpus_stable=false;}
 report.completed_at=new Date().toISOString();await save();
 await writeFile(`${folder}/summary.md`, `# 검색 평가 ${split}\n\n- 데이터 유지: ${report.corpus_stable}\n- 질문 버전: ${dataset.version}\n- 적중: ${report.summary.answer_hit_at_3.numerator}/${report.summary.answer_hit_at_3.denominator}\n- 올바른 거절: ${report.summary.correct_rejection.numerator}/${report.summary.correct_rejection.denominator}\n- 답 있는데 빈 결과: ${report.summary.false_rejection.numerator}/${report.summary.false_rejection.denominator}\n- 오류: ${report.summary.errors}\n\n구간 겹침 자동 채점이며 의미 적합성은 미검토. 데이터 유지가 false이면 비교에 사용하지 않는다. 상세 결과: results.json\n`);
 console.log(folder);if(!report.corpus_stable)throw new Error('실행 중 데이터 변경: 결과 비교 불가');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
