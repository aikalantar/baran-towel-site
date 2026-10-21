import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {builderPage,publishBuilder} from '../src/builder.js';
import {applyChanges,describePage,articleHTML,addArticleToIndex,applyContacts,readContacts} from '../src/content.js';
import {githubSimulation} from './github-simulation.mjs';
import {handleCMS} from '../src/cms-worker.js';
import {History,encodeDraft,decodeDraft,validModel} from '../public/admin/builder/model.js';
import {allocateIdentityMap,remapElementIdentity} from '../public/admin/builder/identity.js';
import {cloneSubtrees} from '../public/admin/builder/pro-controls.js';
import {createBlock} from '../public/admin/builder/blocks.js';
import {imageInfo} from '../public/admin/builder/image-format.js';
import {oldBuilder,realPages} from './migration-fixtures.mjs';

const catalog='public/catalog/index.html',admin={username:'interop-test',role:'admin'};
const read=async(repo,path=catalog)=>{const f=await repo.read(path);return builderPage(f.content,f.sha,path);};
const publish=async(repo,model)=>publishBuilder(repo,{model,requestId:crypto.randomUUID()},admin,false);
async function legacy(repo,path,updates=[],operations=[],restoreCommit){
 const f=await repo.read(path),response=await handleCMS(new Request('http://127.0.0.1:4175/api/cms/publish',{method:'POST',headers:{Origin:'http://127.0.0.1:4175','Content-Type':'application/json','X-CMS-Request':'1'},body:JSON.stringify({path,revision:f.sha,updates,operations,restoreCommit})}),{},{repo,localMode:true});
 const result=await response.json();assert.equal(response.status,200,result.error);return result;
}
const assertUnique=html=>{const doc=parseHTML(html).document,ids=[...doc.querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id'));assert.equal(new Set(ids).size,ids.length);return doc;};

test('Task17 exact regression: Builder catalog publication → Legacy product duplicate → Builder reopen retains unique identities',async()=>{
 const original=await fs.readFile(catalog,'utf8');
 const {repo}=await githubSimulation(),base=await read(repo),model=structuredClone(base.model);
 model.elements.find(e=>e.tag==='h1').content.text+=' · isolated regression';
 await publish(repo,model);
 const f=await repo.read(catalog),before=parseHTML(f.content).document,product=before.querySelector('.product-card');
 const originals=[...product.querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id'));
 assert.equal(originals.length,29,'Same production catalog and same 29 duplicated descendants as Task16');
 const output=applyChanges(f.content,[],[{type:'duplicate',id:product.id,newId:'task17-copy',name:'محصول آزمایشی'}]);
 const doc=parseHTML(output).document,ids=[...doc.querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id'));
 assert.equal(ids.length-new Set(ids).size,0,'Legacy duplication must allocate new IDs instead of copying 29 identities');
 assert.deepEqual([...doc.querySelector('#'+product.id).querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id')),originals);
 const reopened=builderPage(output,'isolated-revision',catalog);
 assert.equal(new Set(reopened.model.elements.map(e=>e.id)).size,reopened.model.elements.length);
 assert.equal(doc.querySelector('#task17-copy h2').textContent,'محصول آزمایشی');
 assert.equal(doc.querySelector('#task17-copy img').getAttribute('srcset'),product.querySelector('img').getAttribute('srcset'),'Unchanged responsive candidates are cloned intact');
 assert.equal(doc.querySelector('link[rel=stylesheet]').outerHTML,before.querySelector('link[rel=stylesheet]').outerHTML);
 assert.equal(await fs.readFile(catalog,'utf8'),original);
});

test('shared allocation rejects collisions/ambiguous sources; nested Builder clones remap parent/anchor/content references without mutation',()=>{
 assert.throws(()=>allocateIdentityMap(['new-a','new-a']));
 assert.throws(()=>allocateIdentityMap(['bad-id']));
 assert.throws(()=>allocateIdentityMap(['new-a'],{reserved:['new-taken'],idFactory:()=> 'new-taken'}));
 const root={id:'new-root',type:'container',kind:'section',tag:'section',parentId:'page',anchor:'new-root',source:null,layoutMode:'flow',layouts:{desktop:{},tablet:{},mobile:{}},style:{},content:{text:''},deleted:false};
 const child={...structuredClone(root),id:'new-child',type:'button',tag:'a',parentId:root.id,content:{text:'link',href:'#new-root'},anchor:root.id};
 const elements=[root,child],before=JSON.stringify(elements);let counter=0;
 const result=cloneSubtrees(elements,[root.id],{idFactory:()=>`new-clone-${++counter}`});
 assert.equal(JSON.stringify(elements),before);assert.equal(result.elements[0].anchor,result.elements[0].id);
 assert.equal(result.elements[1].parentId,result.elements[0].id);assert.equal(result.elements[1].anchor,result.elements[0].id);
 assert.equal(result.elements[1].content.href,'#'+result.elements[0].id);
 const mapped=remapElementIdentity({...child,content:{...child.content,runs:[{text:'link',href:'#new-root'}]}},new Map([['new-root','new-safe']]));
 assert.equal(mapped.content.runs[0].href,'#new-safe');
});

for(const path of [catalog,'public/en/catalog/index.html'])test(`bidirectional real API round trips, product media, rename/move/delete/restore and pinned draft history: ${path}`,async()=>{
 const {repo,state}=await githubSimulation();const original=await repo.read(path);
 if(!describePage(original.content,path,original.sha).models.length){
  // The real English catalog is PDF-based, not a product list. Exercise the
  // same legacy product contract on that route only in this isolated fixture.
  const doc=parseHTML(original.content).document,product=parseHTML((await repo.read(catalog)).content).document.querySelector('.product-card');
  const holder=doc.createElement('section');holder.append(product.cloneNode(true));doc.querySelector('main').append(holder);
  await repo.commit(await repo.head(),[{path,content:doc.toString()}],'English route isolated product fixture');
 }
 // Legacy first, then Builder, then Legacy, then Builder again.
 const first=await repo.read(path),product=describePage(first.content,path,first.sha).models[0];
 await legacy(repo,path,[],[{type:'duplicate',id:product.id,newId:'before-builder',name:'محصول قبل از Builder'}]);
 let base=await read(repo,path),history=new History(base.model);
 const model=structuredClone(base.model),heading=model.elements.find(e=>e.tag==='h1');heading.content.text+=' · round trip';
 const originalDoc=parseHTML((await repo.read(path)).content).document;
 const mediaNode=originalDoc.querySelector('#'+product.id+' img'),image=model.elements.find(e=>e.source?.selector&&originalDoc.querySelector(e.source.selector)===mediaNode);
 image.content={src:'data:image/png;base64,'+(await fs.readFile('public/favicon-32x32-v2.png')).toString('base64'),alt:'responsive interop',variants:[{src:'data:image/png;base64,'+(await fs.readFile('public/favicon-16x16-v2.png')).toString('base64'),width:16,height:16}]};
 image.style={objectFit:'contain',borderRadius:7};image.responsiveStyles={tablet:{borderRadius:9},mobile:{borderRadius:11}};
 history.commit(model);const raw=encodeDraft(history);assert.deepEqual(decodeDraft(raw,base.model,base.anchors).serialize(),history.serialize());
 const builderRequest={model,requestId:crypto.randomUUID()};await publishBuilder(repo,builderRequest,admin,false);const snapshot=state.head,prior=await repo.read(path),doc=assertUnique(prior.content),source=doc.querySelector('#'+product.id),sourceIDs=[...source.querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id'));
 const originalCSS=doc.querySelector('#builder-layout').textContent,styleLink=doc.querySelector('link[rel=stylesheet]').outerHTML;
 assert.match(source.querySelector('img').getAttribute('srcset'),/16w/);assert.match(source.querySelector('img').getAttribute('srcset'),/32w/);
 const replacement='/assets/products/mozhan.webp',dimensions=imageInfo(await fs.readFile('public'+replacement));
 await legacy(repo,path,[],[{type:'duplicate',id:product.id,newId:'after-builder',name:'محصول جدید',image:{value:replacement,width:dimensions.width,height:dimensions.height,alt:'replacement'}}]);
 await assert.rejects(()=>publishBuilder(repo,builderRequest,admin,false),e=>e.status===409,'A stale Builder receipt must not acknowledge a newer Legacy mutation');
 let current=await repo.read(path),after=assertUnique(current.content),copy=after.querySelector('#after-builder');
 assert.deepEqual([...after.querySelector('#'+product.id).querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id')),sourceIDs);
 assert.equal(after.querySelector('#'+product.id+' img').outerHTML,doc.querySelector('#'+product.id+' img').outerHTML);
 assert.ok(after.querySelector('#builder-layout').textContent.startsWith(originalCSS));assert.equal(after.querySelector('link[rel=stylesheet]').outerHTML,styleLink);
 assert.equal(copy.querySelector('img').getAttribute('src'),replacement);assert.equal(copy.querySelector('img').hasAttribute('srcset'),false);
 assert.equal(after.querySelector('meta[name=builder-request]'),null,'Legacy mutation invalidates the old Builder receipt');
 base=await read(repo,path);assert.ok(validModel(base.model,base.model,base.anchors));
 const clonedImage=base.model.elements.find(e=>e.id===copy.querySelector('img').getAttribute('data-builder-id'));
 assert.deepEqual(clonedImage.style,image.style);assert.deepEqual(clonedImage.responsiveStyles,image.responsiveStyles);
 assert.throws(()=>decodeDraft(raw,base.model,base.anchors),'A changed revision must not silently rebase or overwrite the old draft');
 assert.deepEqual(decodeDraft(raw,history.past[0],[]).serialize(),history.serialize());
 for(let i=0;i<2;i++){await publish(repo,(await read(repo,path)).model);assertUnique((await repo.read(path)).content);}
 current=await repo.read(path);const fields=describePage(current.content,path,current.sha).fields;
 const nameField=fields.find(f=>f.model==='after-builder'&&f.kind==='text'&&f.selector.includes('h2'));
 await legacy(repo,path,[{id:nameField.id,value:'نام اصلاح‌شده'}],[{type:'up',id:'after-builder'}]);
 assert.equal(parseHTML((await repo.read(path)).content).document.querySelector('#after-builder h2').textContent,'نام اصلاح‌شده');
 await publish(repo,(await read(repo,path)).model);
 const restore=state.head,restoreIDs=[...assertUnique((await repo.read(path)).content).querySelector('#after-builder').querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id'));
 await legacy(repo,path,[],[{type:'remove',id:'after-builder'}]);assert.equal(assertUnique((await repo.read(path)).content).querySelector('#after-builder'),null);await read(repo,path);
 await legacy(repo,path,[],[],restore);after=assertUnique((await repo.read(path)).content);
 assert.deepEqual([...after.querySelector('#after-builder').querySelectorAll('[data-builder-id]')].map(n=>n.getAttribute('data-builder-id')),restoreIDs);
 await publish(repo,(await read(repo,path)).model);assertUnique((await repo.read(path)).content);
 assert.ok(state.snapshots.has(snapshot));assert.equal(await fs.readFile(path,'utf8'),original.content);
});

test('product clone allocates original section anchors as well as nested element IDs',async()=>{
 const {repo}=await githubSimulation();let f=await repo.read(catalog),doc=parseHTML(f.content).document;
 doc.querySelector('main').append(doc.querySelector('.product-card'));
 await repo.commit(await repo.head(),[{path:catalog,content:doc.toString()}],'isolated direct-section product');
 let base=await read(repo),model=structuredClone(base.model),section=model.sections.find(s=>s.id==='section-sanam');assert.ok(section);section.style={backgroundColor:'#eeeeee'};
 await publish(repo,model);await legacy(repo,catalog,[],[{type:'duplicate',id:'sanam',newId:'section-product-copy',name:'Section copy'}]);
 doc=assertUnique((await repo.read(catalog)).content);const original=doc.querySelector('#sanam'),copy=doc.querySelector('#section-product-copy');assert.notEqual(copy.getAttribute('data-builder-anchor'),original.getAttribute('data-builder-anchor'));
 base=await read(repo);const cloned=base.model.sections.find(s=>s.id===copy.getAttribute('data-builder-anchor'));assert.deepEqual(cloned.style,section.style);assert.ok(base.model.elements.some(e=>e.anchor===cloned.id));
 await publish(repo,base.model);await legacy(repo,catalog,[],[{type:'remove',id:'section-product-copy'}]);assert.equal((await read(repo)).model.sections.some(s=>s.id===cloned.id),false);
});

test('nested generated product clones remap HTML/ARIA/fragments/picture units and state; deletion cannot resurrect descendants',async()=>{
 const {repo}=await githubSimulation(),base=await read(repo),m=structuredClone(base.model),anchor=m.sections.find(s=>s.label.includes('مدل'))?.id||m.sections.find(s=>!s.protected).id;
 const nodes=createBlock('section',{anchor});const root=nodes[0];
 const image=createBlock('image',{anchor,parentId:root.id})[0],button=createBlock('button',{anchor,parentId:root.id})[0];nodes.push(image,button);m.elements.push(...nodes);
 await publish(repo,m);let f=await repo.read(catalog),doc=parseHTML(f.content).document;
 const container=doc.querySelector(`[data-builder-id="${root.id}"]`);container.classList.add('product-card');container.id='nested-product';
 const h=container.querySelector('h2');h.id='nested-title';container.setAttribute('aria-labelledby',h.id);button.content.href='#nested-title';
 container.querySelector('a').setAttribute('href','#nested-title');
 const img=container.querySelector('img'),picture=doc.createElement('picture'),source=doc.createElement('source');source.setAttribute('srcset',img.getAttribute('src')+' 640w');picture.setAttribute('data-builder-unit',image.id);img.before(picture);picture.append(source,img);
 await repo.commit(await repo.head(),[{path:catalog,content:doc.toString()}],'isolated nested product fixture');
 await legacy(repo,catalog,[],[{type:'duplicate',id:'nested-product',newId:'nested-copy',name:'nested copy'}]);
 doc=assertUnique((await repo.read(catalog)).content);const cloned=doc.querySelector('#nested-copy'),original=doc.querySelector('#nested-product');
 assert.notEqual(cloned.querySelector('h2').id,'nested-title');assert.equal(cloned.getAttribute('aria-labelledby'),cloned.querySelector('h2').id);assert.equal(cloned.querySelector('a').getAttribute('href'),'#'+cloned.querySelector('h2').id);
 assert.equal(original.querySelector('h2').id,'nested-title');assert.equal(cloned.querySelector('picture').getAttribute('data-builder-unit'),cloned.querySelector('img').getAttribute('data-builder-id'));
 const next=await read(repo),id=cloned.getAttribute('data-builder-id'),entry=next.model.elements.find(e=>e.id===id);
 assert.equal(entry.source,null);assert.ok(next.model.elements.some(e=>e.parentId===id));assert.ok(validModel(next.model,next.model,next.anchors));
 await publish(repo,next.model);await legacy(repo,catalog,[],[{type:'remove',id:'nested-copy'}]);const reopened=await read(repo);assert.equal(reopened.model.elements.some(e=>e.id===id||e.parentId===id),false);
 assert.ok((await repo.read(catalog)).content.includes('nested-product'));await publish(repo,reopened.model);assert.equal(parseHTML((await repo.read(catalog)).content).document.querySelector('#nested-copy'),null);
});

test('real V1 published state and drafts survive Legacy duplication and V2 migration with existing IDs/styles intact',async()=>{
 const {html,path}=realPages.find(p=>p.path===catalog),old=oldBuilder.builderPage(html,'legacy-revision',path);
 const current=builderPage(html,'legacy-revision',path);assert.deepEqual(current.model.elements.map(e=>e.id),old.model.elements.map(e=>e.id));
 const product=describePage(html,path,'legacy-revision').models[0],output=applyChanges(html,[],[{type:'duplicate',id:product.id,newId:'v1-copy',name:'V1 copy'}]);
 assertUnique(output);const reopened=builderPage(output,'new-legacy-revision',path);assert.ok(validModel(reopened.model,reopened.model,reopened.anchors));
 for(const e of current.model.elements){const next=reopened.model.elements.find(n=>n.id===e.id);if(next)assert.deepEqual(next.style,e.style);}
});

test('malformed or ambiguous persisted identities fail closed without repairing HTML or issuing repository writes',async()=>{
 const {repo,state}=await githubSimulation();await publish(repo,(await read(repo)).model);const original=await repo.read(catalog);
 const changes=[doc=>{const nodes=doc.querySelectorAll('[data-builder-id]');nodes[1].setAttribute('data-builder-id',nodes[0].getAttribute('data-builder-id'));},doc=>doc.querySelector('[data-builder-id]').setAttribute('data-builder-id','bad"selector'),doc=>{const n=doc.querySelector('#builder-state'),s=JSON.parse(n.textContent);s.elements.push(structuredClone(s.elements[0]));n.textContent=JSON.stringify(s);},doc=>doc.querySelector('#builder-state').textContent='{broken',doc=>doc.querySelectorAll('.product-card')[1].id='sanam'];
 for(const change of changes){const doc=parseHTML(original.content).document;change(doc);const bad=doc.toString(),snapshot=state.commits.length;
  assert.throws(()=>builderPage(bad,'revision',catalog),e=>e.status===422);
  assert.throws(()=>applyChanges(bad,[],[{type:'duplicate',id:'sanam',newId:'bad-copy',name:'bad copy'}]),e=>e.status===422);
  assert.equal(doc.toString(),bad);assert.equal(state.commits.length,snapshot);assert.equal((await repo.read(catalog)).content,original.content);
 }
});

test('legacy contact/button edits and article creation after Builder publication do not restore stale hrefs or missing main identities',async()=>{
 const {repo}=await githubSimulation();let base=await read(repo,'public/index.html'),m=structuredClone(base.model),anchor=m.sections.find(s=>!s.protected).id;
 const button=createBlock('button',{anchor})[0];button.content.href='tel:+989192531804';m.elements.push(button);await publish(repo,m);
 let f=await repo.read('public/index.html'),values=readContacts(f.content);values.phone='+989121234567';const contacts=applyContacts(f.content,values);
 const restored=builderPage(contacts,'contact-revision');assert.equal(restored.model.elements.find(e=>e.id===button.id).content.href,'tel:'+values.phone);
 const templatePath='public/blog/rahnamaye-kharid-hole-luxury/index.html';await publish(repo,(await read(repo,templatePath)).model);
 const article=articleHTML((await repo.read(templatePath)).content,{slug:'task17-article',title:'مقاله آزمایشی',description:'توضیح مقاله',body:'متن مقاله\n\n## عنوان بخش',image:'/assets/products/mozhan.webp'});
 assert.ok(builderPage(article.html,'article-revision',article.path).model.elements.some(e=>e.content.text==='مقاله آزمایشی'));
 await publish(repo,(await read(repo,'public/blog/index.html')).model);const index=addArticleToIndex((await repo.read('public/blog/index.html')).content,article);
 assert.ok(builderPage(index,'index-revision','public/blog/index.html').model.elements.some(e=>e.content.text==='مقاله آزمایشی'));
});
