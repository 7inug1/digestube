/** Explore score thresholds on an already-recorded development run.
 * This does not select or apply a threshold and never calls the search API.
 */
import {readFile} from "node:fs/promises";

type Target={video_id:string;start:number;end:number};
type Hit={video_id:string;t:number;t_end:number;score:number};
type Record={id:string;category:"answerable"|"no_answer";hits:Hit[]};
type Report={dataset:{questions:{id:string;targets:Target[]}[]};records:Record[]};

async function main(){
const path=process.argv[2];
if(!path)throw new Error("results.json 경로가 필요합니다.");
const report=JSON.parse(await readFile(path,"utf8")) as Report;
const questions=new Map(report.dataset.questions.map(q=>[q.id,q]));
const relevant=(record:Record,hit:Hit)=>questions.get(record.id)?.targets.some(
  target=>hit.video_id===target.video_id&&hit.t<target.end&&hit.t_end>target.start,
)??false;

const boundaries=[0,...new Set(report.records.flatMap(r=>r.hits.map(h=>h.score+0.000001)))].sort((a,b)=>a-b);
const rows=boundaries.map(threshold=>{
  let answerHits=0,answerTotal=0,rejections=0,noAnswerTotal=0;
  for(const record of report.records){
    const kept=record.hits.filter(hit=>hit.score>=threshold);
    if(record.category==="answerable"){
      answerTotal++;
      if(kept.some(hit=>relevant(record,hit)))answerHits++;
    }else{
      noAnswerTotal++;
      if(!kept.length)rejections++;
    }
  }
  return {threshold:Number(threshold.toFixed(6)),answerHits,answerTotal,rejections,noAnswerTotal,totalCorrect:answerHits+rejections};
});
const best=Math.max(...rows.map(r=>r.totalCorrect));
console.log(JSON.stringify({bestTotal:best,rows:rows.filter(r=>r.totalCorrect===best)},null,2));
}
main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
