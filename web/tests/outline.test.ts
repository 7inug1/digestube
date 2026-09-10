import test from "node:test";
import assert from "node:assert/strict";
import {label, fallbackTitle} from "../src/lib/outline";
import {prepareTranscript} from "../src/lib/transcript";

const c={seq:3,t:42,text:"잠은 기억을 강화합니다. 충분한 수면이 필요합니다."};
test("a changed quote is retried and a valid second title is retained",async()=>{
  let calls=0;
  const result=await label(c,async()=>++calls===1 ? {label:"기억과 수면",quote:"잠은 기억을 지웁니다."} : {label:"잠이 기억을 강화하는 이유",quote:"잠은 기억을 강화합니다."});
  assert.equal(calls,2); assert.equal(result.source,"model"); assert.equal(result.attempts,2);
  assert.equal(result.failure,"quote_mismatch"); assert.equal(result.seq,3);
});
test("repeated request failure preserves the navigation anchor without a fake quote",async()=>{
  const result=await label(c,async()=>{throw new Error("503");});
  assert.equal(result.source,"fallback"); assert.equal(result.label,"잠은 기억을 강화합니다.");
  assert.equal(result.quote,""); assert.equal(result.t,42); assert.equal(result.attempts,2);
});
test("overlong titles are retried then truncated source uses at most 25 code points",async()=>{
  const text="이 문장은 목차 길이 제한보다 훨씬 길어서 전체를 제목으로 보여줄 수 없는 첫 문장입니다. 둘째 문장.";
  const result=await label({...c,text},async()=>({label:"가".repeat(26),quote:text}));
  assert.equal(result.source,"fallback"); assert.ok(Array.from(result.label).length<=25);assert.ok(result.label.endsWith("…"));
  assert.equal(fallbackTitle("짧은 첫 문장. 다음 문장."),"짧은 첫 문장.");
  assert.equal(Array.from(fallbackTitle("😀".repeat(30))).length,25);
});
test("unusable native input is rejected before replacing old content",()=>{
  assert.throws(()=>prepareTranscript({lang:"en",content:[]},"ko"),/언어/);
  assert.throws(()=>prepareTranscript({lang:"ko",content:"텍스트만 있음"},"ko"),/시간 정보/);
  assert.throws(()=>prepareTranscript({lang:"ko",content:[{text:" ",offset:0,duration:1}]},"ko"),/비어/);
  assert.throws(()=>prepareTranscript({lang:"ko",content:[{text:"문장",offset:-1,duration:1}]},"ko"),/시간 정보/);
  const p=prepareTranscript({lang:"ko",content:[{text:c.text,offset:42000,duration:4000}]},"ko");
  assert.equal(p.chunks[0].t,42);assert.equal(p.chunks[0].text,c.text);
});
