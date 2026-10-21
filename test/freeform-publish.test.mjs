import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {githubSimulation} from './github-simulation.mjs';
import {builderPage,publishBuilder,previewBuilder} from '../src/builder.js';
import {preparePage,pageAction} from '../src/pages.js';
import {BLOCKS,createBlock} from '../public/admin/builder/blocks.js';
import {clone,validModel,History,encodeDraft,decodeDraft} from '../public/admin/builder/model.js';
const admin={username:'fixture-admin',role:'admin'};
async function preparedModel(repo,slug='freeform-fixture'){
 const p=await preparePage(repo,{slug,title:'صفحه ساخته‌شده',description:'توضیح صفحه جدید',template:'blank'});
 const base=builderPage(p.content,p.revision,p.path);base.model.base.creation=p.creation;base.model.page=p.creation.page;return base;
}
test('all core blocks publish atomically to a new real page, reload as v2 and retain independent responsive tree state',async()=>{
 const {repo,state}=await githubSimulation(),base=await preparedModel(repo),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
 for(const block of BLOCKS)model.elements.push(...createBlock(block.id,{anchor}));
 const root=model.elements.find(e=>e.kind==='columns');root.style={display:'grid',gridColumns:2,padding:24};root.responsiveStyles={tablet:{gap:12},mobile:{gridColumns:1,padding:8}};
 assert.equal(validModel(model,base.model,base.anchors),true);
 const result=await publishBuilder(repo,{model,requestId:crypto.randomUUID()},admin,false);
 assert.equal(result.path,'public/freeform-fixture/index.html');assert.equal(state.commits.length,1);
 const content=(await repo.read(result.path)).content,doc=parseHTML(content).document;
 assert.equal(doc.querySelectorAll('main h1').length,1);assert.equal(doc.title,model.page.title);
 assert.ok(doc.querySelector('[data-builder-kind=faq-item]>summary'));
 assert.ok(doc.querySelector('script[src="/builder-blocks.js"]'));
 assert.equal(doc.querySelectorAll('[data-builder-overlay]').length,0);
 assert.ok(doc.querySelector('#builder-layout').textContent.includes('max-width:1023px'));
 const reloaded=builderPage(content,(await repo.read(result.path)).sha,result.path);
 assert.equal(reloaded.model.schemaVersion,2);assert.equal(reloaded.model.page.id,model.page.id);
 const second=reloaded.model.elements.find(e=>e.id===root.id);assert.deepEqual(second.responsiveStyles,root.responsiveStyles);
 for(const e of model.elements.filter(e=>!e.source))assert.equal(reloaded.model.elements.find(n=>n.id===e.id)?.parentId,e.parentId);
 assert.ok(state.files.has('public/builder-pages.json'));assert.ok((await repo.read('public/sitemap.xml')).content.includes('/freeform-fixture/'));
 const updated=clone(reloaded.model);updated.elements.find(e=>e.id===root.id).style.borderRadius=18;
 await publishBuilder(repo,{model:updated,requestId:crypto.randomUUID()},admin,false);
 assert.equal(state.commits.length,2);
});
test('preview uses the exact publisher with no commit, files, navigation or registry mutation',async()=>{
 const {repo,state}=await githubSimulation(),base=await preparedModel(repo,'preview-only'),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
 model.elements.push(...createBlock('faq',{anchor}),...createBlock('gallery',{anchor}));
 const before=state.head,files=[...state.files];
 const result=await previewBuilder(repo,model,{username:'fixture-admin',role:'admin'});
 assert.equal(result.draft,true);assert.equal(state.head,before);assert.equal(state.commits.length,0);assert.deepEqual([...state.files],files);
 const doc=parseHTML(result.html).document;assert.ok(doc.querySelector('details>summary'));assert.ok(doc.querySelector('[data-builder-kind=gallery] img'));assert.equal(doc.title,'صفحه ساخته‌شده');
});
test('published managed page can be archived, restored, deleted and restored with actual GitHub null-tree operations',async()=>{
 const {repo,state}=await githubSimulation(),base=await preparedModel(repo,'recover-page');
 await publishBuilder(repo,{model:base.model,requestId:crypto.randomUUID()},admin,false);
 const path=base.model.base.path;
 for(const action of ['archive','restore','delete','restore']){
  await pageAction(repo,{head:state.head,path,action,confirm:path,requestId:crypto.randomUUID()},admin,false);
  assert.equal(state.files.has(path),action==='restore');
 }
 assert.equal(parseHTML((await repo.read(path)).content).document.title,'صفحه ساخته‌شده');
});
test('malicious hierarchy and CSS never publish, and v1 import migration preserves all undo states on a current page',async()=>{
 const {repo,state}=await githubSimulation(),file=await repo.read('public/index.html'),base=builderPage(file.content,file.sha),model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
 const nodes=createBlock('columns',{anchor});model.elements.push(...nodes);nodes[0].parentId=nodes[1].id;
 await assert.rejects(()=>publishBuilder(repo,{model,requestId:crypto.randomUUID()},admin,false));assert.equal(state.commits.length,0);
 const legacy={schemaVersion:1,base:base.model.base,elements:base.model.elements.map(e=>{const x=clone(e);delete x.parentId;delete x.layoutMode;delete x.responsiveStyles;delete x.responsiveInheritance;delete x.layouts.tablet;return x;})};
 const h=new History(legacy);for(let i=0;i<120;i++){const next=clone(h.present);next.elements.find(e=>e.type==='heading').content.text='تغییر '+i;h.commit(next);}
 const raw=JSON.parse(encodeDraft(h));raw.version=1;const restored=decodeDraft(JSON.stringify(raw),base.model,base.anchors);
 assert.equal(restored.past.length,120);assert.equal(restored.present.schemaVersion,2);for(let i=0;i<120;i++)assert.ok(restored.undo());assert.equal(restored.present.base.revision,file.sha);
});

test('import cannot remove original section protection or move the site header/footer into main',async()=>{
 const {repo,state}=await githubSimulation(),file=await repo.read('public/index.html'),base=builderPage(file.content,file.sha),protectedSections=base.model.sections.filter(s=>s.protected);
 assert.ok(protectedSections.length>=2,'real home header and footer must remain protected');
 for(const section of protectedSections){
  for(const forged of [false,undefined]){
   const model=clone(base.model),target=model.sections.find(s=>s.id===section.id);
   if(forged===undefined)delete target.protected;else target.protected=forged;
   assert.equal(validModel(model,base.model,base.anchors),false);
   await assert.rejects(()=>publishBuilder(repo,{model,requestId:crypto.randomUUID()},admin,false));
   assert.equal(state.commits.length,0);
   assert.equal((await repo.read('public/index.html')).content,file.content);
  }
 }
 const model=clone(base.model),anchor=model.sections.find(s=>!s.protected).id;
 model.elements.push(...createBlock('section',{anchor}));
 await publishBuilder(repo,{model,requestId:crypto.randomUUID()},admin,false);
 const doc=parseHTML((await repo.read('public/index.html')).content).document;
 assert.equal(doc.querySelector('header.site-header').parentElement.localName,'body');
 assert.equal(doc.querySelector('footer').parentElement.localName,'body');
 assert.equal(doc.querySelectorAll('main header.site-header,main footer').length,0);
 assert.ok(doc.querySelector('main [data-builder-created][data-builder-kind=section]'));
 assert.equal(state.commits.length,1);
});
