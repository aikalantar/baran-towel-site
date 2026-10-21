import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {githubSimulation} from './github-simulation.mjs';
import {builderPage,publishBuilder,previewBuilder} from '../src/builder.js';
import {preparePage,pageAction,listPages} from '../src/pages.js';
import {handleCMS} from '../src/cms-worker.js';
import {passwordHash,login,bytes64} from '../src/auth.js';
import {clone} from '../public/admin/builder/model.js';
import {createBlock} from '../public/admin/builder/blocks.js';

const admin={username:'fixture-admin',role:'admin'},origin='https://luxtowelco.com';
const bodyFor=model=>({model,requestId:crypto.randomUUID()});
const pageFor=async(repo,path='public/index.html')=>{const file=await repo.read(path);return builderPage(file.content,file.sha,path);};
async function newModel(repo,slug,language='fa'){
 const prepared=await preparePage(repo,{slug,language,title:language==='fa'?'صفحه آزمون':'Test page',template:'blank'});
 const page=builderPage(prepared.content,prepared.revision,prepared.path);
 page.model.base.creation=prepared.creation;page.model.page=prepared.creation.page;return page;
}
const action=async(repo,path,op,options={})=>pageAction(repo,{head:await repo.head(),path,action:op,confirm:path,requestId:crypto.randomUUID(),...options},admin,false);
const unchanged=(state,before)=>{assert.equal(state.head,before.head);assert.deepEqual([...state.files],before.files);};
const snapshot=state=>({head:state.head,files:[...state.files]});
const authFixture=(async()=>{
 const accounts=[];
 for(const role of ['admin','editor']){const account={username:`fixture-${role}`,role,salt:bytes64(crypto.getRandomValues(new Uint8Array(24)))};account.hash=await passwordHash('fixture-only-password',account.salt);accounts.push(account);}
 const env={CMS_USERS:JSON.stringify(accounts),CMS_SESSION_SECRET:'fixture-session-only-'.repeat(4),CMS_GITHUB_TOKEN:'fixture-only',CMS_GUARD:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
 const cookies={};for(const account of accounts)cookies[account.role]=(await login(new Request(origin+'/api/cms/login'),env,{username:account.username,password:'fixture-only-password'})).split(';')[0];
 return {env,cookies};
})();
function request(endpoint,{method='POST',cookie,body,raw,headers={}}={}){
 return new Request(origin+'/api/cms'+endpoint,{method,headers:{Origin:origin,'X-CMS-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(method!=='GET'?{body:raw??JSON.stringify(body)}:{})});
}

test('Task6 API: anonymous access, forbidden editor design, cross-site and missing CSRF markers cannot mutate; preview is read-only',async()=>{
 const {repo,state}=await githubSimulation(),base=await pageFor(repo),{env,cookies}=await authFixture,before=snapshot(state);
 for(const endpoint of ['/builder','/builder/pages','/library','/history?path=public%2Findex.html'])assert.equal((await handleCMS(request(endpoint,{method:'GET'}),env,{repo})).status,401,endpoint);
 for(const endpoint of ['/builder/publish','/builder/pages/action']){
  assert.equal((await handleCMS(request(endpoint,{body:bodyFor(base.model)}),env,{repo})).status,401);
  assert.equal((await handleCMS(request(endpoint,{cookie:cookies.editor,body:endpoint==='/builder/pages/action'?{path:'public/index.html',action:'slug'}:bodyFor({...base.model,elements:base.model.elements.map((e,i)=>i?e:{...e,style:{...e.style,color:'#123456'}})})}),env,{repo})).status,403);
 }
 for(const headers of [{Origin:'https://attacker.invalid'},{Origin:'null'},{Origin:''},{'X-CMS-Request':''}])assert.equal((await handleCMS(request('/builder/publish',{cookie:cookies.admin,body:bodyFor(base.model),headers}),env,{repo})).status,403);
 assert.equal((await handleCMS(request('/builder/preview',{cookie:cookies.editor,body:{model:base.model}}),env,{repo})).status,200);
 assert.equal((await handleCMS(request('/builder/pages/prepare',{cookie:cookies.editor,body:{slug:'editor-safe-draft'}}),env,{repo})).status,200);
 unchanged(state,before);
});

test('Task6 API: malformed JSON, wrong MIME, oversized bodies and unsafe page paths fail before any write',async()=>{
 const {repo,state}=await githubSimulation(),{env,cookies}=await authFixture,before=snapshot(state);
 for(const raw of ['{','null','[]','{"model":{"base":{"path":"../.dev.vars"}}}']){
  const response=await handleCMS(request('/builder/publish',{cookie:cookies.admin,raw}),env,{repo});assert.ok(response.status>=400&&response.status<500);
 }
 assert.equal((await handleCMS(request('/builder/publish',{cookie:cookies.admin,raw:'{}',headers:{'Content-Type':'text/plain'}}),env,{repo})).status,415);
 assert.equal((await handleCMS(request('/builder/preview',{cookie:cookies.admin,raw:' '.repeat(16*1024*1024+1)}),env,{repo})).status,413);
 for(const path of ['public/admin/index.html','public/../index.html','../.dev.vars','public/en/../../index.html'])assert.equal((await handleCMS(request('/builder?path='+encodeURIComponent(path),{method:'GET',cookie:cookies.admin}),env,{repo})).status,400);
 unchanged(state,before);
});

test('Task6 API: 24 malicious CSS, URL, nesting, image, ID and protected-structure payloads preserve all repository files',async()=>{
 const {repo,state}=await githubSimulation(),base=await pageFor(repo),{env,cookies}=await authFixture,before=snapshot(state);
 const image=m=>m.elements.find(e=>e.type==='image'),button=m=>m.elements.find(e=>e.type==='button'),section=m=>m.sections.find(s=>s.protected);
 const attacks=[
  m=>m.elements[0].style.color='red;display:none',m=>m.elements[0].style.backgroundImage='url(javascript:evil())',m=>m.elements[0].responsiveStyles.mobile={fontSize:'16;}'},
  m=>m.elements[0].style.opacity=2,m=>m.elements[0].layouts.desktop.width=-1,m=>m.elements[0].layouts.mobile.heightUnit='expression(evil())',
  m=>m.elements[0].id='new-x"]{}',m=>m.elements[1].id=m.elements[0].id,m=>m.elements[0].parentId=m.elements[0].id,m=>m.elements[0].parentId='new-nonexistent',
  m=>m.elements[0].source.selector='body',m=>m.elements[0].parentId=m.elements.find(e=>e.type==='image').id,
  m=>button(m).content.href='javascript:evil()',m=>button(m).content.href='//attacker.invalid',m=>button(m).content.href='/\\attacker.invalid',
  m=>image(m).content.src='/assets/missing-image.png',m=>image(m).content.src='/assets/../../.dev.vars.png',m=>image(m).content.src='data:image/svg+xml;base64,PHN2Zy8+',
  m=>image(m).content.src='data:image/png;base64,'+Buffer.from('<svg onload="evil()"/>').toString('base64'),m=>image(m).content.variants=[null],
  m=>section(m).deleted=true,m=>section(m).protected=false,m=>section(m).order+=1,m=>m.elements.push({...clone(m.elements[0]),id:'new-forged-source'}),
 ];
 assert.equal(attacks.length,24);
 for(const [i,attack] of attacks.entries()){
  const model=clone(base.model);attack(model);
  const response=await handleCMS(request('/builder/publish',{cookie:cookies.admin,body:bodyFor(model)}),env,{repo});
  assert.ok(response.status>=400&&response.status<500,`negative case ${i}: ${response.status}`);unchanged(state,before);
 }
});

test('Task6 text publication escapes script/style/event payloads and rich links while retaining literal customer text',async()=>{
 const {repo,state}=await githubSimulation(),base=await pageFor(repo),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
 const block=createBlock('richtext',{anchor}),text=block.find(e=>e.type==='text'),literal='</script><script>evil()</script><img src=x onerror=evil()><style>body{display:none}</style>';
 text.content.text=literal;text.content.runs=[{text:literal,bold:true,href:'/catalog/'}];model.elements.push(...block);
 await publishBuilder(repo,bodyFor(model),admin,false);
 const doc=parseHTML((await repo.read('public/index.html')).content).document,node=doc.querySelector(`[data-builder-id="${text.id}"]`);
 assert.equal(node.textContent,literal);assert.equal(node.querySelectorAll('script,img,style,[onerror]').length,0);assert.equal(node.querySelector('a').getAttribute('href'),'/catalog/');
 assert.equal(doc.querySelectorAll('script#builder-state[type="application/json"]').length,1);assert.equal(state.commits.length,1);
});

test('Task6 creation-descriptor forgery cannot reclassify or overwrite any of the nine original protected pages; legitimate new-page retry remains idempotent',async()=>{
 const {repo,state}=await githubSimulation(),prepared=await newModel(repo,'creation-descriptor'),before=snapshot(state);
 const originals=[...state.files.keys()].filter(p=>p.endsWith('/index.html')&&!p.startsWith('public/admin/'));assert.equal(originals.length,9);
 for(const path of originals){const model=(await pageFor(repo,path)).model;model.base.creation=clone(prepared.model.base.creation);model.base.creation.path=path;await assert.rejects(()=>publishBuilder(repo,bodyFor(model),admin,false),e=>e.status===409);unchanged(state,before);}
 const body=bodyFor(prepared.model);await publishBuilder(repo,body,admin,false);assert.equal(state.commits.length,1);
 assert.equal((await publishBuilder(repo,body,admin,false)).replayed,true);assert.equal(state.commits.length,1);
 assert.equal((await listPages(repo)).pages.find(p=>p.path==='public/index.html').managed,false);
});

test('Task6 persisted locked containers reject child edit/style/delete/insert/reparent API bypasses and permit an explicit unlock',async()=>{
 const {repo,state}=await githubSimulation(),base=await newModel(repo,'persisted-lock'),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
 const nodes=createBlock('cards',{anchor}),owner=nodes[0],child=nodes.find(e=>e.type==='text');model.elements.push(...nodes);owner.locked=true;
 await publishBuilder(repo,bodyFor(model),admin,false);
 const persisted=(await pageFor(repo,model.base.path)).model,before=snapshot(state);
 const changes=[m=>m.elements.find(e=>e.id===child.id).content.text='bypass',m=>m.elements.find(e=>e.id===child.id).style.color='#ffffff',m=>m.elements.find(e=>e.id===child.id).deleted=true,m=>m.elements.find(e=>e.id===child.id).parentId=anchor,m=>m.elements.push(...createBlock('heading',{anchor,parentId:owner.id})),m=>m.elements.find(e=>e.id===owner.id).style.padding=5];
 for(const change of changes){const next=clone(persisted);change(next);await assert.rejects(()=>publishBuilder(repo,bodyFor(next),admin,false));unchanged(state,before);}
 const unlocked=clone(persisted);unlocked.elements.find(e=>e.id===owner.id).locked=false;unlocked.elements.find(e=>e.id===child.id).content.text='explicit unlocked edit';
 await publishBuilder(repo,bodyFor(unlocked),admin,false);assert.equal(state.commits.length,2);
 const output=(await pageFor(repo,model.base.path)).model;assert.equal(output.elements.find(e=>e.id===child.id).content.text,'explicit unlocked edit');
});

test('Task6 explicit unlock intent supports unlock/edit/relock without extra commits and is strict, receipt-bound and preview-safe',async()=>{
 const {repo,state}=await githubSimulation(),base=await newModel(repo,'lock-intent'),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id,nodes=createBlock('cards',{anchor}),owner=nodes[0],child=nodes.find(e=>e.type==='text');
 owner.locked=true;model.elements.push(...nodes);await publishBuilder(repo,bodyFor(model),admin,false);
 const next=(await pageFor(repo,model.base.path)).model;next.elements.find(e=>e.id===child.id).content.text='edited after unlock then relocked';const before=snapshot(state);
 for(const unlockIds of ['invalid',[owner.id,owner.id],['new-unknown'],[anchor],[null]]){await assert.rejects(()=>publishBuilder(repo,{...bodyFor(next),unlockIds},admin,false));unchanged(state,before);}
 const body={...bodyFor(next),unlockIds:[owner.id]},preview=await previewBuilder(repo,next,admin,body.unlockIds);assert.ok(preview.html.includes('edited after unlock then relocked'));unchanged(state,before);
 await publishBuilder(repo,body,admin,false);assert.equal(state.commits.length,2);const after=snapshot(state);
 assert.equal((await publishBuilder(repo,body,admin,false)).replayed,true);unchanged(state,after);
 await assert.rejects(()=>publishBuilder(repo,{...body,unlockIds:[]},admin,false),e=>e.status===409);unchanged(state,after);
 assert.equal((await pageFor(repo,model.base.path)).model.elements.find(e=>e.id===owner.id).locked,true);
});

test('Task6 Persian and English managed-page lifecycle updates real HTML, menu, canonical, links, sitemap and redirects without changing original content',async()=>{
 const {repo,state}=await githubSimulation(),originals=new Map([...state.files].filter(([p])=>p.endsWith('/index.html')&&!p.startsWith('public/admin/')));
 for(const language of ['fa','en']){
  const before=await newModel(repo,`route-before-${language}`,language);await publishBuilder(repo,bodyFor(before.model),admin,false);
  const source=before.model.base.path,duplicate=await preparePage(repo,{slug:`route-copy-${language}`,language,sourcePath:source,kind:'duplicate',title:'Duplicate'});
  const copy=builderPage(duplicate.content,'new',duplicate.path);copy.model.base.creation=duplicate.creation;copy.model.page=duplicate.creation.page;await publishBuilder(repo,bodyFor(copy.model),admin,false);
  await action(repo,source,'menu',{menu:{included:true,label:language==='fa'?'پیوند جدید':'New link',order:3}});
  await action(repo,source,'rename',{title:language==='fa'?'عنوان جدید':'New title'});
  const home=language==='en'?'public/en/index.html':'public/index.html',homeDoc=parseHTML((await repo.read(home)).content).document;
  assert.ok(homeDoc.querySelector(`.primary-nav a[href="/${language==='en'?'en/':''}route-before-${language}/"]`));
  const result=await action(repo,source,'slug',{slug:`route-after-${language}`,updateLinks:true}),doc=parseHTML((await repo.read(result.path)).content).document;
  assert.equal(doc.documentElement.lang,language);assert.equal(doc.documentElement.dir,language==='fa'?'rtl':'ltr');assert.equal(doc.querySelector('link[rel="canonical"]').href,origin+result.route);
  assert.ok((await repo.read('public/sitemap.xml')).content.includes(origin+result.route));assert.equal((await repo.read('public/sitemap.xml')).content.includes(origin+'/'+(language==='en'?'en/':'')+`route-before-${language}/`),false);
  const impact=(await listPages(repo,result.path)).impact;assert.equal(impact.redirects.length,3);
  for(const operation of ['archive','delete']){const beforeAction=snapshot(state);await assert.rejects(()=>action(repo,result.path,operation),e=>e.status===409&&e.message.includes('تغییرمسیر'));unchanged(state,beforeAction);}
  const original=(await repo.read(duplicate.path)).content;
  for(const operation of ['archive','restore','delete','restore']){await action(repo,duplicate.path,operation);assert.equal(state.files.has(duplicate.path),operation==='restore');}
  assert.equal((await repo.read(duplicate.path)).content,original);
 }
 for(const [path,bytes] of originals){const before=parseHTML(bytes.toString()).document,after=parseHTML((await repo.read(path)).content).document;assert.equal(after.querySelector('main').innerHTML,before.querySelector('main').innerHTML);assert.equal(after.title,before.title);}
});

test('Task6 page actions reject missing OG assets and immutable-ID changes atomically; stale CAS and reused IDs preserve valid pages',async()=>{
 const {repo,state}=await githubSimulation(),base=await newModel(repo,'metadata-protection');await publishBuilder(repo,bodyFor(base.model),admin,false);
 const before=snapshot(state),path=base.model.base.path;
 for(const page of [{ogImage:'/assets/nonexistent-og.png'},{id:'page-forged-new-identity'}]){await assert.rejects(()=>action(repo,path,'metadata',{page}));unchanged(state,before);}
 await assert.rejects(()=>action(repo,path,'rename',{head:'a'.repeat(40),title:'stale'}),e=>e.status===409);unchanged(state,before);
 const body={head:state.head,path,action:'rename',title:'Safe changed title',requestId:crypto.randomUUID()};await pageAction(repo,body,admin,false);const after=snapshot(state);
 assert.equal((await pageAction(repo,body,admin,false)).replayed,true);unchanged(state,after);
 await assert.rejects(()=>pageAction(repo,{...body,title:'forged retry'},admin,false),e=>e.status===409);unchanged(state,after);
});

test('Task6 isolated publishing retains atomic CAS on a racing ref and a no-write preview even for uploaded images',async()=>{
 const {repo,state}=await githubSimulation(),base=await pageFor(repo),model=clone(base.model),image=model.elements.find(e=>e.type==='image');
 image.content={src:'data:image/png;base64,'+(await fs.readFile('public/favicon-32x32-v2.png')).toString('base64'),alt:'safe uploaded preview'};
 const before=snapshot(state),result=await previewBuilder(repo,model,admin);assert.ok(result.html.includes('data:image/png;base64,'));unchanged(state,before);assert.equal(state.commits.length,0);
 state.race=true;await assert.rejects(()=>publishBuilder(repo,bodyFor(model),admin,false),e=>e.status===409);unchanged(state,before);
});

test('Task6 public image priorities: generated hero gets one eager/high image, remaining gallery images stay lazy, existing LCP remains unique',async()=>{
 for(const fresh of [true,false]){
  const {repo,state}=await githubSimulation(),base=fresh?await newModel(repo,'image-priorities'):await pageFor(repo),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
  model.elements.push(...createBlock('gallery',{anchor}),...createBlock('hero',{anchor}));
  await publishBuilder(repo,bodyFor(model),admin,false);
  const doc=parseHTML((await repo.read(model.base.path)).content).document,high=[...doc.querySelectorAll('main img[fetchpriority="high"]')];
  assert.equal(high.length,1);assert.ok([null,'eager'].includes(high[0].getAttribute('loading')),'missing loading uses the native eager default');
  const added=[...doc.querySelectorAll('main img[data-builder-created]')];assert.ok(added.length>=4);
  for(const img of added.filter(n=>n!==high[0]))assert.equal(img.getAttribute('loading'),'lazy');
  if(fresh)assert.ok(high[0].closest('[data-builder-kind="hero"]'));else assert.ok(high[0].classList.contains('hero-media'));
  // Reproduce the old V2 publication metadata and verify republishing repairs
  // generated priorities without altering the site's original LCP image.
  for(const img of doc.querySelectorAll('main img[data-builder-created]')){img.setAttribute('fetchpriority','high');img.setAttribute('loading','eager');}
  state.files.set(model.base.path,Buffer.from(doc.toString()));
  state.snapshots.set(state.head,new Map(state.files));
  const reloaded=(await pageFor(repo,model.base.path)).model;await publishBuilder(repo,bodyFor(reloaded),admin,false);
  const repaired=parseHTML((await repo.read(model.base.path)).content).document;assert.equal(repaired.querySelectorAll('main img[fetchpriority="high"]').length,1);
  for(const image of repaired.querySelectorAll('main img[data-builder-created]:not([fetchpriority="high"])'))assert.equal(image.getAttribute('loading'),'lazy');
 }
});
