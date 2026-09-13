/** Sonnet으로 고정한 큰 주제 중 360자 초과 구간의 세부 문단을 Haiku/Gemini로 비교한다. */
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {chunk, type Piece} from "../src/lib/chunker";

const SOURCE="data/evals/chunking/dialogue-source.json", BASE="data/evals/chunking/topic-dialogue";
const OUT="data/evals/chunking/topic-readable-candidates";
const sec=(v:string)=>v.split(":").reduce((n,x)=>n*60+Number(x),0);
const source=JSON.parse(readFileSync(SOURCE,"utf8")) as {segments:{start:string;end:string;text:string}[]};
const pieces:Piece[]=source.segments.map(s=>({text:s.text,offset:sec(s.start)*1000,duration:(sec(s.end)-sec(s.start))*1000}));
const baseDir=`${BASE}/${readdirSync(BASE).sort().at(-1)}`;
const base=JSON.parse(readFileSync(`${baseDir}/sonnet.json`,"utf8")) as {starts:number[];chunks:{text:string}[]};
const heads=base.starts[0]===1?base.starts:[1,...base.starts];
const groups=heads.flatMap((start,i)=>base.chunks[i].text.length>360?[{topic:i+1,start,end:heads[i+1]??pieces.length+1}]:[]);
const lines=groups.map(g=>`주제 ${g.topic}\n`+pieces.slice(g.start-1,g.end-1).map((p,j)=>`${g.start+j}\t${p.text}`).join("\n")).join("\n\n");
const prompt=`아래는 이미 주제별로 나눈 전사문 중 긴 구간들이다. 큰 주제 경계는 바꾸지 말고 각 구간 안에서 읽기 좋은 세부 문단의 시작 번호를 골라라.

- 각 주제의 첫 번호는 반드시 포함한다.
- 한 문단은 280~360자 정도를 권장하지만 정확한 글자 수보다 의미가 자연스럽게 완결되는 위치를 우선한다.
- 설명과 바로 이어지는 사례는 묶는다. 예시 하나마다 기계적으로 나누지 않는다.
- 설명의 초점이 바뀌는 긴 구간은 2~3개 문단으로 나눈다.
- 미완성 문장, 짧은 맞장구, 화자 변경만으로 나누지 않는다.
- 번호만 JSON으로 반환한다: {"topics":[{"topic":3,"starts":[12,20]}]}

${lines}`;

