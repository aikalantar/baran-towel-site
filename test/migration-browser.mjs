import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startLocal} from '../scripts/cms-local.mjs';
import {decodeDraft} from '../public/admin/builder/model.js';
import {realPages,oldBuilder,v1} from './migration-fixtures.mjs';

const folder=path.resolve('.cms-local/task6-qa');await fs.mkdir(folder,{recursive:true});
const sandbox=await fs.mkdtemp(path.join(folder,'migration-'));await fs.cp('public',path.join(sandbox,'public'),{recursive:true});
const original=await fs.readFile('public/index.html'),server=await startLocal(sandbox,0),origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1680,height:1050}}),page=await context.newPage();page.setDefaultTimeout(20000);
const results=[],errors=[],ok=name=>{results.push(name);console.log('PASS '+name);};page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){
  const request=put.call(this,value,key);
  if((sessionStorage.getItem('test-abort-archive')==='1'&&String(key).startsWith('archive:'))||(sessionStorage.getItem('test-abort-draft')==='1'&&key==='local:public/index.html'))this.transaction.abort();
  return request;
 };
});
const frame=()=>page.frameLocator('#page'),key='local:public/index.html';
async function records(){return page.evaluate(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('baran-visual-builder',1);q.onupgradeneeded=()=>q.result.createObjectStore('drafts');q.onsuccess=()=>r(q.result);q.onerror=j;});const values=await new Promise((r,j)=>{const tx=db.transaction('drafts'),store=tx.objectStore('drafts'),keys=store.getAllKeys(),values=store.getAll();tx.oncomplete=()=>r(Object.fromEntries(keys.result.map((k,i)=>[k,values.result[i]])));tx.onerror=j;});db.close();return values;});}
async function put(recordKey,raw){await page.evaluate(async({key,raw})=>{const db=await new Promise(r=>{const q=indexedDB.open('baran-visual-builder',1);q.onupgradeneeded=()=>q.result.createObjectStore('drafts');q.onsuccess=()=>r(q.result);});await new Promise((r,j)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(raw,key);tx.oncomplete=r;tx.onerror=tx.onabort=j;});db.close();},{key:recordKey,raw});}
async function seed(raw,recordKey=key){await page.goto(origin+'/admin/');await put(recordKey,raw);}
async function ready(){await frame().locator('#hero-title').waitFor();}
async function saved(){await page.getByText('پیش‌نویس در این مرورگر ذخیره شد',{exact:true}).waitFor();}
const archives=all=>Object.entries(all).filter(([name])=>name.startsWith('archive:'+key+':'));
const snapshot=all=>JSON.parse(all[key]).history.present;
try{
 const base=await(await fetch(origin+'/api/cms/builder?path=public%2Findex.html')).json(),actual=realPages.find(p=>p.path==='public/index.html');
 assert.ok((await fs.readFile(path.join(sandbox,'public/index.html'),'utf8')).replace(/\r\n/g,'\n')===actual.html.replace(/\r\n/g,'\n'),'Public homepage matches the real V1 checkpoint except checkout line endings');
 const legacy=oldBuilder.builderPage(actual.html,base.model.base.revision,'public/index.html'),history=new v1.History(legacy.model),heading=legacy.model.elements.find(e=>e.tag==='h1');
 for(let i=0;i<4;i++){const next=v1.clone(history.present);next.elements.find(e=>e.id===heading.id).content.text='پیش‌نویس واقعی نسخه ۱ ـ '+i;history.commit(next);}history.undo();
 const raw=v1.encodeDraft(history);
 await seed(raw);await page.goto(origin+'/admin/builder/');await ready();
 assert.equal(await frame().locator('#hero-title').innerText(),history.present.elements.find(e=>e.id===heading.id).content.text);
 let all=await records();assert.equal(all[key],raw);assert.equal(archives(all).filter(([,value])=>value===raw).length,1);ok('real V1 draft migrates in browser only after exact raw archival');
 await page.locator('#save').click();await saved();all=await records();assert.equal(JSON.parse(all[key]).version,2);assert.equal(JSON.parse(all[key]).history.past.length,3);assert.equal(JSON.parse(all[key]).history.future.length,1);assert.deepEqual(decodeDraft(all[key],base.model,base.anchors).serialize(),decodeDraft(raw,base.model,base.anchors).serialize());ok('migrated present past future and base revision persist as V2');
 await page.reload();await ready();const afterReload=await records();assert.deepEqual(snapshot(afterReload),snapshot(all));assert.equal(archives(afterReload).filter(([,value])=>value===raw).length,1);ok('refresh restores V2 without duplicate migration or raw archive');
 await seed(raw);await page.goto(origin+'/admin/builder/');await ready();all=await records();assert.equal(archives(all).filter(([,value])=>value===raw).length,1);await page.locator('#save').click();await saved();ok('repeating the same V1 migration remains idempotent');

 const malformed='{"version":1,"history":{"present":';
 await seed(malformed);await page.goto(origin+'/admin/builder/');await page.locator('#gate-message').filter({hasText:'ناسازگار'}).waitFor();assert.equal(await page.locator('#builder').isVisible(),false);
 await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));document.dispatchEvent(new Event('visibilitychange'));});
 all=await records();assert.equal(all[key],malformed);assert.equal(archives(all).filter(([,value])=>value===malformed).length,1);
 await page.reload();await page.locator('#gate-message').filter({hasText:'ناسازگار'}).waitFor();assert.equal((await records())[key],malformed);ok('incompatible draft gate cannot overwrite raw data on pagehide visibility change or refresh');
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'دانلود پیش‌نویس قبلی',exact:true}).click()]);const downloaded=path.join(folder,'migration-malformed-export.json');await download.saveAs(downloaded);assert.equal(await fs.readFile(downloaded,'utf8'),malformed);
 await page.getByRole('button',{name:'شروع پیش‌نویس تازه از صفحه فعلی',exact:true}).click();await ready();await saved();all=await records();assert.equal(JSON.parse(all[key]).version,2);assert.equal(archives(all).filter(([,value])=>value===malformed).length,1);ok('raw incompatible JSON downloads byte for byte and explicit fresh start preserves archive');

 const interrupted=JSON.parse(raw);interrupted.savedAt='2026-01-01T00:00:00.000Z';const interruptedRaw=JSON.stringify(interrupted);
 await seed(interruptedRaw);await page.evaluate(()=>sessionStorage.setItem('test-abort-archive','1'));await page.goto(origin+'/admin/builder/');await page.locator('#gate-message').filter({hasText:'آرشیو مرورگر'}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal((await records())[key],interruptedRaw);await page.reload();await page.locator('#gate-message').filter({hasText:'آرشیو مرورگر'}).waitFor();assert.equal((await records())[key],interruptedRaw);ok('aborted migration archive transactions leave the valid V1 raw draft untouched across refresh');
 await page.evaluate(()=>sessionStorage.removeItem('test-abort-archive'));await page.reload();await ready();assert.equal(await frame().locator('#hero-title').innerText(),history.present.elements.find(e=>e.id===heading.id).content.text);await page.locator('#save').click();await saved();assert.equal(archives(await records()).filter(([,value])=>value===interruptedRaw).length,1);ok('retry after interrupted migration fully recovers once storage becomes writable');

 const beforeInvalid=(await records())[key],invalidImport='{"version":99,"customerText":"متن آزمایشی برای حفظ فایل ناسازگار"}';
 await page.locator('#import').setInputFiles({name:'incompatible.json',mimeType:'application/json',buffer:Buffer.from(invalidImport)});await page.locator('#notice').filter({hasText:'پشتیبانی نمی‌شود'}).waitFor();all=await records();assert.equal(all[key],beforeInvalid);assert.equal(archives(all).filter(([,value])=>value===invalidImport).length,1);ok('invalid imported JSON is archived without changing the current valid draft');
 const importHistory=new v1.History(legacy.model);const imported=v1.clone(legacy.model);imported.elements.find(e=>e.id===heading.id).content.text='واردکردن محتوای نسخه قدیمی';importHistory.commit(imported);const future=v1.clone(imported);future.elements.find(e=>e.id===heading.id).content.text='آینده موجود در فایل خام';importHistory.commit(future);importHistory.undo();const importRaw=v1.encodeDraft(importHistory),beforeImport=snapshot(await records()),pastBefore=JSON.parse((await records())[key]).history.past.length;
 await page.locator('#import').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(importRaw)});await saved();all=await records();assert.equal(snapshot(all).elements.find(e=>e.id===heading.id).content.text,'واردکردن محتوای نسخه قدیمی');assert.equal(JSON.parse(all[key]).history.past.length,pastBefore+1);assert.equal(archives(all).filter(([,value])=>value===importRaw).length,1);await page.locator('#undo').click();await saved();assert.deepEqual(snapshot(await records()),beforeImport);ok('valid V1 file imports as one undoable operation and archives its complete original history');

 const beforeAbort=(await records())[key];await page.evaluate(()=>sessionStorage.setItem('test-abort-draft','1'));await frame().locator('#hero-title').click();await page.locator('#text').fill('ویرایش هنوز در حافظه پس از خطای ذخیره');await page.locator('#save-status').filter({hasText:'ذخیره ناموفق'}).waitFor();assert.equal((await records())[key],beforeAbort);
 await page.locator('#page-selector').selectOption('public/catalog/index.html');await page.locator('#notice').filter({hasText:'پیش از تعویض صفحه'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('path'),'public/index.html');assert.equal(await page.locator('#text').inputValue(),'ویرایش هنوز در حافظه پس از خطای ذخیره');assert.equal((await records())[key],beforeAbort);ok('failed saving blocks page switching and preserves unsaved in-memory edits');
 const [unsaved]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);const unsavedFile=path.join(folder,'migration-unsaved-export.json');await unsaved.saveAs(unsavedFile);assert.equal(JSON.parse(await fs.readFile(unsavedFile,'utf8')).history.present.elements.find(e=>e.id===heading.id).content.text,'ویرایش هنوز در حافظه پس از خطای ذخیره');
 await page.reload();await ready();assert.deepEqual(snapshot(await records()),JSON.parse(beforeAbort).history.present);await page.evaluate(()=>sessionStorage.removeItem('test-abort-draft'));await frame().locator('#hero-title').click();await page.locator('#text').fill('ذخیره پس از بازیابی خطای تراکنش');await saved();assert.equal(snapshot(await records()).elements.find(e=>e.id===heading.id).content.text,'ذخیره پس از بازیابی خطای تراکنش');ok('interrupted saving preserves previous valid record export retains unsaved work and next save recovers');

 const otherAccount='other-account:public/index.html',otherPage='local:public/catalog/index.html',foreign='{"version":99,"text":"پیش‌نویس حساب یا صفحه دیگر"}';await put(otherAccount,foreign);await put(otherPage,foreign);const currentHome=(await records())[key];await page.reload();await ready();all=await records();assert.equal(all[otherAccount],foreign);assert.equal(all[otherPage],foreign);assert.deepEqual(snapshot(all),JSON.parse(currentHome).history.present);ok('draft recovery and archival stay scoped to current page and account');
 const recoveredRaw=JSON.stringify({...JSON.parse(all[key]),savedAt:'unique-lost-response-archive-fixture'}),requestId=crypto.randomUUID(),recoveredBase=structuredClone(base);recoveredBase.model.base.revision='fixture-new-revision';recoveredBase.receipt={requestId};
 await seed(recoveredRaw);await put('request:'+key,{requestId});await page.evaluate(()=>sessionStorage.setItem('test-abort-archive','1'));await page.route('**/api/cms/builder?*',route=>route.fulfill({status:200,json:recoveredBase}));await page.goto(origin+'/admin/builder/');await page.getByRole('button',{name:'دانلود پیش‌نویس قبلی',exact:true}).waitFor();assert.equal((await records())[key],recoveredRaw);assert.equal(await page.getByRole('button',{name:'باز کردن نسخه ثبت‌شده',exact:true}).isVisible(),true);ok('lost-response recovery still offers raw download when archive storage is unavailable');
 assert.deepEqual(errors,[]);assert.ok((await fs.readFile('public/index.html')).equals(original));assert.ok((await fs.readFile(path.join(sandbox,'public/index.html'))).equals(original));
 await fs.writeFile(path.join(folder,'migration-browser-report.json'),JSON.stringify({passed:results.length,failed:0,results,browserErrors:errors,sourcePublicUnchanged:true,sandboxPublicUnchanged:true},null,2));console.log(JSON.stringify({passed:results.length,failed:0,browserErrors:errors.length,publicMutations:0}));
}catch(error){await page.screenshot({path:path.join(folder,'migration-browser-failure.png'),fullPage:true});await fs.writeFile(path.join(folder,'migration-browser-failure.json'),JSON.stringify({passed:results,error:error.message,url:page.url(),errors},null,2));throw error;}
finally{await browser.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));}
