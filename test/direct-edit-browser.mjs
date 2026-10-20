import {chromium,webkit,devices} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startLocal} from '../scripts/cms-local.mjs';

const folder=path.resolve('.cms-local/task14-qa');await fs.mkdir(folder,{recursive:true});
const root=await fs.mkdtemp(path.join(folder,'site-'));await fs.cp('public',path.join(root,'public'),{recursive:true});
const server=await startLocal(root,0),origin=`http://127.0.0.1:${server.address().port}`,results=[],errors=[];
const original=await fs.readFile('public/index.html');
const ok=(profile,name)=>{results.push({profile,name});console.log(`PASS ${profile}: ${name}`);};
let currentPage;
try{
for(const [engine,name,options]of [[chromium,'chromium-touch',devices['Pixel 7']],[webkit,'webkit-iphone',devices['iPhone 13']],[chromium,'chromium-desktop',{viewport:{width:1600,height:1050}}],[webkit,'webkit-tablet',devices['iPad (gen 7)']]]){
 if(process.env.TASK14_PROFILE&&!name.includes(process.env.TASK14_PROFILE))continue;
 const browser=await engine.launch(engine===chromium?{channel:'chrome'}:{}),context=await browser.newContext(options),page=await context.newPage();currentPage=page;page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push({name,error:e.message}));page.on('dialog',d=>d.accept());
 const requests=[];page.on('request',r=>{if(r.url().includes('/assets/builder-fonts/'))requests.push(r.url());});
 const frame=()=>page.frameLocator('#page');
 const saved=()=>page.getByText('پیش‌نویس در این مرورگر ذخیره شد',{exact:true}).waitFor();
 const draft=()=>page.evaluate(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('baran-visual-builder',1);q.onsuccess=()=>r(q.result);q.onerror=j;});const raw=await new Promise(r=>{const q=db.transaction('drafts').objectStore('drafts').get('local:public/index.html');q.onsuccess=()=>r(q.result);});db.close();return raw&&JSON.parse(raw);});
 const ready=async()=>{await page.waitForFunction(()=>!document.querySelector('.workspace').inert&&!document.querySelector('#page').hidden);await frame().locator('#hero-title').waitFor();};
 const close=async()=>{if(await page.locator('#selection-inspector').isVisible())await page.locator('#direct-close').click();};
 async function tap(selector,type){
  await close();const loc=frame().locator(selector).first();await loc.evaluate(n=>n.scrollIntoView({block:'center'}));
  const box=await loc.boundingBox();assert.ok(box);const x=box.x+box.width/2,y=box.y+box.height/2;
  if(options.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
  await page.waitForFunction(t=>document.querySelector('#selection-inspector').dataset.selectionType===t,type);
  await page.locator('#selection-inspector').waitFor({state:'visible'});
  const control=type==='image'?'#change-image':'#text';assert.ok(await page.locator(control).isVisible());
  const r=await page.locator(control).boundingBox();assert.ok(r.y>=0&&r.y+r.height<=page.viewportSize().height+1,'first contextual control is on screen');
 }
 try{
  await page.goto(origin+'/admin/builder/');await ready();assert.equal(requests.length,0);assert.equal(await page.locator('[data-block]').count(),16);assert.equal(await page.locator('body').getAttribute('data-ui-mode'),'simple');
  await page.locator('#direct-edit-toggle').click();await page.waitForFunction(()=>document.body.classList.contains('direct-edit'));
  const dimensions=await page.evaluate(()=>({canvas:document.querySelector('.canvas').getBoundingClientRect().toJSON(),bar:document.querySelector('#direct-edit-bar').getBoundingClientRect().toJSON(),frame:document.querySelector('#page').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight}));
  assert.ok(dimensions.canvas.height>=dimensions.height-dimensions.bar.height-2);assert.ok(dimensions.frame.width<=dimensions.width);assert.equal(await page.locator('#page').getAttribute('sandbox'),'allow-same-origin');ok(name,'full viewport canvas, compact controls, secure real iframe and 16 blocks');
  await tap('#hero-title','heading');const titleId=await page.locator('#element-id').innerText();assert.equal(await page.locator('#layers [aria-pressed=true]').getAttribute('data-select'),titleId);assert.ok(await page.locator('#pro-fontFamily').isVisible());ok(name,'single native tap/click selects existing text and shows contextual text/font settings');
  await page.screenshot({path:path.join(folder,name+'-text.png')});
  await close();assert.equal(await page.locator('#element-id').innerText(),titleId);await tap('#hero-title','heading');ok(name,'close preserves selection; repeated tap reopens the sheet/dock');
  await tap('.hero img','image');assert.ok(await page.locator('#alt').isVisible());assert.equal(await page.locator('#text-group').isVisible(),false);ok(name,'single native tap selects existing image and switches to image controls');
  await page.screenshot({path:path.join(folder,name+'-image.png')});
  const oldFrameURL=await frame().locator('body').evaluate(()=>location.href);
  await tap('.bridal-promo-home a.button','button');assert.equal(await page.locator('#href').inputValue(),'/bridal-towels/');assert.equal(await frame().locator('body').evaluate(()=>location.href),oldFrameURL);ok(name,'existing link/button is selected; Edit prevents navigation');
  await tap('#hero-title','heading');const oldText=await page.locator('#text').inputValue();await page.locator('#text').fill('لمس مستقیم · Direct editing');await saved();
  // The selected breakpoint is real canvas width; inheritance stays untouched elsewhere.
  await page.locator('#pro-fontFamily').selectOption('Vazirmatn');await saved();
  await page.locator('#font-preview').evaluate(n=>document.fonts.load('20px Vazirmatn',n.textContent));
  assert.ok(requests.some(u=>u.endsWith('/vazirmatn-variable.woff2')));assert.equal(requests.some(u=>/inter-variable|estedad-variable|shabnam|sahel|lato/.test(u)),false);
  const sample=await page.locator('#font-preview').textContent();assert.equal(sample,'لمس مستقیم · Direct editing');
  await page.locator('#undo').click();await saved();assert.equal(await page.locator('#pro-fontFamily').inputValue(),'');await page.locator('#redo').click();await saved();assert.equal(await page.locator('#pro-fontFamily').inputValue(),'Vazirmatn');ok(name,'font choice loads only selected family; real text preview, autosave and Undo/Redo');
  const before=(await draft()).history;await page.locator('#mode-advanced').click();assert.ok(await page.locator('#pro-layout-mode').isVisible());assert.ok(await page.locator('#pro-letterSpacing').isVisible());await page.locator('#mode-simple').click();assert.deepEqual((await draft()).history,before);ok(name,'Simple/Advanced preserves professional capabilities and draft history');
  await close();await page.locator('#preview').click();assert.equal(await page.locator('.canvas-hit-plane').isVisible(),false);
  const link=frame().locator('.bridal-promo-home a.button');await link.evaluate(n=>n.scrollIntoView({block:'center'}));await link.click();await page.waitForFunction(()=>document.querySelector('#page').contentDocument?.location.pathname==='/bridal-towels/');
  await page.locator('#preview').click();await frame().locator('#hero-title').filter({hasText:'لمس مستقیم'}).waitFor();await tap('#hero-title','heading');assert.equal(await page.locator('#pro-fontFamily').inputValue(),'Vazirmatn');ok(name,'Preview navigates normally; returning to Edit restores unchanged draft and selection');
  await page.locator('#direct-exit').click();assert.equal(await page.locator('.toolbar #save').count(),1);assert.equal(await page.locator('.inspector #selection-inspector').count(),1);
  await page.reload();await ready();await page.locator('#direct-edit-toggle').click();await tap('#hero-title','heading');assert.equal(await page.locator('#text').inputValue(),'لمس مستقیم · Direct editing');assert.equal(await page.locator('#pro-fontFamily').inputValue(),'Vazirmatn');ok(name,'exit restores original controls; refresh restores saved text/font/history');
  // Chromium offers a real native touch sequence API. WebKit tap above is native;
  // physical iOS scrolling/inertia is deliberately not claimed by this test.
  if(engine===chromium&&options.hasTouch){
   await close();await frame().locator('body').evaluate(()=>scrollTo(0,0));const before=(await draft()).history;
   const session=await context.newCDPSession(page),r=await page.locator('.canvas-hit-plane').boundingBox(),x=r.x+r.width*.7,y=r.y+r.height*.65;
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*18}]});
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok(await frame().locator('body').evaluate(()=>scrollY)>60);assert.deepEqual((await draft()).history,before);ok(name,'native touch swipe scrolls actual iframe without dragging content or changing history');
   await frame().locator('body').evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelector('#page').contentDocument.querySelectorAll('[data-move]').length===0);assert.equal(await page.locator('#element-id').innerText(),titleId);ok(name,'offscreen selection keeps its identity without leaving a floating drag handle over other content');
   await page.locator('#direct-element').selectOption(titleId);await close();
   async function dragHandle(selector,dx,dy){
    const box=await frame().locator(selector).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    assert.ok(box.width>=43&&box.height>=43);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/5,y:y+dy*i/5}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await saved();
   }
   const original=(await draft()).history.present.elements.find(e=>e.id===titleId);
   await dragHandle('[data-move]',12,25);const moved=(await draft()).history.present.elements.find(e=>e.id===titleId);assert.notDeepEqual(moved.layouts,original.layouts);
   await page.locator('#undo').click();await saved();assert.deepEqual((await draft()).history.present.elements.find(e=>e.id===titleId).layouts,original.layouts);
   await dragHandle('[data-resize=se]',-20,12);assert.notDeepEqual((await draft()).history.present.elements.find(e=>e.id===titleId).layouts,original.layouts);await page.locator('#undo').click();await saved();
   ok(name,'44px explicit touch move/resize handles mutate layout; Undo restores it');
  }
  await close();await page.locator('#direct-element').selectOption(titleId);await page.locator('#selection-inspector').waitFor({state:'visible'});assert.equal(await page.locator('#element-id').innerText(),titleId);ok(name,'accessible element selector works independently of pointer hit testing');
  await close();await page.locator('.canvas-hit-plane').focus();await page.keyboard.press('Enter');await page.locator('#selection-inspector').waitFor({state:'visible'});await page.keyboard.press('Escape');assert.equal(await page.locator('#selection-inspector').isVisible(),false);ok(name,'keyboard Enter opens contextual editing; Escape closes without deselection');
  await page.locator('#direct-exit').click();await page.locator('[data-block=cards]').click();await saved();const cardsId=await page.locator('#element-id').innerText();
  if(name==='chromium-desktop'){await page.locator('#mode-advanced').click();await page.locator('#pro-fontFamily').selectOption('Inter');await saved();await page.locator('#mode-simple').click();}
  await page.locator('#direct-edit-toggle').click();
  await tap(`[data-builder-id="${cardsId}"] h3`,'heading');const nestedId=await page.locator('#element-id').innerText();assert.notEqual(nestedId,cardsId);await page.locator('#select-parent').click();assert.equal(await page.locator('#selection-inspector').getAttribute('data-selection-type'),'container');assert.notEqual(await page.locator('#element-id').innerText(),nestedId);ok(name,'native tap reaches nested block text and parent action selects its safe container');
  if(name==='chromium-desktop'){
   await page.locator('#direct-element').selectOption(nestedId);assert.equal(await page.locator('#pro-fontFamily').inputValue(),'');
   assert.ok(await page.locator('#font-preview').evaluate(async n=>(await document.fonts.load('20px Inter',n.textContent)).length)>0);
   assert.ok((await page.locator('#font-preview').evaluate(n=>getComputedStyle(n).fontFamily)).includes('Inter'));
   assert.equal((await draft()).history.present.elements.find(e=>e.id===nestedId).style.fontFamily,undefined);ok(name,'font sample loads the actual inherited container family without adding a child override');
  }
  if(name==='chromium-touch'){
   await page.locator('#direct-element').selectOption(nestedId);const durable=(await draft()).history;
   await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.__task14Fail=true;IDBObjectStore.prototype.put=function(value,key){const q=put.call(this,value,key);if(window.__task14Fail&&key==='local:public/index.html')this.transaction.abort();return q;};});
   await page.locator('#text').fill('بازیابی تمام‌صفحه');await page.locator('#draft-recovery').waitFor();assert.deepEqual((await draft()).history,durable);
   const download=page.waitForEvent('download');await page.locator('#draft-save-export').click();const exported=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));assert.ok(exported.history.present.elements.some(e=>e.content.text==='بازیابی تمام‌صفحه'));
   await page.evaluate(()=>{window.__task14Fail=false;});await page.locator('#draft-save-retry').click();await saved();await page.locator('#draft-recovery').waitFor({state:'hidden'});ok(name,'full-screen storage failure keeps durable draft; visible recovery JSON and retry retain newest work');
  }
  await page.locator('#direct-exit').click();await page.locator('#page-selector').selectOption('public/en/index.html');await frame().locator('#hero-title').filter({hasText:'Beyond Towels'}).waitFor();
  await page.locator('#direct-edit-toggle').click();await tap('#hero-title','heading');assert.equal(await frame().locator('html').getAttribute('dir'),'ltr');assert.equal(await page.locator('html').getAttribute('dir'),'rtl');ok(name,'English LTR page retains native selection within the Persian RTL editor');
  if(name==='chromium-touch'){
   await page.setViewportSize({width:320,height:700});await page.waitForFunction(()=>document.querySelector('#page').getBoundingClientRect().width===320);await tap('#hero-title','heading');
   await page.locator('#text').focus();await page.setViewportSize({width:320,height:420});await page.waitForFunction(()=>{const r=document.querySelector('#text').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;});
   assert.equal(await page.locator('#text').evaluate(n=>getComputedStyle(n).fontSize),'16px');await page.screenshot({path:path.join(folder,'compact-viewport-input.png')});ok(name,'320px layout and reduced available viewport keep text input readable and reachable (keyboard geometry simulation)');
  }
 }catch(e){await page.screenshot({path:path.join(folder,'direct-edit-failure-'+name+'.png')});throw e;}finally{await browser.close();}
}
assert.ok((await fs.readFile('public/index.html')).equals(original));assert.deepEqual(errors,[]);
await fs.writeFile(path.join(folder,'direct-edit-report.json'),JSON.stringify({passed:true,results,errors,physicalDevices:false,localOnly:true,isolatedRoot:root},null,2));console.log(JSON.stringify({passed:results.length,errors:0,physicalDevices:false}));
}catch(error){if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:path.join(folder,'direct-edit-failure.png')}).catch(()=>{});await fs.writeFile(path.join(folder,'direct-edit-failure.json'),JSON.stringify({results,errors,error:error.stack},null,2));throw error;}
finally{await new Promise(r=>server.close(r));}