type Result={raw:string;usage:Record<string,number|undefined>;config:Record<string,unknown>};
async function anthropic():Promise<Result>{
  const key=process.env.ANTHROPIC_API_KEY;if(!key)throw new Error("ANTHROPIC_API_KEY가 없다");
  const config={model:"claude-haiku-4-5-20251001",max_tokens:16000,temperature:0};
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({...config,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(240000)});
  const body=await r.text();if(!r.ok)throw new Error(`${r.status}: ${body.slice(0,300)}`);
  const d=JSON.parse(body) as {content:{type:string;text?:string}[];stop_reason:string;usage?:{input_tokens:number;output_tokens:number}};
  if(d.stop_reason!=="end_turn")throw new Error(`응답 미완료: ${d.stop_reason}`);
  return {raw:d.content.filter(x=>x.type==="text").map(x=>x.text??"").join(""),usage:{input:d.usage?.input_tokens,output:d.usage?.output_tokens},config};
}
async function gemini():Promise<Result>{
  const key=process.env.GEMINI_API_KEY;if(!key)throw new Error("GEMINI_API_KEY가 없다");
  const config={model:"gemini-3.8-flash",maxOutputTokens:16000,temperature:0};
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${key}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:config.maxOutputTokens,temperature:0}}),signal:AbortSignal.timeout(240000)});
  const body=await r.text();if(!r.ok)throw new Error(`${r.status}: ${body.slice(0,300).replaceAll(key,"***")}`);
  const d=JSON.parse(body) as {candidates?:{content?:{parts?:{text?:string}[]};finishReason?:string}[];usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number}};
  const c=d.candidates?.[0];if(c?.finishReason!=="STOP")throw new Error(`응답 미완료: ${c?.finishReason}`);
  return {raw:c.content?.parts?.map(x=>x.text??"").join("")??"",usage:{input:d.usageMetadata?.promptTokenCount,output:d.usageMetadata?.candidatesTokenCount,thoughts:d.usageMetadata?.thoughtsTokenCount},config};
}
function finish(key:string,provider:string,model:string,result:Result,ms:number){
  const raw=result.raw.replace(/^```(?:json)?\s*/u,"").replace(/\s*```$/u,"");
  const parsed=JSON.parse(raw.slice(raw.indexOf("{"),raw.lastIndexOf("}")+1)) as {topics:{topic:number;starts:number[]}[]};
  const allowed=new Set(groups.flatMap(g=>Array.from({length:g.end-g.start},(_,i)=>g.start+i)));
  const additions=parsed.topics.flatMap(t=>t.starts).filter(n=>!heads.includes(n));
  if(additions.some(n=>!Number.isInteger(n)||!allowed.has(n)))throw new Error("잘못된 경계 번호");
  const starts=[...new Set([...heads,...additions])].sort((a,b)=>a-b);
  const chunks=starts.flatMap((start,i)=>chunk(pieces.slice(start-1,(starts[i+1]??pieces.length+1)-1),700,700));
  const squash=(s:string)=>s.replace(/\s+/gu,"");
  const textPreserved=squash(chunks.map(c=>c.text).join(""))===squash(pieces.map(p=>p.text).join(""));
  if(!textPreserved)throw new Error("원문 보존 실패");
  // 코드가 볼 수 있는 것만 본다: 원문 보존·순서·중복·범위·빈 문단.
  // 경계가 의미상 옳은지는 사람이 본다(notes/27 규칙).
  const problems:string[]=[];
  if(additions.length!==new Set(additions).size)problems.push("같은 번호를 두 번 골랐다");
  if(starts.some((n,i)=>i>0&&n<=starts[i-1]))problems.push("경계 번호 순서가 어긋난다");
  if(starts[0]!==1)problems.push("첫 번호가 1이 아니다");
  if(!heads.every(h=>starts.includes(h)))problems.push("큰 주제 경계가 사라졌다");
  if(chunks.some(c=>!c.text.trim()))problems.push("빈 문단이 있다");
  if(chunks.some(c=>c.text.length>700))problems.push("700자 상한을 넘은 문단이 있다");
  const covered=chunks.map(c=>c.text).join(" ");
  for(const p of pieces){ if(!squash(covered).includes(squash(p.text)))
    {problems.push("원문 조각이 빠졌다");break;} }
  const lengths=chunks.map(c=>c.text.length).sort((a,b)=>a-b);
  return {key,provider,model,config:result.config,prompt,raw:result.raw,usage:result.usage,ms,error:null,starts,chunks,
    checks:{textPreserved,chunkCount:chunks.length,problems,lengths:{min:lengths[0],median:lengths[lengths.length>>1],max:lengths.at(-1)}}};
}
async function main(){
  const dir=`${OUT}/${new Date().toISOString().replaceAll(":","-")}-byVgbqzYJrs`;mkdirSync(dir,{recursive:true});
  // 한 후보만 다시 돌릴 때: node ... compare-readable-models.ts gemini
  const only=process.argv[2];
  const all=[{key:"haiku",provider:"anthropic",model:"claude-haiku-4-5-20251001",ask:anthropic},{key:"gemini",provider:"gemini",model:"gemini-3.8-flash",ask:gemini}];
  for(const c of (only?all.filter(x=>x.key===only):all)){
    const t=Date.now();try{const row=finish(c.key,c.provider,c.model,await c.ask(),Date.now()-t);writeFileSync(`${dir}/${c.key}.json`,JSON.stringify(row,null,2));console.log(`${c.key}: ${row.checks.chunkCount}문단 · ${row.ms}ms`);}catch(e){const row={key:c.key,provider:c.provider,model:c.model,prompt,ms:Date.now()-t,error:(e as Error).message,chunks:null,starts:null,checks:null};writeFileSync(`${dir}/${c.key}.json`,JSON.stringify(row,null,2));console.log(`${c.key}: 실패 · ${row.error}`);}
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
