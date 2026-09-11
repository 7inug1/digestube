import {readFile,writeFile} from 'node:fs/promises';
import {chunk} from '../src/lib/chunker';
async function main(){
const source=process.argv[2];
const snapshot=JSON.parse(await readFile(source+'/PlawByYfV8k-before.json','utf8'));
const full=snapshot.chunks.map((c:{text:string})=>c.text).join(' ');
const chunks=chunk([{text:full,offset:0,duration:1}]).map((c,seq)=>({...c,seq}));
await writeFile('data/repairs/timing-20260911/planned.json',JSON.stringify(chunks));
for(const c of chunks)console.log(c.seq,c.text.length,c.text.slice(0,35),'...',c.text.slice(-85));

}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
