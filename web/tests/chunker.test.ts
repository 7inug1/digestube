import test from "node:test";
import assert from "node:assert/strict";
import {chunk} from "../src/lib/chunker";
import {prepareTranscript} from "../src/lib/transcript";
import {readFileSync} from "node:fs";

const normalized = (s:string) => s.replace(/\s+/gu," ").trim();
test("sentence endings inside caption fragments prevent the reported mid-sentence cut",()=>{
  const pieces=[
    {text:"I want to make sure that",offset:0,duration:5000},
    {text:"that content is serving you. You can help shape this channel to progress your",offset:5000,duration:10000},
    {text:"career in whatever stage you're in. Thank you and have a good day.",offset:15000,duration:10000},
  ];
  const out=chunk(pieces,65,140);
  assert.equal(normalized(out.map(c=>c.text).join(" ")), normalized(pieces.map(p=>p.text).join(" ")));
  assert.ok(out.every(c=>c.text.endsWith(".")));
  assert.ok(out.some(c=>c.text.includes("progress your career")));
  assert.ok(!out.some(c=>c.text.endsWith("that") || c.text.endsWith("your")));
  assert.equal(out[0].t,0);assert.equal(out[0].t_end,15);
  assert.equal(out.at(-1)?.t_end,25);
});
test("complete sentences inside a single long caption form separate paragraphs",()=>{
  const source="첫 번째 문장은 온전히 둡니다. 두 번째 문장도 온전히 둡니다. 마지막 문장입니다.";
  const out=chunk([{text:source,offset:10000,duration:5000}],25,50);
  assert.ok(out.length>1);assert.ok(out.every(c=>c.text.endsWith(".")));
  assert.equal(out.map(c=>c.text).join(" "),source);
  assert.ok(out.every(c=>c.t===10 && c.t_end===15));
});
test("decimal numbers and closing quotes do not force a cut inside a sentence",()=>{
  const source='가격은 3.14달러입니다. 그는 “정말 좋아요!”라고 말했습니다. 끝입니다.';
  const out=chunk([{text:source,offset:0,duration:1000}],20,60);
  assert.equal(out.map(c=>c.text).join(" "),source);
  assert.ok(out.some(c=>c.text.includes("3.14달러")));
});
test("overlong unpunctuated input prefers word boundaries and preserves every word",()=>{
  const source="alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo";
  const out=chunk([{text:source,offset:0,duration:1000}],15,25);
  assert.ok(out.every(c=>c.text.length<=25));
  assert.equal(out.map(c=>c.text).join(" "),source);
});
test("an overlong Korean run is bounded without losing characters",()=>{
  const source="가나다라마바사".repeat(20);
  const out=chunk([{text:source,offset:0,duration:1000}],30,50);
  assert.ok(out.every(c=>c.text.length<=50));assert.equal(out.map(c=>c.text).join(""),source);
  assert.deepEqual(chunk([{text:" ",offset:0,duration:1}]),[]);
});

test("real native line wraps are not treated as sentence endings",()=>{
  const source=JSON.parse(readFileSync("tests/fixtures/chunking-native.json","utf8"));
  const out=chunk(source.content);
  assert.ok(out.slice(0,-1).every(c=>/[.!?]$/.test(c.text)));
  assert.equal(normalized(out.map(c=>c.text).join(" ")),normalized(source.content.map((p:{text:string})=>p.text).join(" ")));
});
test("reported video's stored transcript keeps every word and ends each paragraph at a sentence",()=>{
  const source=JSON.parse(readFileSync("tests/fixtures/chunking-existing.json","utf8"));
  const out=chunk(source.content);
  assert.equal(normalized(out.map(c=>c.text).join(" ")),normalized(source.content.map((p:{text:string})=>p.text).join(" ")));
  assert.ok(out.every(c=>/[.!?]$/.test(c.text)));
  assert.ok(out.some(c=>c.text.includes("progress your career")));
  assert.ok(out.at(-1)?.text.endsWith("have a good day."));
});

test("new ingestion uses the sentence-aware chunker without a separate repair step",()=>{
  const source=JSON.parse(readFileSync("tests/fixtures/chunking-native.json","utf8"));
  const prepared=prepareTranscript(source,"en");
  assert.deepEqual(prepared.chunks,chunk(source.content));
  assert.ok(prepared.chunks.slice(0,-1).every(c=>/[.!?]$/.test(c.text)));
  assert.ok(prepared.chunks.some(c=>c.text.includes("progress your career")));
});
