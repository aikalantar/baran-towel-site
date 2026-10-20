import {chromium,webkit,devices} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {startLocal} from '../scripts/cms-local.mjs';
const dir=path.resolve('.cms-local/task17-qa');await fs.mkdir(dir,{recursive:true});
const originals=new Map();
for(const file of ['public/index.html','public/en/index.html','public/catalog/index.html','public/en/catalog/index.html','public/bridal-towels/index.html','public/blog/index.html','public/en/blog/index.html','public/blog/rahnamaye-kharid-hole-luxury/index.html','public/en/blog/how-to-choose-luxury-towels/index.html'])originals.set(file,await fs.readFile(file));
const results=[],errors=[];
for(const [engine,name,options]of [[chromium,'chromium',{viewport:{width:1600,height:1050}}],[webkit,'webkit-touch',devices['iPad (gen 7)']]]){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cms-identity-'));await fs.cp('public',path.join(root,'public'),{recursive:true});
 const server=await startLocal(root,0),origin=`http://127.0.0.1:${server.address().port}`,browser=await engine.launch(engine===chromium?{channel:'chrome'}:{}),context=await browser.newContext(options),p=await context.newPage();p.setDefaultTimeout(25000);p.on('pageerror',e=>errors.push({name,message:e.message}));p.on('dialog',d=>d.accept());
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const frame=()=>p.frameLocator('#page'),saved=()=>p.getByText('پیش‌نویس در این مرورگر ذخیره شد',{exact:true}).waitFor(),ok=label=>{results.push({name,label});console.log('PASS '+name+': '+label);};
 const catalogURL=origin+'/admin/builder/?path=public%2Fcatalog%2Findex.html';
 async function pick(selector){const node=frame().locator(selector).first();await node.evaluate(n=>n.scrollIntoView({block:'center'}));const r=await node.boundingBox();if(options.hasTouch)await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);else await p.mouse.click(r.x+r.width/2,r.y+r.height/2);await p.locator('#text-group,#image-group').filter({visible:true}).first().waitFor().catch(()=>{});}
 async function builderPublish(){await p.locator('#publish').click();const confirm=p.locator('#publish-confirm');await confirm.waitFor();if(options.hasTouch){const r=await confirm.boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);}else await confirm.click();await p.getByText('در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است.',{exact:true}).waitFor({timeout:60000});}
 async function legacyPublish(){await p.locator('[data-action=publish]').click();const response=p.waitForResponse(r=>r.url().endsWith('/api/cms/publish'));await p.locator('[data-dialog-yes]').click();const r=await response;assert.equal(r.status(),200,await r.text());await p.getByText('فایل‌ها در پروژه محلی ذخیره شدند. برای انتشار روی سایت، commit و push کنید.',{exact:true}).waitFor();await p.waitForFunction(()=>!document.querySelector('#app').inert&&!document.querySelector('[data-action=publish]')?.disabled);}
 async function legacyCatalog(){await p.goto(origin+'/admin/');await p.locator('[data-nav=catalog]').click();await p.locator('[data-tab=models]').click();}
 async function reopen(){await p.goto(catalogURL);await p.getByRole('button',{name:'دانلود پیش‌نویس قبلی',exact:true}).waitFor();const d=p.waitForEvent('download');await p.getByRole('button',{name:'دانلود پیش‌نویس قبلی',exact:true}).click();const raw=await fs.readFile(await(await d).path(),'utf8');assert.ok(JSON.parse(raw).history.present);await p.getByRole('button',{name:'شروع پیش‌نویس تازه از صفحه فعلی',exact:true}).click();await frame().locator('main h1').waitFor();return raw;}
 const product='task17-browser-product';
 try{
  await p.goto(catalogURL);await frame().locator('main h1').waitFor();await pick('main h1');await p.locator('#text').fill('آزمون محلی سازگاری');await saved();await builderPublish();ok('real Builder UI publishes catalog before Legacy cloning');
  await legacyCatalog();await p.locator('[data-model-copy=sanam]').click();await p.locator('#model-name').fill('محصول سازگاری');await p.locator('#model-id').fill(product);await p.locator('#model-copy-form button.btn.primary').click();await p.locator('[data-action=preview]').first().click();await p.frameLocator('#preview').locator('#'+product+' h2').waitFor();await legacyPublish();ok('real Legacy UI creates, previews and publishes cloned product');
  const previous=await reopen();assert.ok(previous.includes('آزمون محلی سازگاری'));await frame().locator('#'+product+' h2').waitFor();
  const base=await(await context.request.get(origin+'/api/cms/builder?path=public%2Fcatalog%2Findex.html')).json();assert.equal(new Set(base.model.elements.map(e=>e.id)).size,base.model.elements.length);ok('Builder reopens clone; stale draft is exported/archived explicitly, never overwritten silently');
  await pick('#'+product+' h2');const selected=await p.locator('#element-id').innerText();await p.locator('#text').fill('نام تازه Builder');await saved();await p.locator('#undo').click();await saved();assert.equal(await p.locator('#text').inputValue(),'محصول سازگاری');await p.locator('#redo').click();await saved();ok('cloned identity supports edit, Undo and Redo');
  await pick('#'+product+' img');await p.locator('#image-library').selectOption('/assets/products/mozhan.webp');await frame().locator('#'+product+' img[src="/assets/products/mozhan.webp"]').waitFor();await saved();await builderPublish();ok('cloned product media can be replaced and republished through Builder');
  await legacyCatalog();await p.locator(`[data-model-up="${product}"]`).click();await legacyPublish();
  const head=(await(await context.request.get(origin+'/api/cms/library')).json()).head;
  await p.locator('[data-tab=models]').click();await p.locator(`[data-model-remove="${product}"]`).click();await p.locator('[data-dialog-yes]').click();await legacyPublish();
  await reopen();assert.equal(await frame().locator('#'+product).count(),0);ok('Legacy movement/deletion reopen without stale generated descendants');
  await p.locator('#revisions').selectOption(head);await p.locator('#load-revision').click();await frame().locator('#'+product+' h2').waitFor();await builderPublish();
  const restored=await(await context.request.get(origin+'/api/cms/builder?path=public%2Fcatalog%2Findex.html')).json();assert.ok(restored.model.elements.some(e=>e.id===selected));ok('historical restore and publication retain the exact cloned identity');
  await p.screenshot({path:path.join(dir,name+'-interop.png')});
  for(const [file,bytes]of originals)assert.ok((await fs.readFile(file)).equals(bytes));ok('all nine workspace customer pages remain byte exact');
 }catch(error){await p.screenshot({path:path.join(dir,name+'-failure.png')}).catch(()=>{});await fs.writeFile(path.join(dir,'browser-failure.json'),JSON.stringify({name,error:error.stack,results,errors},null,2));throw error;}
 finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
assert.deepEqual(errors,[]);await fs.writeFile(path.join(dir,'interop-browser.json'),JSON.stringify({passed:true,results,errors,localOnly:true,physicalDevices:false},null,2));console.log(JSON.stringify({passed:results.length,errors:0,productionChanged:false}));
