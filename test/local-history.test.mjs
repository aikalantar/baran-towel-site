import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {startLocal} from '../scripts/cms-local.mjs';
import {History,clone,encodeDraft,decodeDraft} from '../public/admin/builder/model.js';

test('real local publication history survives server restart and restores a 64-character revision safely', {timeout:90000}, async t=>{
 const folder=path.resolve('.cms-local/task5-qa');await fs.mkdir(folder,{recursive:true});
 const sandbox=await fs.mkdtemp(path.join(folder,'local-history-'));
 await fs.cp('public',path.join(sandbox,'public'),{recursive:true});
 const sourceHome=await fs.readFile('public/index.html'),sourceSitemap=await fs.readFile('public/sitemap.xml');
 let server=await startLocal(sandbox,0),origin=`http://127.0.0.1:${server.address().port}`;
 const route='/api/cms/builder?path=public%2Findex.html',historyRoute='/api/cms/history?path=public%2Findex.html';
 const get=async endpoint=>{const response=await fetch(origin+endpoint);assert.equal(response.status,200);return response.json();};
 const post=async body=>{const response=await fetch(origin+'/api/cms/builder/publish',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CMS-Request':'1'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const live=()=>fs.readFile(path.join(sandbox,'public/index.html'),'utf8');
 try{
  const initial=await get(route),firstModel=clone(initial.model),target=firstModel.elements.find(e=>e.type==='heading'&&e.tag==='h1');
  assert.ok(target);const firstText='نسخه اول تاریخچهٔ محلی',secondText='نسخه دوم تاریخچهٔ محلی';target.content.text=firstText;
  const firstPayload={model:firstModel,requestId:crypto.randomUUID()},first=await post(firstPayload);
  assert.equal(first.status,200);assert.equal(first.data.mode,'local');assert.match(first.data.sha,/^[a-f0-9]{64}$/);assert.equal(first.data.publication.deployment,'not_applicable');
  const firstHTML=await live();assert.equal(parseHTML(firstHTML).document.querySelector('h1').textContent,firstText);
  const replay=await post(firstPayload);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.sha,first.data.sha);assert.equal(await live(),firstHTML);assert.equal((await get(historyRoute)).entries.filter(e=>e.sha===first.data.sha).length,1);
  const changedPayload=clone(firstPayload);changedPayload.model.elements.find(e=>e.id===target.id).content.text='محتوای متفاوت با شناسهٔ درخواست قبلی';
  assert.equal((await post(changedPayload)).status,409);assert.equal(await live(),firstHTML);
  const secondBase=await get(route),secondModel=clone(secondBase.model);secondModel.elements.find(e=>e.id===target.id).content.text=secondText;
  const second=await post({model:secondModel,requestId:crypto.randomUUID()});assert.equal(second.status,200);assert.match(second.data.sha,/^[a-f0-9]{64}$/);assert.notEqual(second.data.sha,first.data.sha);assert.equal(parseHTML(await live()).document.querySelector('h1').textContent,secondText);
  const snapshot=await fs.readFile(path.join(sandbox,'.cms-local','local-revisions',first.data.sha,'public/index.html'),'utf8');assert.equal(snapshot,firstHTML);
  await new Promise(resolve=>server.close(resolve));server=await startLocal(sandbox,0);origin=`http://127.0.0.1:${server.address().port}`;
  const history=await get(historyRoute);assert.ok(history.entries.some(e=>e.sha===first.data.sha));assert.ok(history.entries.some(e=>e.sha===second.data.sha));
  const current=await get(route),restore=await get(route+'&ref='+first.data.sha);assert.equal(restore.model.base.restoreCommit,first.data.sha);assert.equal(restore.model.base.revision,current.model.base.revision);assert.equal(restore.model.elements.find(e=>e.id===target.id).content.text,firstText);assert.equal(parseHTML(await live()).document.querySelector('h1').textContent,secondText);
  const draft=new History(restore.model),edited=clone(restore.model);edited.elements.find(e=>e.id===target.id).style.color='#112233';draft.commit(edited);draft.undo();
  const raw=encodeDraft(draft),recovered=decodeDraft(raw,restore.model,restore.anchors);assert.equal(recovered.present.base.restoreCommit,first.data.sha);assert.equal(recovered.future.length,1);assert.ok(recovered.redo());assert.ok(recovered.undo());
  const restorePayload={model:clone(recovered.present),requestId:crypto.randomUUID()},restored=await post(restorePayload);assert.equal(restored.status,200);assert.match(restored.data.sha,/^[a-f0-9]{64}$/);assert.equal(parseHTML(await live()).document.querySelector('h1').textContent,firstText);
  const restoredHTML=await live(),restoredHistory=await get(historyRoute);assert.ok(restoredHistory.entries.some(e=>e.sha===restored.data.sha));
  assert.equal((await post({...restorePayload,requestId:crypto.randomUUID()})).status,409,'Stale restoration must not overwrite a newer receipt/revision');assert.equal(await live(),restoredHTML);
  const restoreReplay=await post(restorePayload);assert.equal(restoreReplay.status,200);assert.equal(restoreReplay.data.replayed,true);assert.equal(await live(),restoredHTML);assert.deepEqual((await get(historyRoute)).entries,restoredHistory.entries);
  const missing=await fetch(origin+route+'&ref='+'f'.repeat(64));assert.equal(missing.status,404);assert.equal(await live(),restoredHTML);
  assert.ok((await fs.readFile('public/index.html')).equals(sourceHome));assert.ok((await fs.readFile('public/sitemap.xml')).equals(sourceSitemap));
  t.diagnostic('3 isolated local publications; real API/repository snapshots, restart, draft undo/redo, CAS and idempotent recovery; no Git or network publication');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
