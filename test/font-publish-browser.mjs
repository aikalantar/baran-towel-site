import {chromium,webkit} from '@playwright/test';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {startLocal} from '../scripts/cms-local.mjs';
import {FONT_CATALOG} from '../public/admin/builder/fonts.js';
const dir=path.resolve('.cms-local/task14-qa'),root=await fs.mkdtemp(path.join(dir,'font-site-'));await fs.cp('public',path.join(root,'public'),{recursive:true});
const walk=async d=>(await Promise.all((await fs.readdir(d,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(d,e.name)):path.join(d,e.name)))).flat();
const pages=(await walk('public')).filter(p=>p.endsWith('index.html')&&!p.startsWith(path.join('public','admin'))),before=new Map(await Promise.all(pages.map(async p=>[p,await fs.readFile(p)])));
const server=await startLocal(root,0),origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1700,height:1100}}),results=[],errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const ok=s=>{results.push(s);console.log('PASS '+s);},frame=()=>page.frameLocator('#page'),saved=()=>page.getByText('پیش‌نویس در این مرورگر ذخیره شد',{exact:true}).waitFor();
const idle=()=>page.waitForFunction(()=>!document.querySelector('#pages-manager').hasAttribute('aria-busy'));
try{
 await page.goto(origin+'/admin/builder/');await frame().locator('#hero-title').waitFor();await page.locator('#pages-manager-open').click();await idle();await page.locator('[data-pm-tab=create]').click();await page.locator('#pm-new-title').fill('Font publication fixture');await page.locator('#pm-new-slug').fill('task14-font-fixture');await page.locator('#pm-new-description').fill('Isolated local typography verification');await page.locator('#pm-create-submit').click();await frame().locator('main h1').filter({hasText:'Font publication fixture'}).waitFor();await saved();
 const titleId=await frame().locator('main h1').getAttribute('data-builder-id');await frame().locator('main h1').click();
 for(const [device,font]of [['desktop','Vazirmatn'],['tablet','Estedad'],['mobile','Inter']]){await page.locator(`[data-device=${device}]`).click();await page.locator('#pro-fontFamily').selectOption(font);await saved();}
 await page.locator('[data-device=desktop]').click();
 const nodes=[];
 for(const family of FONT_CATALOG){await page.locator('[data-block=richtext]').click();await page.locator('#text').fill(`آزمون قلم ${family.id} · Actual font preview`);await page.locator('#pro-fontFamily').selectOption(family.id);await saved();nodes.push({id:await page.locator('#element-id').innerText(),family:family.id});}
 ok('all six curated fonts selectable on actual text; three independent responsive font overrides save');
 await page.locator('#page-settings-open').click();await idle();await page.locator('#pm-seo-robots').selectOption('noindex');await page.locator('#pm-seo-visibility').selectOption('unlisted');await page.locator('#pm-seo-menu-included').uncheck();await page.locator('#pm-seo-submit').click();await idle();await page.locator('#pm-close').click();await saved();
 await page.locator('#publish').click();await page.locator('#publish-confirm').click();await page.getByText('در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است.',{exact:true}).waitFor({timeout:60000});
 const html=await(await fetch(origin+'/task14-font-fixture/')).text();assert.match(html,/noindex/);assert.doesNotMatch(html,/canvas-hit-plane|direct-edit-bar|builder-editor-view|font-preview/);assert.ok(!(await(await fetch(origin+'/sitemap.xml')).text()).includes('/task14-font-fixture/'));ok('real local publication exports static font CSS and no editor controls; noindex/unlisted respected');
 for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){
  const b=await engine.launch(engine===chromium?{channel:'chrome'}:{}),context=await b.newContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await p.goto(origin+'/task14-font-fixture/');
  for(const n of nodes){const actual=await p.locator(`[data-builder-id="${n.id}"]`).evaluate(async(el,family)=>{const loaded=await document.fonts.load(`20px "${family}"`,el.textContent);return {family:getComputedStyle(el).fontFamily,loaded:loaded.length,status:loaded.map(f=>f.status)};},n.family);assert.ok(actual.family.includes(n.family));assert.ok(actual.loaded>0,n.family);assert.ok(actual.status.every(s=>s==='loaded'));}
  for(const [width,font]of [[1440,'Vazirmatn'],[768,'Estedad'],[390,'Inter']]){await p.setViewportSize({width,height:1000});const family=await p.locator(`[data-builder-id="${titleId}"]`).evaluate(n=>getComputedStyle(n).fontFamily);assert.ok(family.includes(font));}
  await p.screenshot({path:path.join(dir,`published-fonts-${name}.png`),fullPage:true});await b.close();ok(`${name} decodes all six real WOFF2 fonts from local assets and published desktop/tablet/mobile CSS`);
 }
 for(const [p,bytes]of before){assert.ok((await fs.readFile(p)).equals(bytes));assert.ok((await fs.readFile(path.join(root,p))).equals(bytes));}assert.deepEqual(errors,[]);ok('all nine original pages byte exact in source and isolated publication; no browser errors');
 await fs.writeFile(path.join(dir,'font-publish-report.json'),JSON.stringify({passed:true,results,errors,isolatedRoot:root,productionChanged:false},null,2));
}catch(e){await page.screenshot({path:path.join(dir,'font-publish-failure.png')}).catch(()=>{});throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
