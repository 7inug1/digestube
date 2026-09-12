/** Offline validation and scoring; never calls a model or the search API. */
export type Question = {id:string;question:string;category:'answerable'|'no_answer';split:'dev'|'holdout';review_status:string;targets:{video_id:string;start:number;end:number;quote:string}[]};
export type Dataset = {version:string;status:string;scope:string;corpus:{video_id:string;revision:string;transcript_sha256:string}[];questions:Question[]};
export type ResultHit = {video_id:string;seq:number;t:number;t_end:number;text:string;score:number};
export type Row = {id:string;category:Question['category'];error:string|null;hit:boolean;correct_rejection:boolean;false_rejection:boolean};
export function validateDataset(d:Dataset){
 if(!d.version || d.scope!=='all_corpus' || !Array.isArray(d.questions) || !d.questions.length || !Array.isArray(d.corpus) || !d.corpus.length)throw new Error('평가셋 형식 오류');
 const videos=new Set(d.corpus.map(v=>v.video_id));if(videos.size!==d.corpus.length)throw new Error('영상 ID 중복');
 const ids=new Set<string>();
 for(const q of d.questions){
  if(!q.id||ids.has(q.id)||!q.question?.trim()||!['dev','holdout'].includes(q.split)||!['answerable','no_answer'].includes(q.category))throw new Error('문항 ID·질문·유형 오류');ids.add(q.id);
  if(!Array.isArray(q.targets)||(q.category==='answerable'?q.targets.length===0:q.targets.length!==0))throw new Error(`${q.id}: 정답 구간 오류`);
  for(const t of q.targets)if(!videos.has(t.video_id)||!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end<=t.start||!t.quote?.trim())throw new Error(`${q.id}: 정답 시각·근거 오류`);
 }
}
export function requireReviewed(d:Dataset,split:'dev'|'holdout'){
 validateDataset(d);
 if(d.status!=='frozen' || d.questions.some(q=>q.review_status!=='approved'))throw new Error('사용자 검수와 질문 버전 고정이 끝나지 않았습니다. 검색을 실행하지 않습니다.');
 const questions=d.questions.filter(q=>q.split===split);if(!questions.length)throw new Error('선택한 문항이 없습니다.');return questions;
}
export function validateHits(value:unknown):asserts value is ResultHit[]{
 if(!Array.isArray(value)||value.length>3)throw new Error('검색 응답은 상위 3개 이내 배열이어야 합니다.');
 const ids=new Set<string>();
 for(const h of value){
  if(!h||typeof h.video_id!=='string'||!Number.isInteger(h.seq)||typeof h.text!=='string'||![h.t,h.t_end,h.score].every(Number.isFinite)||h.t<0||h.t_end<=h.t)throw new Error('검색 결과 필드 오류');
  const id=`${h.video_id}:${h.seq}`;if(ids.has(id))throw new Error('검색 결과 중복');ids.add(id);
 }
}
export function score(q:Question,hits:ResultHit[],error:string|null=null):Row{
 if(error)return {id:q.id,category:q.category,error,hit:false,correct_rejection:false,false_rejection:false};
 validateHits(hits);
 return {id:q.id,category:q.category,error:null,
  hit:q.category==='answerable'&&hits.some(h=>q.targets.some(t=>h.video_id===t.video_id&&h.t<t.end&&h.t_end>t.start)),
  correct_rejection:q.category==='no_answer'&&hits.length===0,
  false_rejection:q.category==='answerable'&&hits.length===0};
}
export function summarize(rows:Row[]){
 const a=rows.filter(r=>r.category==='answerable'),n=rows.filter(r=>r.category==='no_answer');
 const fraction=(numerator:number,denominator:number)=>({numerator,denominator,rate:denominator?numerator/denominator:null});
 return {answer_hit_at_3:fraction(a.filter(r=>r.hit).length,a.length),correct_rejection:fraction(n.filter(r=>r.correct_rejection).length,n.length),false_rejection:fraction(a.filter(r=>r.false_rejection).length,a.length),errors:rows.filter(r=>r.error).length};
}
