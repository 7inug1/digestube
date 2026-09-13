/** 이미 만든 주제 구간 중 긴 구간만 Sonnet이 맥락에 따라 세부 문단으로 나눈다.
 * node --env-file=.env.local --import tsx scripts/refine-long-topic-chunks.ts
 */
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {chunk, type Piece} from "../src/lib/chunker";

const SOURCE = "data/evals/chunking/dialogue-source.json";
const BASE = "data/evals/chunking/topic-dialogue";
const OUT = "data/evals/chunking/topic-readable";
const MODEL = "claude-sonnet-5";
const seconds = (v: string) => v.split(":").reduce((n, x) => n * 60 + Number(x), 0);
const source = JSON.parse(readFileSync(SOURCE, "utf8")) as {segments:{start:string;end:string;text:string}[]};
const pieces: Piece[] = source.segments.map(s => ({text:s.text, offset:seconds(s.start)*1000,
  duration:(seconds(s.end)-seconds(s.start))*1000}));
const baseDir = `${BASE}/${readdirSync(BASE).sort().at(-1)}`;
const base = JSON.parse(readFileSync(`${baseDir}/sonnet.json`, "utf8")) as {starts:number[];chunks:{text:string}[]};
const heads = base.starts[0] === 1 ? base.starts : [1, ...base.starts];
const long = heads.flatMap((start, i) => base.chunks[i].text.length > 360 ? [{i,start,end:heads[i+1] ?? pieces.length+1}] : []);
const lines = long.map(g => `주제 ${g.i+1}\n` + pieces.slice(g.start-1,g.end-1)
  .map((p,j)=>`${g.start+j}\t${p.text}`).join("\n")).join("\n\n");
const prompt = `아래는 이미 주제별로 나눈 전사문 중 긴 구간들이다. 큰 주제 경계는 바꾸지 말고 각 구간 안에서 읽기 좋은 세부 문단의 시작 번호를 골라라.

- 각 주제의 첫 번호는 반드시 포함한다.
- 한 문단은 280~360자 정도를 권장하지만 정확한 글자 수보다 의미가 자연스럽게 완결되는 위치를 우선한다.
- 설명과 바로 이어지는 사례는 묶는다. 예시 하나마다 기계적으로 나누지 않는다.
- 설명의 초점이 바뀌는 긴 구간은 2~3개 문단으로 나눈다.
- 미완성 문장, 짧은 맞장구, 화자 변경만으로 나누지 않는다.
- 번호만 JSON으로 반환한다: {"topics":[{"topic":3,"starts":[12,20]}]}

${lines}`;

async function main() {
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY가 없다");
const started = Date.now();
const response = await fetch("https://api.anthropic.com/v1/messages", {method:"POST",
  headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},
  body:JSON.stringify({model:MODEL,max_tokens:16000,messages:[{role:"user",content:prompt}]}),
  signal:AbortSignal.timeout(240000)});
const body = await response.text();
if (!response.ok) throw new Error(`${response.status}: ${body.slice(0,300)}`);
const api = JSON.parse(body) as {content:{type:string;text?:string}[];stop_reason:string;usage?:{input_tokens:number;output_tokens:number}};
if (api.stop_reason !== "end_turn") throw new Error(`응답 미완료: ${api.stop_reason}`);
const raw = api.content.filter(x=>x.type==="text").map(x=>x.text??"").join("");
const parsed = JSON.parse(raw.slice(raw.indexOf("{"),raw.lastIndexOf("}")+1)) as {topics:{topic:number;starts:number[]}[]};
const additions = parsed.topics.flatMap(t=>t.starts).filter(n=>!heads.includes(n));
const starts = [...new Set([...heads,...additions])].sort((a,b)=>a-b);
if (starts.some(n=>!Number.isInteger(n)||n<1||n>pieces.length)) throw new Error("잘못된 경계 번호");
const chunks = starts.flatMap((start,i)=>chunk(pieces.slice(start-1,(starts[i+1]??pieces.length+1)-1),700,700));
const squash=(s:string)=>s.replace(/\s+/gu,"");
const textPreserved=squash(chunks.map(c=>c.text).join(""))===squash(pieces.map(p=>p.text).join(""));
if (!textPreserved) throw new Error("원문 보존 실패");
const dir=`${OUT}/${new Date().toISOString().replaceAll(":","-")}-byVgbqzYJrs`;
mkdirSync(dir,{recursive:true});
writeFileSync(`${dir}/sonnet.json`,JSON.stringify({key:"sonnet-readable",provider:"anthropic",model:MODEL,
  config:{strategy:"refine only topic chunks over 360 chars",recommendedChars:"280-360",hardMax:700},
  prompt,raw,usage:{input:api.usage?.input_tokens,output:api.usage?.output_tokens},ms:Date.now()-started,
  error:null,starts,chunks,checks:{textPreserved,chunkCount:chunks.length,problems:[],lengths:{
    min:Math.min(...chunks.map(c=>c.text.length)),median:[...chunks].sort((a,b)=>a.text.length-b.text.length)[chunks.length>>1].text.length,
    max:Math.max(...chunks.map(c=>c.text.length))}}},null,2));
console.log(`문단 ${chunks.length}개 · ${Date.now()-started}ms · ${dir}`);
}

main().catch(error => { console.error(error); process.exit(1); });
