import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {handleCMS} from '../src/cms-worker.js';
import {login,passwordHash,bytes64} from '../src/auth.js';
import {builderPage,publishBuilder} from '../src/builder.js';
import {githubSimulation} from './github-simulation.mjs';
import {customerCanAdd,customerContentNode,customerSetStyle,customerCanRemove,customerCanStyle} from '../public/admin/builder/customer-capabilities.js';
import {clone,History,encodeDraft,decodeDraft} from '../public/admin/builder/model.js';
const origin='https://luxtowelco.com';
const authentication=(async()=>{const salt=bytes64(crypto.getRandomValues(new Uint8Array(24))),env={CMS_USERS:JSON.stringify([{username:'customer',role:'editor',salt,hash:await passwordHash('fixture-task186-only',salt)}]),CMS_SESSION_SECRET:'task186-session-fixture-'.repeat(4),CMS_REPOSITORY:'fixture/isolated',CMS_BRANCH:'main',CMS_GITHUB_TOKEN:'fixture-only',CMS_GUARD:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}};const cookie=(await login(new Request(origin+'/api/cms/login'),env,{username:'customer',password:'fixture-task186-only'})).split(';')[0];return {env,cookie};})();
const page=async(repo,path='public/index.html')=>{const f=await repo.read(path);const p=builderPage(f.content,f.sha,path);p.document=parseHTML(p.html).document;return p;};
const body=model=>({model:clone(model),requestId:crypto.randomUUID()});
async function api(repo,model,status=200,endpoint='/builder/publish',overrides={}){const {env,cookie}=await authentication;const r=await handleCMS(new Request(origin+'/api/cms'+endpoint,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CMS-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body(model))}),{...env,...overrides},{repo});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
const anchor=(m,doc)=>m.sections.find(s=>customerCanAdd(m,s.id,doc)).id;
const unchanged=(state,head,files)=>{assert.equal(state.head,head);assert.deepEqual([...state.files],files);};

