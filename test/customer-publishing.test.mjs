import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {protectedCustomerRegion} from '../public/admin/builder/customer-capabilities.js';
import {handleCMS} from '../src/cms-worker.js';
import {login,passwordHash,bytes64} from '../src/auth.js';
import {githubSimulation} from './github-simulation.mjs';
import {builderPage,publishBuilder} from '../src/builder.js';
import {describePage,readContacts} from '../src/content.js';
import {createBlock} from '../public/admin/builder/blocks.js';
import {imageInfo} from '../public/admin/builder/image-format.js';
import {scopedRepository,contentUser} from '../src/cms-permissions.js';
const origin='https://luxtowelco.com',admin={username:'owner',role:'admin'};
const auth=(async()=>{const accounts=[];for(const role of ['admin','editor']){const salt=bytes64(crypto.getRandomValues(new Uint8Array(24)));accounts.push({username:'publish-'+role,role,salt,hash:await passwordHash('task185-fixture-only',salt)});}const env={CMS_USERS:JSON.stringify(accounts),CMS_SESSION_SECRET:'task185-fixture-only-'.repeat(4),CMS_REPOSITORY:'fixture/isolated',CMS_BRANCH:'main',CMS_GITHUB_TOKEN:'fixture-only',CMS_GUARD:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}},cookies={};for(const a of accounts)cookies[a.role]=(await login(new Request(origin+'/api/cms/login'),env,{username:a.username,password:'task185-fixture-only'})).split(';')[0];return {env,cookies};})();
const request=(endpoint,cookie,body,headers={},host=origin)=>new Request(host+'/api/cms'+endpoint,{method:body===undefined?'GET':'POST',headers:{Origin:host,'X-CMS-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
async function api(repo,endpoint,body,role='editor',overrides={},headers={}){const {env,cookies}=await auth;const r=await handleCMS(request(endpoint,cookies[role],body,headers),{...env,...overrides},{repo});return {status:r.status,data:await r.json()};}
const page=async(repo,path='public/index.html')=>{const f=await repo.read(path);return builderPage(f.content,f.sha,path);};
const editableImage=model=>model.elements.find(e=>e.type==='image'&&!protectedCustomerRegion(model,e.id));
const payload=model=>({model:structuredClone(model),requestId:crypto.randomUUID()});
const snapshot=state=>({head:state.head,files:[...state.files]});
const unchanged=(state,before)=>{assert.equal(state.head,before.head);assert.deepEqual([...state.files],before.files);};
const post=async(repo,endpoint,body,status=200,options={})=>{const r=await api(repo,endpoint,body,'editor',options);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};

test('Task18.5 real editor publishes text, uploaded image, product content and safe retry; no credentials in session',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo);p.model.elements.find(e=>e.tag==='h1').content.text='Customer independently published';
 const bytes=await fs.readFile('public/assets/products/mozhan.webp'),info=imageInfo(bytes),image=editableImage(p.model);image.content={src:'data:image/webp;base64,'+bytes.toString('base64'),alt:'Customer photo',width:info.width,height:info.height};
 const body=payload(p.model);await post(repo,'/builder/publish',body);const commits=state.commits.length;assert.ok(state.files.get('public/index.html').toString().includes('Customer independently published'));
 const replay=await post(repo,'/builder/publish',body);assert.equal(replay.replayed,true);assert.equal(state.commits.length,commits);
 const catalog=await page(repo,'public/catalog/index.html'),title=catalog.model.elements.find(e=>e.tag==='h2');title.content.text='Customer product';editableImage(catalog.model).content.src='/assets/products/teyho.webp';await post(repo,'/builder/publish',payload(catalog.model));
 assert.ok(state.files.get('public/catalog/index.html').toString().includes('Customer product'));
 const metadata=await page(repo,'public/catalog/index.html'),target=editableImage(metadata.model),intrinsic=imageInfo(await repo.readBytes('public'+target.content.src,await repo.head()));target.content.width=1;target.content.height=8000;await post(repo,'/builder/publish',payload(metadata.model));const normalized=JSON.parse(parseHTML((await repo.read('public/catalog/index.html')).content).document.querySelector('#builder-state').textContent).elements.find(e=>e.id===target.id);assert.equal(normalized.content.width,intrinsic.width);assert.equal(normalized.content.height,intrinsic.height);
 const session=await api(repo,'/session');assert.equal(session.data.permissions.publish,true);assert.equal(session.data.permissions.studio,false);assert.ok(!JSON.stringify(session.data).includes('CMS_GITHUB_TOKEN'));assert.ok(!JSON.stringify(session.data).includes('fixture-only'));
});
test('Task18.5 editor creates, renames, archives, restores and deletes only authorized managed pages',async()=>{
 const {repo,state}=await githubSimulation();const p=await post(repo,'/builder/pages/prepare',{slug:'customer-owned',title:'Customer page',description:'Plain page',template:'blank'});await post(repo,'/builder/publish',payload(p.model));const path=p.model.base.path;
 for(const action of ['rename','archive','restore','delete','restore']){await post(repo,'/builder/pages/action',{path,action,head:await repo.head(),requestId:crypto.randomUUID(),...(action==='rename'?{title:'Customer renamed'}:{confirm:path})});}
 assert.ok(state.files.has(path));assert.ok(state.files.get(path).toString().includes('Customer renamed'));
 const before=snapshot(state);for(const action of ['slug','menu','metadata'])await post(repo,'/builder/pages/action',{path,action,head:state.head,requestId:crypto.randomUUID()},403);unchanged(state,before);
 const response=await api(repo,'/builder/pages/action',{path:'public/index.html',action:'delete',head:state.head,requestId:crypto.randomUUID(),confirm:'public/index.html'});assert.equal(response.status,409);unchanged(state,before);
});
test('Task18.5 editor cannot publish crafted design, technical metadata, blocks, sources or unlock flags',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo),before=snapshot(state);
 const attacks=[m=>m.elements[0].style.color='#123456',m=>m.elements[0].layouts.mobile.width=80,m=>m.elements[0].locked=true,m=>m.sections[1].order+=1,m=>m.page.menu.included=!m.page.menu.included,m=>m.page.robots=m.page.robots==='index'?'noindex':'index',m=>m.page.canonical=origin+'/other/',m=>m.elements.push(...createBlock('heading',{anchor:m.sections[1].id})),m=>m.elements[0].source.selector='body',m=>m.elements[0].content.technicalSetting='forged'];
 for(const attack of attacks){const m=structuredClone(p.model);attack(m);const r=await api(repo,'/builder/publish',payload(m));assert.ok([400,403].includes(r.status),JSON.stringify(r));unchanged(state,before);}
 await post(repo,'/builder/publish',{...payload(p.model),unlockIds:['section-0']},403);unchanged(state,before);
});
test('Task18.5 persisted locks and admin receipts cannot be bypassed by editor JSON, legacy or contact paths',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo),h=p.model.elements.find(e=>e.tag==='h1');h.locked=true;const adminBody=payload(p.model);await publishBuilder(repo,adminBody,admin,false);let before=snapshot(state);
 await post(repo,'/builder/publish',adminBody,403);unchanged(state,before);
 const fresh=await page(repo);fresh.model.elements.find(e=>e.id===h.id).content.text='Locked changed';await post(repo,'/builder/publish',payload(fresh.model),403);await post(repo,'/builder/publish',{...payload(fresh.model),unlockIds:[h.id]},403);unchanged(state,before);
 const f=await repo.read('public/index.html'),field=describePage(f.content,'public/index.html',f.sha).fields.find(e=>e.label==='عنوان اصلی');await post(repo,'/publish',{path:'public/index.html',revision:f.sha,updates:[{id:field.id,value:'Forbidden legacy'}]},403);unchanged(state,before);
 const c=await page(repo,'public/catalog/index.html'),product=c.model.elements.find(e=>c.html.includes('sanam')&&e.tag==='h2');product.locked=true;await publishBuilder(repo,payload(c.model),admin,false);before=snapshot(state);const cf=await repo.read('public/catalog/index.html');await post(repo,'/publish',{path:'public/catalog/index.html',revision:cf.sha,operations:[{type:'duplicate',id:'sanam',newId:'blocked',name:'Blocked'}]},403);unchanged(state,before);
 const home=await page(repo),email=home.model.sections.find(e=>e.id===home.anchors.at(-1).id);email.locked=true;await publishBuilder(repo,payload(home.model),admin,false);before=snapshot(state);const values=readContacts((await repo.read('public/index.html')).content);values.email='blocked@example.test';await post(repo,'/contacts',{head:state.head,values},403);unchanged(state,before);
});
test('Task18.5 legacy product operations preserve Task17 identities; legacy style operations and dimension forgery fail',async()=>{
 const {repo,state}=await githubSimulation();await publishBuilder(repo,payload((await page(repo,'public/catalog/index.html')).model),admin,false);
 const bodyFor=async operations=>({path:'public/catalog/index.html',revision:(await repo.read('public/catalog/index.html')).sha,operations});
 await post(repo,'/publish',await bodyFor([{type:'duplicate',id:'sanam',newId:'customer-copy',name:'Customer duplicate'}]));let reopened=await page(repo,'public/catalog/index.html');assert.equal(new Set(reopened.model.elements.map(e=>e.id)).size,reopened.model.elements.length);assert.ok(reopened.html.includes('Customer duplicate'));
 await post(repo,'/publish',await bodyFor([{type:'up',id:'customer-copy'}]));await post(repo,'/publish',await bodyFor([{type:'remove',id:'customer-copy'}]));assert.ok(!(await page(repo,'public/catalog/index.html')).html.includes('id="customer-copy"'));
 const before=snapshot(state);await post(repo,'/publish',await bodyFor([{type:'style',id:'sanam',style:{color:'#123456'}}]),403);unchanged(state,before);
 const shell=await repo.read('public/catalog/index.html'),logo=describePage(shell.content,'public/catalog/index.html',shell.sha).fields.find(e=>e.kind==='image');await post(repo,'/publish',{path:'public/catalog/index.html',revision:shell.sha,updates:[{id:logo.id,value:logo.value,alt:'Forbidden shell change'}],operations:[{type:'up',id:'sanam'}]},403);unchanged(state,before);
 const file=await repo.read('public/catalog/index.html'),field=describePage(file.content,'public/catalog/index.html',file.sha).fields.find(e=>e.kind==='image'&&e.model);await post(repo,'/publish',{path:'public/catalog/index.html',revision:file.sha,updates:[{id:field.id,value:'/assets/products/teyho.webp',width:1,height:8000}]},403);unchanged(state,before);
});
test('Task18.5 genuine editor publishes global contacts, respects CAS and can publish a safe content rollback',async()=>{
 const {repo,state}=await githubSimulation(),initial=await repo.head(),values=readContacts((await repo.read('public/index.html')).content);values.email='owner-published@example.test';await post(repo,'/contacts',{head:initial,values});const before=snapshot(state);await post(repo,'/contacts',{head:initial,values},409);unchanged(state,before);
 for(const path of [...state.files.keys()].filter(p=>/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(p)&&!p.startsWith('public/admin/'))){assert.ok(state.files.get(path).toString().includes(values.email));await page(repo,path);}
 let p=await page(repo),old=p.model.elements.find(e=>e.tag==='h1').content.text;const priorHead=state.head;p.model.elements.find(e=>e.tag==='h1').content.text='Temporary customer content';await post(repo,'/builder/publish',payload(p.model));
 const historic=await api(repo,'/builder?path=public%2Findex.html&ref='+priorHead);assert.equal(historic.status,200);await post(repo,'/builder/publish',payload(historic.data.model));assert.equal((await page(repo)).model.elements.find(e=>e.tag==='h1').content.text,old);
 const latest=await page(repo);latest.model.elements.find(e=>e.tag==='h1').style.padding=44;await publishBuilder(repo,payload(latest.model),admin,false);const snapshotBefore=snapshot(state),unsafe=await api(repo,'/builder?path=public%2Findex.html&ref='+priorHead);await post(repo,'/builder/publish',payload(unsafe.data.model),403);unchanged(state,snapshotBefore);
 const legacy=await api(repo,'/publish',{path:'public/index.html',revision:(await repo.read('public/index.html')).sha,restoreCommit:priorHead});assert.equal(legacy.status,403);unchanged(state,snapshotBefore);
});
test('Task18.5 server policy scopes reads, content writes, creation, contacts and derived page side effects',async()=>{
 const {repo,state}=await githubSimulation(),policy={CMS_EDITOR_ACCESS:JSON.stringify({'publish-editor':{site:origin,repository:'fixture/isolated',pages:['public/catalog/index.html'],createPages:false,contacts:false,pageActions:[]}})};
 for(const endpoint of ['/builder?path=public%2Findex.html','/page?path=public%2Findex.html','/history?path=public%2Findex.html','/builder/pages?path=public%2Findex.html','/contacts'])assert.equal((await api(repo,endpoint,undefined,'editor',policy)).status,403,endpoint);
 const library=await api(repo,'/library',undefined,'editor',policy);assert.deepEqual(library.data.pages.map(p=>p.path),['public/catalog/index.html']);
 const c=await page(repo,'public/catalog/index.html');c.model.elements.find(e=>e.tag==='h1').content.text='Scoped catalog';await post(repo,'/builder/publish',payload(c.model),200,policy);
 const before=snapshot(state),home=await page(repo);await post(repo,'/builder/publish',{...payload(home.model),permissions:{publish:true},contentAccess:{pages:['*']},site:'other'},403,policy);
 await post(repo,'/builder/pages/prepare',{slug:'out-of-scope',title:'Blocked'},403,policy);const contacts=readContacts((await repo.read('public/index.html')).content);await post(repo,'/contacts',{head:state.head,values:contacts},403,policy);unchanged(state,before);
 const derived=await post(repo,'/builder/pages/prepare',{slug:'derived-protection',title:'Derived'},200);derived.model.page.menu.included=true;await publishBuilder(repo,payload(derived.model),admin,false);
 const restricted={CMS_EDITOR_ACCESS:JSON.stringify({'publish-editor':{pages:[derived.model.base.path]}})},prior=snapshot(state);await post(repo,'/builder/pages/action',{path:derived.model.base.path,action:'archive',confirm:derived.model.base.path,head:state.head,requestId:crypto.randomUUID()},403,restricted);unchanged(state,prior);
});
test('Task18.5 installation-bound session prevents cross-origin/site/repository/branch reuse even with identical credentials',async()=>{
 const {repo,state}=await githubSimulation(),{env,cookies}=await auth,before=snapshot(state),body=payload((await page(repo)).model);
 for(const override of [{CMS_REPOSITORY:'another/customer'},{CMS_SITE_ID:'another-site'},{CMS_BRANCH:'another-branch'}])assert.equal((await handleCMS(request('/builder/publish',cookies.editor,body),{...env,...override},{repo})).status,401);
 assert.equal((await handleCMS(request('/builder/publish',cookies.editor,body,{},'https://another.example'),env,{repo})).status,401);
 for(const headers of [{Origin:'https://attacker.example'},{Origin:'null'},{'X-CMS-Request':''}])assert.equal((await api(repo,'/builder/publish',body,'editor',{},headers)).status,403);unchanged(state,before);
});
test('Task18.5 policy changes are immediate, malformed policies fail closed, and no infrastructure write is available',async()=>{
 const {repo,state}=await githubSimulation(),before=snapshot(state);
 for(const value of ['{','[]','{}',JSON.stringify({'publish-editor':{pages:['public/admin/index.html']}}),JSON.stringify({'publish-editor':{page:['public/catalog/index.html']}}),JSON.stringify({'publish-editor':{site:'other'}})])assert.equal((await api(repo,'/library',undefined,'editor',{CMS_EDITOR_ACCESS:value})).status,403);
 const actor=contentUser({username:'publish-editor',role:'editor'},{}),scoped=scopedRepository(repo,actor);
 for(const path of ['public/admin/index.html','public/_headers','public/_redirects','public/script.df5cebe557.js','wrangler.jsonc','.dev.vars'])await assert.rejects(()=>scoped.commit(state.head,[{path,content:'forged'}],'forged'),e=>e.status===403||e.status===400);unchanged(state,before);
 const body=payload((await page(repo)).model);await post(repo,'/builder/publish',body,403,{CMS_EDITOR_ACCESS:JSON.stringify({'publish-editor':{pages:['public/catalog/index.html']}})});unchanged(state,before);
});
test('Task18.5 failed and racing editor publications preserve repository state and retry without force',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo);p.model.elements.find(e=>e.tag==='h1').content.text='Retry after failure';const body=payload(p.model),before=snapshot(state);state.fail=true;const failure=await api(repo,'/builder/publish',body);assert.equal(failure.status,502);unchanged(state,before);state.fail=false;state.race=true;await post(repo,'/builder/publish',body,409);unchanged(state,before);state.race=false;await post(repo,'/builder/publish',body);const count=state.commits.length;await post(repo,'/builder/publish',body);assert.equal(state.commits.length,count);
});
