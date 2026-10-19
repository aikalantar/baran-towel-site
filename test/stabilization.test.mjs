import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {preparePage,pageAction} from '../src/pages.js';
import {builderPage,publishBuilder} from '../src/builder.js';
import {githubSimulation} from './github-simulation.mjs';
import {cloudflareDeployment,providerURL} from '../src/deployment.js';
import {GitHubRepository} from '../src/github.js';
import {createDraftSafety} from '../public/admin/draft-safety.js';
import {publicationMessage} from '../public/admin/builder/publication-status.js';

test('FA/EN blank hero content pages publish valid inherited contacts and delete without changing nine originals',async()=>{
 const {repo,state}=await githubSimulation(),originals=new Map([...state.files].filter(([p])=>p.endsWith('/index.html')&&!p.startsWith('public/admin/'))),user={username:'fixture-admin',role:'admin'};
 for(const language of ['fa','en'])for(const template of ['blank','hero','content']){
  const prepared=await preparePage(repo,{language,template,slug:`stable-${language}-${template}`,title:'Stable generated page'}),page=builderPage(prepared.content,'new',prepared.path);page.model.base.creation=prepared.creation;page.model.page=prepared.creation.page;
  const preparedDoc=parseHTML(prepared.content).document;
  for(const a of preparedDoc.querySelectorAll('.primary-nav a,.drawer-nav a'))if(a.textContent.trim().match(/تماس|Contact/i))assert.equal(a.getAttribute('href'),language==='en'?'/en/#partnership':'/#partnership');
  await publishBuilder(repo,{model:page.model,requestId:crypto.randomUUID()},user,false);
  const doc=parseHTML(state.files.get(prepared.path).toString()).document;
  for(const a of doc.querySelectorAll('a[href^="#"]')){const id=decodeURIComponent(a.getAttribute('href').slice(1));assert.ok(!id||doc.getElementById(id),`Dangling fragment ${a.getAttribute('href')}`);}
  for(const a of doc.querySelectorAll('a[href$="#partnership"]')){const url=new URL(a.getAttribute('href'),'https://luxtowelco.com/'+prepared.path.slice(7));const target='public'+url.pathname+'index.html';assert.ok(parseHTML(state.files.get(target).toString()).document.getElementById('partnership'));}
  await pageAction(repo,{path:prepared.path,head:await repo.head(),action:'delete',confirm:prepared.path,requestId:crypto.randomUUID()},user,false);assert.equal(state.files.has(prepared.path),false);
 }
 for(const [p,bytes]of originals)assert.ok(state.files.get(p).equals(bytes),p);
});
test('duplicating keeps local anchors when their target remains and source HTML is never edited',async()=>{
 const {repo,state}=await githubSimulation(),before=state.files.get('public/index.html').toString();
 const prepared=await preparePage(repo,{sourcePath:'public/index.html',language:'fa',slug:'stable-duplicate',title:'Duplicate'});
 const doc=parseHTML(prepared.content).document;assert.ok(doc.getElementById('partnership'));assert.ok([...doc.querySelectorAll('.primary-nav a')].some(a=>a.getAttribute('href')==='#partnership'));assert.equal(state.files.get('public/index.html').toString(),before);
});
test('an older prepared model with inherited broken contact fragments is repaired at publication and reopens correctly',async()=>{
 const {repo,state}=await githubSimulation(),prepared=await preparePage(repo,{slug:'older-contact-draft',title:'Older draft'}),page=builderPage(prepared.content,'new',prepared.path);page.model.base.creation=prepared.creation;page.model.page=prepared.creation.page;
 const contacts=page.model.elements.filter(e=>e.type==='button'&&e.content.href==='/#partnership');assert.ok(contacts.length);for(const e of contacts)e.content.href='#partnership';
 await publishBuilder(repo,{model:page.model,requestId:crypto.randomUUID()},{username:'fixture-admin',role:'admin'},false);
 const html=state.files.get(prepared.path).toString(),reopened=builderPage(html,'b'.repeat(40),prepared.path);assert.ok(reopened.model.elements.filter(e=>e.type==='button'&&/تماس/.test(e.content.text)).every(e=>e.content.href!=='#partnership'));
});
test('persistence guard warns only for unacknowledged edits and never acknowledges a newer edit with an older completion',()=>{
 const listeners=new Set(),target={addEventListener:(name,fn)=>{assert.equal(name,'beforeunload');listeners.add(fn);},removeEventListener:(name,fn)=>listeners.delete(fn)},guard=createDraftSafety(target);
 assert.equal(guard.atRisk,false);assert.equal(listeners.size,0);const first=guard.changed();guard.changed();assert.equal(listeners.size,1);guard.saved(first);assert.equal(guard.atRisk,true);
 let prevented=false,event={preventDefault:()=>prevented=true};[...listeners][0](event);assert.equal(prevented,true);assert.equal(event.returnValue,'');guard.saved(guard.revision);assert.equal(guard.atRisk,false);assert.equal(listeners.size,0);
 guard.changed();guard.reset();assert.equal(guard.atRisk,false);guard.busy(true);assert.equal(listeners.size,1);guard.busy(false);assert.equal(listeners.size,0);
});

