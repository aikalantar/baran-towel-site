import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {LocalRepository} from '../scripts/cms-local.mjs';

async function fixture(){
 const folder=path.resolve('.cms-local/task6-qa');await fs.mkdir(folder,{recursive:true});const root=await fs.mkdtemp(path.join(folder,'local-failure-'));
 await fs.mkdir(path.join(root,'public/page'),{recursive:true});await fs.writeFile(path.join(root,'public/page/index.html'),'<h1>Initial</h1>');await fs.writeFile(path.join(root,'public/second.txt'),'initial second');
 const repo=new LocalRepository(root);await repo.commit(await repo.head(),[{path:'public/page/index.html',content:'<h1>Preserved checkpoint</h1>'}],'fixture checkpoint');return {repo,root};
}
test('a partial history-index write cannot corrupt existing history or publish partial content',async()=>{
 const {repo,root}=await fixture(),index=path.join(root,'.cms-local/local-revisions/index.json'),beforeIndex=await fs.readFile(index,'utf8'),beforeHTML=(await repo.read('public/page/index.html')).content,beforeSecond=(await repo.read('public/second.txt')).content;
 const write=fs.writeFile,head=await repo.head();let failed=false;
 fs.writeFile=async function(file,content,...options){if(!failed&&String(file).includes('index.json')){failed=true;await write.call(fs,file,'[',...options);throw new Error('fixture disk-full index interruption');}return write.call(fs,file,content,...options);};
 try{await assert.rejects(()=>repo.commit(head,[{path:'public/page/index.html',content:'<h1>Uncommitted</h1>'},{path:'public/second.txt',content:'uncommitted second'}]),/disk-full/);}finally{fs.writeFile=write;}
 assert.equal(failed,true);assert.equal(await fs.readFile(index,'utf8'),beforeIndex);assert.equal((await repo.read('public/page/index.html')).content,beforeHTML);assert.equal((await repo.read('public/second.txt')).content,beforeSecond);
 assert.deepEqual(await repo.history('public/page/index.html'),JSON.parse(beforeIndex).map(({sha,date,message})=>({sha,date,message})));assert.equal(repo.busy,false);
});
test('failed public rename rolls back earlier files and removes temporary public assets',async()=>{
 const {repo}=await fixture(),before=(await repo.read('public/page/index.html')).content,head=await repo.head(),rename=fs.rename;let failed=false;
 fs.rename=async function(from,to){if(!failed&&String(to).endsWith('second.txt')){failed=true;throw new Error('fixture file busy');}return rename.call(fs,from,to);};
 try{await assert.rejects(()=>repo.commit(head,[{path:'public/page/index.html',content:'<h1>Uncommitted</h1>'},{path:'public/second.txt',content:'uncommitted'}]),/file busy/);}finally{fs.rename=rename;}
 assert.equal((await repo.read('public/page/index.html')).content,before);assert.equal((await repo.read('public/second.txt')).content,'initial second');assert.equal((await repo.tree()).some(item=>item.path.endsWith('.tmp')),false);assert.equal(repo.busy,false);
 await repo.commit(await repo.head(),[{path:'public/second.txt',content:'successful retry'}]);assert.equal((await repo.read('public/second.txt')).content,'successful retry');
});
