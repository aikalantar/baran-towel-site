import {webkit,devices} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startLocal} from '../scripts/cms-local.mjs';
const out=path.resolve(process.env.CMS_QA_DIR||'.cms-local/task186-qa');await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(os.tmpdir(),'cms-freedom-webkit-'));await fs.cp('public',path.join(root,'public'),{recursive:true});
const original=await fs.readFile('public/en/index.html'),server=await startLocal(root,0),origin=`http://127.0.0.1:${server.address().port}`;
const browser=await webkit.launch(),context=await browser.newContext(devices['iPhone 13']),p=await context.newPage(),results=[],errors=[],counts=[];let steps={clicks:0,fills:0,selects:0};
p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
const click=async l=>{await p.waitForFunction(()=>!document.querySelector('#customer-dialog[open][aria-busy]'));steps.clicks++;await l.tap();};
const fill=async(l,v)=>{steps.fills++;await l.fill(v);},choose=async(l,v)=>{steps.selects++;await l.selectOption(v);};
const ok=label=>{results.push(label);counts.push({workflow:label,...steps});steps={clicks:0,fills:0,selects:0};console.log('PASS '+label);},frame=()=>p.frameLocator('#page');
const pick=async selector=>{const node=frame().locator(selector).first();await node.evaluate(n=>n.scrollIntoView({block:'center'}));steps.clicks++;const b=await node.boundingBox();await p.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await p.locator('#customer-selection').waitFor();};
try{
 await p.goto(origin+'/admin/editor/?path=public%2Fen%2Findex.html');await frame().locator('main h1').waitFor();assert.equal(await frame().locator('html').getAttribute('dir'),'ltr');
 await pick('main h1');await click(p.locator('#customer-appearance summary'));await choose(p.locator('#customer-font-family'),'Estedad');await fill(p.locator('#customer-font-size'),'32');await p.locator('#customer-font-size').press('Tab');await click(p.getByRole('button',{name:'آبی برای نوشته',exact:true}));
 await frame().locator('main h1').evaluate(async()=>{await document.fonts.load('32px Estedad');});assert.equal(await frame().locator('main h1').evaluate(n=>getComputedStyle(n).fontSize),'32px');assert.ok(await frame().locator('main h1').evaluate(()=>document.fonts.check('32px Estedad')));
 await p.screenshot({path:path.join(out,'iphone-safe-appearance.png')});await click(p.locator('#publish'));await click(p.locator('#publish-confirm'));await p.locator('#continue-editing').waitFor();await click(p.locator('#continue-editing'));await p.waitForFunction(()=>!document.querySelector('.workspace').inert&&document.querySelector('#continue-editing').hidden);await frame().locator('main h1').waitFor();ok('WebKit iPhone safely styles and publishes real fonts and colors on English content');
 await click(p.locator('#customer-menu'));await click(p.locator('[data-task=edit]'));await click(p.getByRole('button',{name:'+ افزودن نوشته، تصویر یا دکمه',exact:true}));await click(p.locator('[data-customer-add=richtext]'));await fill(p.locator('#text'),'WebKit customer content');const added=frame().getByText('WebKit customer content',{exact:true});await added.waitFor();const id=await added.getAttribute('data-builder-id');
 await click(p.locator('#customer-remove'));await click(p.getByRole('button',{name:'حذف از پیش‌نویس',exact:true}));await added.waitFor({state:'detached'});await click(p.locator('#undo'));await added.waitFor();await click(p.locator('#redo'));await added.waitFor({state:'detached'});await click(p.locator('#undo'));await added.waitFor();ok('WebKit touch adds and removes simple content with shared Undo and Redo');
 await p.goto(origin+'/admin/builder/?path=public%2Fen%2Findex.html');await frame().locator('[data-builder-id="'+id+'"]').waitFor();await p.locator('#mode-advanced').click();assert.equal(await p.locator('[data-block]').count(),16);assert.equal(await frame().locator('main h1').evaluate(n=>getComputedStyle(n).fontSize),'32px');
 await p.goto(origin+'/admin/editor/?path=public%2Fen%2Findex.html');await frame().locator('[data-builder-id="'+id+'"]').waitFor();assert.equal(await p.locator('#professional-controls').count(),0);assert.ok((await fs.readFile('public/en/index.html')).equals(original));assert.deepEqual(errors,[]);ok('WebKit Customer Studio Customer round trip retains appearance identities and draft');
 await fs.writeFile(path.join(out,'webkit-freedom.json'),JSON.stringify({passed:true,results,counts,errors,humanParticipants:0,physicalDevice:false,productionChanged:false},null,2));
}catch(e){await p.screenshot({path:path.join(out,'webkit-freedom-failure.png')}).catch(()=>{});throw e;}
finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
