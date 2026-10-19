import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startLocal} from '../scripts/cms-local.mjs';
import {writeAuditReport} from '../scripts/audit-redact.mjs';

const folder=path.resolve('.cms-local/task6-qa');await fs.mkdir(folder,{recursive:true});
const sandbox=await fs.mkdtemp(path.join(folder,'pages-ui-'));await fs.cp('public',path.join(sandbox,'public'),{recursive:true});
const originalFiles=['public/index.html','public/en/index.html','public/sitemap.xml','src/auth.js','src/content.js'];
const originals=new Map(await Promise.all(originalFiles.map(async f=>[f,await fs.readFile(f)])));
const server=await startLocal(sandbox,0),origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1600,height:1000}});
await context.addInitScript(()=>{if(window===window.top)localStorage.setItem('baran-builder-ui-mode','advanced');});
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const page=await context.newPage(),errors=[],results=[],publications=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(request.url().endsWith('/builder/publish'))publications.push(request.postDataJSON());});
const frame=()=>page.frameLocator('#page'),ok=name=>{results.push(name);console.log('PASS '+name);};
const row=p=>page.locator(`#pm-pages [data-path="${p}"]`);
async function idle(){await page.locator('#pages-manager').waitFor();await page.waitForFunction(()=>!document.querySelector('#pages-manager').hasAttribute('aria-busy'));}
async function manager(){await page.locator('#pages-manager-open').click();await idle();}
async function close(){await page.locator('#pm-close').click();}
async function saved(){await page.getByText('پیش‌نویس در این مرورگر ذخیره شد',{exact:true}).waitFor();}
async function ready(p){await page.waitForURL(u=>u.searchParams.get('path')===p);await page.waitForFunction(()=>!document.querySelector('.workspace').inert&&!document.querySelector('#page').hidden);await frame().locator('main h1').waitFor();}
async function create(slug,title,language='en'){
 await manager();await page.locator('[data-pm-tab=create]').click();await page.locator('#pm-new-kind').selectOption('template');await page.locator('#pm-new-title').fill(title);await page.locator('#pm-new-slug').fill(slug);await page.locator('#pm-new-language').selectOption(language);await page.locator('#pm-new-template').selectOption('hero');await page.locator('#pm-new-description').fill('Lifecycle test description');await page.locator('#pm-create-submit').click();
 await page.locator('#pages-manager').waitFor({state:'hidden'});await ready(`public/${language==='en'?'en/':''}${slug}/index.html`);await saved();
}
async function publish(){await page.locator('#publish').click();await page.locator('#publish-confirm').click();await page.getByText('در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است.',{exact:true}).waitFor({timeout:60000});}
async function operation(p,button,value,{rewrite=false,expectError=false}={}){
 await row(p).getByRole('button',{name:button,exact:true}).click();await idle();
 if(value!==undefined)await page.locator('#pm-operation-value').fill(value);
 if(await page.locator('#pm-confirm').isVisible())await page.locator('#pm-confirm').fill(p);
 if(rewrite)await page.locator('#pm-rewrite').check();await page.locator('#pm-operation-submit').click();await idle();
 if(expectError){await page.locator('#pm-error').filter({hasText:/تغییرمسیر|پیوند|مسیر/}).waitFor();return;}
 await page.locator('#pm-message').filter({hasText:/عملیات/}).waitFor();assert.equal(await page.locator('#pm-error').innerText(),'');
}
async function http(p,status=200){const response=await fetch(origin+p,{redirect:'manual'});assert.equal(response.status,status,p);return response;}
try{
 await page.goto(origin+'/admin/builder/');await ready('public/index.html');
 await manager();await page.locator('[data-pm-tab=create]').click();await page.locator('#pm-new-title').fill('Reserved path');await page.locator('#pm-new-slug').fill('admin');await page.locator('#pm-create-submit').click();await idle();assert.match(await page.locator('#pm-error').innerText(),/رزرو|مسیر|نامک/);await close();ok('reserved route rejected by real page-management UI');
 await create('task6-source','English lifecycle source');await frame().locator('main h1').click();await page.locator('#text').fill('English lifecycle content');await saved();
 await page.locator('[data-block=button]').click();await page.locator('#text').fill('Internal lifecycle link');await page.locator('#href').fill('/en/task6-source/?qa=1#content');await saved();
 await page.locator('#page-settings-open').click();await idle();await page.locator('#pm-seo-menu-included').check();await page.locator('#pm-seo-menu-label').fill('QA source');await page.locator('#pm-seo-menu-order').fill('0');await page.locator('#pm-seo-submit').click();await idle();await close();await saved();
 await http('/en/task6-source/',404);await publish();await http('/en/task6-source/');assert.match(await(await http('/en/')).text(),/QA source/);assert.ok(!(await(await http('/')).text()).includes('QA source'));ok('English page edited and published with genuine language-specific navigation');
 const sourcePath='public/en/task6-source/index.html',copyPath='public/en/task6-copy/index.html';
 await manager();await page.locator('[data-pm-tab=create]').click();await page.locator('#pm-new-language').selectOption('fa');await page.locator('[data-pm-tab=list]').click();await row(sourcePath).getByRole('button',{name:'تکثیر',exact:true}).click();assert.equal(await page.locator('#pm-new-language').inputValue(),'en','Duplicating an English page must default to its source language');
 await page.locator('#pm-new-title').fill('English lifecycle copy');await page.locator('#pm-new-slug').fill('task6-copy');await page.locator('#pm-create-submit').click();await page.locator('#pages-manager').waitFor({state:'hidden'});await ready(copyPath);assert.equal(await frame().locator('html').getAttribute('dir'),'ltr');assert.equal(await frame().locator('main h1').innerText(),'English lifecycle content');await publish();ok('duplicate inherits English locale content and independent route');
 await manager();await page.locator('[data-pm-tab=create]').click();await page.locator('#pm-new-title').fill('Collision');await page.locator('#pm-new-slug').fill('task6-copy');await page.locator('#pm-new-language').selectOption('en');await page.locator('#pm-create-submit').click();await idle();assert.match(await page.locator('#pm-error').innerText(),/وجود|استفاده|مسیر/);await page.locator('[data-pm-tab=list]').click();ok('duplicate slug cannot overwrite the published copy');
 await operation(sourcePath,'تغییر نام','Renamed lifecycle source');assert.match(await(await http('/en/task6-source/')).text(),/<title>Renamed lifecycle source<\/title>/);ok('rename persists real SEO title');
 await operation(sourcePath,'تغییر نامک','task6-renamed',{rewrite:true});const moved='public/en/task6-renamed/index.html';
 const redirect=await http('/en/task6-source/',301);assert.equal(redirect.headers.get('location'),'/en/task6-renamed/');const movedHTML=await(await http('/en/task6-renamed/')).text();assert.match(movedHTML,/rel="canonical"[^>]*href="https:\/\/luxtowelco.com\/en\/task6-renamed\/"|href="https:\/\/luxtowelco.com\/en\/task6-renamed\/"[^>]*rel="canonical"/);
 assert.ok((await(await http('/en/task6-copy/')).text()).includes('/en/task6-renamed/?qa=1#content'));assert.ok((await(await http('/sitemap.xml')).text()).includes('/en/task6-renamed/'));ok('slug change rewrites real links canonical sitemap and exact redirects');
 await operation(moved,'حذف امن',undefined,{expectError:true});await http('/en/task6-renamed/');await page.locator('#pm-operation-cancel').click();ok('deletion of a redirect destination fails safely with explanation');
 for(const label of ['بایگانی','حذف امن']){
  await operation(copyPath,label);await http('/en/task6-copy/',404);assert.ok(!(await(await http('/sitemap.xml')).text()).includes('/en/task6-copy/'));
  await operation(copyPath,'بازیابی صفحه');await http('/en/task6-copy/');
 }
 ok('archive delete and restore operate on real static HTML and sitemap through UI');await close();
 await create('task6-fa','صفحهٔ چرخهٔ فارسی','fa');assert.equal(await frame().locator('html').getAttribute('dir'),'rtl');await publish();await http('/task6-fa/');ok('Persian route and RTL creation remain compatible');
 const faPath='public/task6-fa/index.html';
 async function continueEditing(){await page.locator('#continue-editing').click();await page.locator('#continue-editing').waitFor({state:'hidden'});await ready(faPath);}
 await continueEditing();await page.locator('[data-block=cards]').click();await saved();const owner=await page.locator('#element-id').innerText();await page.locator('[data-pro-action=lock]').click();await saved();await publish();
 await continueEditing();await page.locator(`[data-select="${owner}"]`).click();await page.locator('[data-pro-action=lock]').click();await saved();
 const persisted=await(await fetch(origin+'/api/cms/builder?path='+encodeURIComponent(faPath))).json(),cards=persisted.model.elements.find(e=>e.parentId===owner),child=persisted.model.elements.find(e=>e.parentId===cards.id&&e.type==='text');assert.ok(child);
 await page.locator(`[data-select="${child.id}"]`).click();await page.locator('#text').fill('ویرایش پس از بازکردن قفل و قفل مجدد');await saved();await page.locator(`[data-select="${owner}"]`).click();await page.locator('[data-pro-action=lock]').click();await saved();
 const beforePreview=await fs.readFile(path.join(sandbox,faPath));await page.locator('#public-preview').click();await page.locator('#output-dialog').waitFor();await page.frameLocator('#output-frame').getByText('ویرایش پس از بازکردن قفل و قفل مجدد',{exact:true}).waitFor();await page.locator('#output-close').click();assert.ok((await fs.readFile(path.join(sandbox,faPath))).equals(beforePreview));ok('unlock edit relock can preview without modifying the published page');
 await page.locator('#publish').click();assert.equal(await page.locator('#publish-unlock-group').isVisible(),true);assert.equal(await page.locator('#publish-confirm').isDisabled(),true);await page.locator('#publish-cancel').click();assert.ok((await fs.readFile(path.join(sandbox,faPath))).equals(beforePreview));
 await page.locator('#publish').click();await page.locator('#publish-unlock-confirm').check();await page.locator('#publish-confirm').click();await page.getByText('در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است.',{exact:true}).waitFor({timeout:60000});
 const payload=publications.at(-1);assert.deepEqual(payload.unlockIds,[owner]);const afterLock=await(await fetch(origin+'/api/cms/builder?path='+encodeURIComponent(faPath))).json();assert.equal(afterLock.model.elements.find(e=>e.id===owner).locked,true);assert.equal(afterLock.model.elements.find(e=>e.id===child.id).content.text,'ویرایش پس از بازکردن قفل و قفل مجدد');ok('explicit confirmation publishes edited locked subtree and preserves its final lock');
 const historyRoute='/api/cms/history?path='+encodeURIComponent(faPath),beforeReplay=await(await fetch(origin+historyRoute)).json(),replayed=await fetch(origin+'/api/cms/builder/publish',{method:'POST',headers:{Origin:origin,'X-CMS-Request':'1','Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(replayed.status,200);assert.equal((await replayed.json()).replayed,true);assert.deepEqual(await(await fetch(origin+historyRoute)).json(),beforeReplay);ok('unlock-confirmed publication replays without a duplicate history entry');
 for(const [file,bytes]of originals)assert.ok((await fs.readFile(file)).equals(bytes),file);assert.deepEqual(errors,[]);
 await writeAuditReport(path.join(folder,'pages-browser-report.json'),{passed:true,scenarios:results.length,results,errors,productionChanged:false,isolatedRoot:sandbox});console.log(JSON.stringify({passed:results.length,errors:0,productionChanged:false}));
}catch(error){await page.screenshot({path:path.join(folder,'pages-failure.png'),fullPage:true}).catch(()=>{});await writeAuditReport(path.join(folder,'pages-browser-failure.json'),{completed:results,error:error.message,errors,isolatedRoot:sandbox});throw error;}
finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
