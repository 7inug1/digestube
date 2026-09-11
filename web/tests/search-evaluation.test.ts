import test from 'node:test';
import assert from 'node:assert/strict';
import {score,summarize,requireReviewed,validateHits,type Question,type ResultHit,type Dataset} from '../scripts/search-evaluation';
const q:Question={id:'q',question:'example',category:'answerable',split:'dev',review_status:'approved',targets:[{video_id:'a',start:10,end:20,quote:'evidence'}]};
const hit:ResultHit={video_id:'a',seq:0,t:12,t_end:18,text:'evidence',score:.8};
test('requires the right video and actual overlap, accepts alternate targets',()=>{
 assert.equal(score(q,[hit]).hit,true);
 assert.equal(score(q,[{...hit,video_id:'b'}]).hit,false);
 assert.equal(score(q,[{...hit,t:20,t_end:25}]).hit,false);
 assert.equal(score({...q,targets:[...q.targets,{video_id:'b',start:10,end:20,quote:'alternative'}]},[{...hit,video_id:'b'}]).hit,true);
});
test('API errors never count as correct rejection and retain denominators',()=>{
 const none:Question={...q,category:'no_answer',targets:[]};
 const report=summarize([score(none,[],'HTTP 502'),score(none,[]),score(q,[])]);
 assert.deepEqual(report.correct_rejection,{numerator:1,denominator:2,rate:.5});assert.equal(report.errors,1);assert.equal(report.false_rejection.numerator,1);
});
test('unreviewed data cannot run; holdout is excluded by default selection',()=>{
 const d:Dataset={version:'v1',status:'frozen',scope:'all_corpus',corpus:[{video_id:'a',revision:'r',transcript_sha256:'hash'}],questions:[q,{...q,id:'h',split:'holdout'}]};
 assert.deepEqual(requireReviewed(d,'dev').map(q=>q.id),['q']);
 assert.throws(()=>requireReviewed({...d,status:'pending_human_review'},'dev'));
 assert.throws(()=>requireReviewed({...d,questions:[{...q,review_status:'pending'}]},'dev'));
});
test('malformed API responses are errors, not empty results',()=>{
 assert.throws(()=>validateHits({error:'failed'}));assert.throws(()=>validateHits([{...hit,score:NaN}]));assert.throws(()=>validateHits([hit,hit]));
 assert.equal(summarize([]).answer_hit_at_3.rate,null);
});