const sha='a'.repeat(40),version='11111111-1111-4111-8111-111111111111',env={CMS_CF_ACCOUNT_ID:'b'.repeat(32),CMS_CF_WORKER_NAME:'fixture-worker',CMS_CF_API_TOKEN:'fixture-provider-secret'};
async function providerCase(scenario){
 const original=globalThis.fetch,calls=[];let reads=0;
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),method:options.method||'GET'});assert.equal(options.headers.Authorization,'Bearer fixture-provider-secret');let result;
  assert.equal(options.redirect,'manual');if(scenario==='redirect')return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});
  if(scenario==='denied')return new Response('{}',{status:403});
  if(String(url).endsWith('/workers/domains'))result=[{hostname:'luxtowelco.com',service:scenario==='wrong-domain'?'preview-worker':'fixture-worker',environment:'production'}];
  else if(String(url).includes('/deployments')){reads++;result={deployments:[{id:scenario==='race'&&reads>1?'new-deployment':'deployment',created_on:'2026-10-19T10:00:00Z',versions:scenario==='split'?[{version_id:version,percentage:50},{version_id:'other',percentage:50}]:[{version_id:version,percentage:100}]}]};}
  else result={builds:{[scenario==='wrong-version'?'other':version]:{build_outcome:scenario==='failed'?'fail':'success',...(scenario==='preview'?{pull_request:{pull_request_url:'https://github.com/fixture/repo/pull/1'}}:{}),build_trigger_metadata:{commit_hash:scenario==='wrong-commit'?'c'.repeat(40):sha,branch:scenario==='branch'?'preview':'main',provider_type:'github',provider_account_name:scenario==='repo'?'other':'fixture',repo_name:'repo'}}}};
  return Response.json({success:true,result});};
 try{return {result:await cloudflareDeployment(env,sha,'fixture/repo','main'),calls};}finally{globalThis.fetch=original;}
}
test('Cloudflare success requires active 100% Worker version mapped by the provider to the exact repository branch and commit',async()=>{const {result,calls}=await providerCase('success');assert.equal(result.deployment,'success');assert.equal(result.version,version);assert.equal(result.traffic,100);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.method==='GET'));assert.ok(!JSON.stringify(result).includes(env.CMS_CF_API_TOKEN));});
for(const scenario of ['wrong-commit','wrong-version','wrong-domain','repo','branch','preview','split','failed','denied','redirect','race'])test(`Cloudflare ${scenario} never produces false deployment success`,async()=>{const {result}=await providerCase(scenario);assert.notEqual(result?.deployment,'success');assert.ok(result.reason);});
test('unconfigured verification makes no provider requests and credential-bearing URLs never reach the UI',async()=>{assert.equal(await cloudflareDeployment({},sha,'fixture/repo','main'),null);for(const url of ['https://evil.invalid/log','https://user:secret@dash.cloudflare.com/log','https://dash.cloudflare.com/log?token=secret','javascript:alert(1)'])assert.equal(providerURL(url),null);assert.equal(providerURL('https://dash.cloudflare.com/log'),'https://dash.cloudflare.com/log');});
test('publication UI separates a committed page from verified deployment and explains unavailable evidence without false failure',()=>{const unknown=publicationMessage({commit:'committed',deployment:'unknown'});assert.match(unknown,/GitHub/);assert.match(unknown,/دوباره منتشر نکنید/);assert.match(unknown,/به‌معنای شکست/);assert.doesNotMatch(publicationMessage({commit:'committed',deployment:'success'}),/production با شواهد/);assert.match(publicationMessage({commit:'committed',deployment:'success',evidence:'cloudflare-active-production-version',version}),/production با شواهد/);});
test('repository retains committed evidence when optional provider fails and never returns its credentials',async()=>{const repo=new GitHubRepository({...env,CMS_REPOSITORY:'fixture/repo',CMS_GITHUB_TOKEN:'fixture'});repo.call=async path=>path.startsWith('git/commits')?{sha}:{object:{sha}};const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:403});try{const result=await repo.publicationStatus(sha);assert.equal(result.commit,'committed');assert.equal(result.deployment,'unknown');assert.equal(result.reason,'provider_verification_unavailable');assert.ok(!JSON.stringify(result).includes(env.CMS_CF_API_TOKEN));}finally{globalThis.fetch=original;}});
