/** Generate a standalone review page. No network requests or model calls. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const raw=await readFile(new URL('../data/evals/search/questions.draft.json',import.meta.url),'utf8');
const data=JSON.parse(raw);
const template=await readFile(new URL('./templates/search-review.html',import.meta.url),'utf8');
const hash=createHash('sha256').update(raw).digest('hex');
const html=template.replace('__DATASET__',JSON.stringify(data).replaceAll('<','\\u003c')).replace('__HASH__',hash);
await writeFile(new URL('../../notes/search-review.html',import.meta.url),html);
console.log('Created notes/search-review.html');