test('Task18.6 genuine editor publishes safe typography and colors through the shared preview/publisher',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo),h=p.model.elements.find(e=>e.tag==='h1'),geometry=clone(h.layouts);
 for(const [key,value]of Object.entries({fontFamily:'Estedad',fontSize:36,fontWeight:700,color:'#123456',backgroundColor:'#faf5e0',textAlign:'center'}))customerSetStyle(p.model,h.id,key,value);
 const before=state.head;const preview=await api(repo,p.model,200,'/builder/preview');assert.match(preview.html,/font-family:"Estedad"/);assert.equal(state.head,before);
 await api(repo,p.model);const reopened=await page(repo),heading=reopened.model.elements.find(e=>e.id===h.id);assert.deepEqual(heading.style,h.style);assert.deepEqual(heading.layouts,geometry);
 const html=(await repo.read('public/index.html')).content;assert.match(html,/estedad-variable\.woff2/);assert.match(html,/font-size:36px/);assert.match(html,/background-color:#faf5e0/);
});
test('Task18.6 simple additions publish as the existing V2 nodes, remain editable in Studio and can be removed safely',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo),parent=anchor(p.model,p.document),ids=[];
 for(const kind of ['heading','richtext','image','button']){const e=customerContentNode(p.model,kind,parent,p.document);if(e.type!=='image'){e.content.text='Customer '+kind;delete e.content.runs;}p.model.elements.push(e);ids.push(e.id);}
 const history=new History(p.model);history.commit(clone(p.model));const draft=decodeDraft(encodeDraft(history),p.model,p.anchors);assert.equal(draft.present.schemaVersion,2);
 await api(repo,p.model);const reopened=await page(repo);assert.equal(new Set(reopened.model.elements.map(e=>e.id)).size,reopened.model.elements.length);
 for(const id of ids){const e=reopened.model.elements.find(e=>e.id===id);assert.equal(e.layoutMode,'flow');assert.equal(e.source,null);assert.equal(customerCanRemove(reopened.model,id,reopened.document),true);}
 const remove=clone(reopened.model);remove.elements.find(e=>e.id===ids[0]).deleted=true;await api(repo,remove);assert.ok(!(await repo.read('public/index.html')).content.includes('data-builder-id="'+ids[0]+'"'));
 // Designer keeps its existing full controls on exactly the same document.
 const studio=await page(repo);studio.model.elements.find(e=>e.id===ids[1]).style.padding=30;await publishBuilder(repo,body(studio.model),{username:'designer',role:'admin'},false);assert.equal((await page(repo)).model.elements.find(e=>e.id===ids[1]).style.padding,30);
 assert.ok(state.commits.length>=3);
});
test('Task18.6 crafted visual/structural payloads and fake simple nodes cannot widen customer permissions',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo),id=p.model.elements.find(e=>e.tag==='h1').id,head=state.head,files=[...state.files];
 const attacks=[m=>m.elements[0].content.alt='Protected logo changed',m=>m.elements.find(e=>e.id===id).style.fontSize=120,m=>m.elements.find(e=>e.id===id).style.fontWeight=100,m=>m.elements.find(e=>e.id===id).style.opacity=0,m=>m.elements.find(e=>e.id===id).style.padding=20,m=>m.elements.find(e=>e.id===id).responsiveStyles.mobile.margin=-100,m=>m.elements.find(e=>e.id===id).layouts.mobile.width=20,m=>m.elements.find(e=>e.id===id).deleted=true,m=>m.elements[0].style.color='#112233'];
 for(const attack of attacks){const m=clone(p.model);attack(m);await api(repo,m,403);unchanged(state,head,files);}
 for(const forge of [e=>e.layoutMode='free',e=>e.layouts.desktop.x=10,e=>e.parentId='page',e=>e.order=0,e=>delete e.order,e=>e.source={selector:'body'},e=>e.style.maxHeight=1,e=>e.responsiveStyles.mobile={display:'grid'},e=>e.kind='hero',e=>{e.parentId=p.model.elements.find(n=>n.tag==='h1').anchor;e.anchor=e.parentId;e.order=9999;}]){
  const m=clone(p.model),e=customerContentNode(m,'richtext',anchor(m,p.document),p.document);forge(e);m.elements.push(e);const {env,cookie}=await authentication;const r=await handleCMS(new Request(origin+'/api/cms/builder/publish',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CMS-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body(m))}),env,{repo});assert.ok([400,403].includes(r.status),await r.text());unchanged(state,head,files);
 }
 const parent=anchor(p.model,p.document),addition=customerContentNode(p.model,'richtext',parent,p.document),complex=clone(p.model),free=complex.elements.find(e=>e.anchor===parent&&e.movable!==false);free.free=true;free.layoutMode='free';await publishBuilder(repo,body(complex),{username:'designer',role:'admin'},false);const current=await page(repo),prior=state.head,priorFiles=[...state.files];assert.equal(customerCanAdd(current.model,parent,current.document),false);current.model.elements.push(addition);await api(repo,current.model,403);unchanged(state,prior,priorFiles);
});
test('Task18.6 locks, protected regions, ownership and historical advanced design still bind safe editing',async()=>{
 const {repo,state}=await githubSimulation(),p=await page(repo),parent=anchor(p.model,p.document),h=p.model.elements.find(e=>e.tag==='h1');p.model.sections.filter(e=>[parent,h.anchor].includes(e.id)).forEach(e=>e.locked=true);
 await publishBuilder(repo,body(p.model),{username:'designer',role:'admin'},false);const locked=await page(repo),head=state.head,files=[...state.files];locked.model.elements.find(e=>e.id===h.id).style.color='#123456';await api(repo,locked.model,403);unchanged(state,head,files);
 const forged=clone(locked.model);forged.elements.push({...customerContentNode({...p.model,sections:p.model.sections.map(s=>({...s,locked:false}))},'heading',parent,p.document),anchor:parent,parentId:parent});await api(repo,forged,403);unchanged(state,head,files);
 const free=await page(repo);free.model.sections.filter(e=>[parent,h.anchor].includes(e.id)).forEach(e=>e.locked=false);await publishBuilder(repo,body(free.model),{username:'designer',role:'admin'},false);
 const scoped=await page(repo);customerSetStyle(scoped.model,h.id,'color','#123456');await api(repo,scoped.model,403,'/builder/publish',{CMS_EDITOR_ACCESS:JSON.stringify({customer:{pages:['public/catalog/index.html']}})});
 const protectedId=scoped.model.elements.find(e=>!customerCanStyle(scoped.model,e.id)).id;assert.throws(()=>customerSetStyle(scoped.model,protectedId,'color','#123456'));
});
test('Task18.6 simple appearance resets responsive overrides without changing geometry; undo and draft recovery remain shared',async()=>{
 const {repo}=await githubSimulation(),p=await page(repo),e=p.model.elements.find(e=>e.tag==='h1');e.responsiveStyles.mobile={fontSize:22,marginTop:12};e.style.padding=8;
 await publishBuilder(repo,body(p.model),{username:'designer',role:'admin'},false);const current=await page(repo),h=current.model.elements.find(n=>n.id===e.id),history=new History(current.model),next=clone(current.model);
 customerSetStyle(next,h.id,'fontSize',30);assert.equal(next.elements.find(n=>n.id===h.id).responsiveStyles.mobile.fontSize,undefined);assert.equal(next.elements.find(n=>n.id===h.id).responsiveStyles.mobile.marginTop,12);
 assert.throws(()=>customerSetStyle(next,h.id,'padding',undefined));
 history.commit(next);assert.ok(history.undo());assert.equal(history.present.elements.find(n=>n.id===h.id).responsiveStyles.mobile.fontSize,22);assert.ok(history.redo());const restored=decodeDraft(encodeDraft(history),current.model,current.anchors);assert.deepEqual(restored.serialize(),history.serialize());await api(repo,restored.present);
 const fresh=await page(repo);customerSetStyle(fresh.model,h.id,'fontSize',undefined);await api(repo,fresh.model);assert.equal((await page(repo)).model.elements.find(n=>n.id===h.id).style.padding,8);
});
