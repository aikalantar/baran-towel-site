// A controlled Chrome lab sample, not a Lighthouse score or field CWV report.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startLocal} from '../scripts/cms-local.mjs';
import {createBlock} from '../public/admin/builder/blocks.js';
import {writeAuditReport} from '../scripts/audit-redact.mjs';

const folder=path.resolve('.cms-local/task6-qa');await fs.mkdir(folder,{recursive:true});const sandbox=await fs.mkdtemp(path.join(folder,'performance-'));
await fs.cp('public',path.join(sandbox,'public'),{recursive:true});const server=await startLocal(sandbox,0),origin=`http://127.0.0.1:${server.address().port}`;
const api=async(endpoint,body)=>{const response=await fetch(origin+'/api/cms'+endpoint,{method:'POST',headers:{Origin:origin,'X-CMS-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
const prepared=await api('/builder/pages/prepare',{slug:'task6-performance',title:'بررسی آزمایشگاهی',description:'صفحهٔ محلی برای سنجش محدود مرورگر',template:'blank'}),model=prepared.model,anchor=model.sections.find(s=>!s.protected).id;
for(const kind of ['hero','cards','gallery','faq'])model.elements.push(...createBlock(kind,{anchor}));await api('/builder/publish',{model,requestId:crypto.randomUUID()});
const browser=await chromium.launch({channel:'chrome',headless:true}),samples=[];let blockedExternal=0;
try{
 for(const width of [1440,390])for(const route of ['/','/catalog/','/task6-performance/']){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],failedAssets=[];
  await context.route('**/*',request=>{if(new URL(request.request().url()).origin===origin)return request.continue();blockedExternal++;return request.abort();});
  await context.addInitScript(()=>{window.labMetrics={lcp:null,cls:0,observers:[]};for(const type of ['largest-contentful-paint','layout-shift'])try{const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(type==='largest-contentful-paint')window.labMetrics.lcp=entry.startTime;else if(!entry.hadRecentInput)window.labMetrics.cls+=entry.value;});observer.observe({type,buffered:true});window.labMetrics.observers.push(observer);}catch{}});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400)failedAssets.push({path:new URL(response.url()).pathname,status:response.status()});});
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(origin+route,{waitUntil:'load',timeout:90000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1200);assert.ok(await page.locator('main').isVisible());
  const metrics=await page.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0],resources=performance.getEntriesByType('resource');return {domContentLoadedMs:Math.round(nav.domContentLoadedEventEnd),loadMs:Math.round(nav.loadEventEnd),lcpMs:window.labMetrics.lcp===null?null:Math.round(window.labMetrics.lcp),cls:Number(window.labMetrics.cls.toFixed(4)),transferredBytes:resources.reduce((sum,r)=>sum+r.transferSize,0),resourceCount:resources.length,viewportImages:[...document.images].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0;}).map(n=>({loaded:n.complete&&n.naturalWidth>0,alt:n.hasAttribute('alt'),loading:n.loading,highPriority:n.getAttribute('fetchpriority')==='high'}))};});
  assert.deepEqual(failedAssets,[]);assert.deepEqual(errors,[]);assert.ok(metrics.viewportImages.every(image=>image.loaded&&image.alt));samples.push({route,width,...metrics,errors:0,failedAssets:0});console.log(JSON.stringify({route,width,lcpMs:metrics.lcpMs,cls:metrics.cls,loadMs:metrics.loadMs}));await context.close();
 }
 await writeAuditReport(path.join(folder,'performance-report.json'),{labOnly:true,tool:'Chrome PerformanceObserver and CDP',cpuSlowdown:4,network:'local loopback without network throttling',cache:'disabled',sampleWindowAfterLoadMs:1200,lighthouseAvailable:false,notFieldCoreWebVitals:true,samples,blockedExternal,productionChanged:false});
 console.log(JSON.stringify({passed:samples.length,labOnly:true,errors:0,productionChanged:false}));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
