/** Compare completed runs offline. Never changes thresholds or calls search. */
import {readFile} from 'node:fs/promises';
import {summarize,type Row} from './search-evaluation';
import {basename} from 'node:path';
export type Report={protocol_version:string;dataset_sha256:string;split:string;top_k:number;corpus_stable:boolean;completed_at:string|null;records:Row[];corpus:{video:{id:string};chunks:{video_id:string;seq:number;t:number;t_end:number;text:string}[]}[]};
export function compare(a:Report,b:Report){
 if(!a.completed_at||!b.completed_at||a.corpus_stable!==true||b.corpus_stable!==true)throw new Error('완료되고 데이터가 유지된 실행만 비교할 수 있습니다.');
 for(const key of ['protocol_version','dataset_sha256','split','top_k'] as const)if(!a[key]||a[key]!==b[key])throw new Error(`비교 조건이 다릅니다: ${key}`);
 const corpus=(r:Report)=>JSON.stringify(r.corpus.map(v=>({id:v.video.id,chunks:v.chunks.map(c=>({video_id:c.video_id,seq:c.seq,t:c.t,t_end:c.t_end,text:c.text}))})));
 if(corpus(a)!==corpus(b))throw new Error('본문 또는 문단 경계가 다릅니다. 청킹 비교는 별도 기준이 필요합니다.');
 if(new Set(a.records.map(r=>r.id)).size!==a.records.length||new Set(b.records.map(r=>r.id)).size!==b.records.length)throw new Error('중복 결과가 있습니다.');
 if(JSON.stringify(a.records.map(r=>[r.id,r.category]))!==JSON.stringify(b.records.map(r=>[r.id,r.category])))throw new Error('평가 문항이 다릅니다.');
 const state=(r:Row)=>r.error?'오류':r.hit||r.correct_rejection?'성공':r.false_rejection?'과잉 거절':'실패';
 return {before:summarize(a.records),after:summarize(b.records),changes:a.records.flatMap((r,i)=>state(r)===state(b.records[i])?[]:[{id:r.id,before:state(r),after:state(b.records[i])}])};
}
async function main(){
 const [one,two]=process.argv.slice(2);if(!one||!two)throw new Error('비교할 results.json 두 개를 지정하세요.');
 const result=compare(JSON.parse(await readFile(one,'utf8')),JSON.parse(await readFile(two,'utf8')));console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&basename(process.argv[1])==='compare-search-evaluations.ts')main().catch(e=>{console.error(e.message);process.exitCode=1;});
