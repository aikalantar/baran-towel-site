import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {builderPage,publishBuilder} from '../src/builder.js';
import {History,clone,migrateModel,validModel,decodeDraft,encodeDraft,effectiveLayout,effectiveStyle,HISTORY_LIMIT} from '../public/admin/builder/model.js';
import {githubSimulation} from './github-simulation.mjs';
import {realPages,oldBuilder,v1,checkpoint} from './migration-fixtures.mjs';

const sameContent=(actual,expected)=>{
 assert.deepEqual(actual.elements.map(e=>e.id),expected.elements.map(e=>e.id));
 for(const old of expected.elements){const item=actual.elements.find(e=>e.id===old.id);assert.deepEqual(item.content,old.content);assert.deepEqual(item.source,old.source);assert.equal(item.anchor,old.anchor);assert.equal(item.parentId,old.anchor);assert.equal(item.deleted,old.deleted);assert.equal(item.z,old.z);assert.equal(item.order,old.order);assert.deepEqual(item.style,old.style);assert.deepEqual(effectiveLayout(item,'desktop'),old.layouts.desktop);assert.deepEqual(effectiveLayout(item,'mobile'),old.layouts.mobile);assert.deepEqual(effectiveLayout(item,'tablet'),old.layouts.desktop);}
};

test('all nine real V1 production pages bootstrap with stable IDs, text/images/links and exact legacy breakpoint values',()=>{
 assert.equal(realPages.length,9);
 let total=0,publishedStates=0;
 for(const {html,path}of realPages){
  const legacy=oldBuilder.builderPage(html,'real-file-revision',path),current=builderPage(html,'real-file-revision',path);
  assert.equal(legacy.model.schemaVersion,1);assert.equal(current.model.schemaVersion,2);sameContent(current.model,legacy.model);total+=current.model.elements.length;
  assert.deepEqual(current.model.base,legacy.model.base);assert.equal(current.model.page.language,path.startsWith('public/en/')?'en':'fa');assert.ok(validModel(legacy.model,current.model,current.anchors),path);
  for(const section of current.model.sections)if(current.anchors.find(a=>a.id===section.id).protected)assert.equal(section.protected,true);
  if(parseHTML(html).document.querySelector('#builder-state'))publishedStates++;
 }
 assert.ok(total>500);assert.ok(publishedStates>0,'Must exercise actual published V1 state, not only untouched templates');
});

test('real V1 120-state mixed history, redo stack, embedded image variants and revision reference migrate losslessly and repeatedly',()=>{
 const {html,path}=realPages.find(p=>p.path==='public/index.html'),legacy=oldBuilder.builderPage(html,'real-file-revision',path),current=builderPage(html,'real-file-revision',path);
 legacy.model.base.restoreCommit=checkpoint;current.model.base.restoreCommit=checkpoint;
 const history=new v1.History(legacy.model),heading=legacy.model.elements.find(e=>e.tag==='h1'),image=legacy.model.elements.find(e=>e.type==='image'),link=legacy.model.elements.find(e=>e.type==='button');
 for(let i=0;i<120;i++){
  const next=clone(history.present),title=next.elements.find(e=>e.id===heading.id),img=next.elements.find(e=>e.id===image.id),button=next.elements.find(e=>e.id===link.id);
  title.content.text='ویرایش مهاجرت '+i;title.layouts.desktop={x:i/4,y:i/8,width:60,height:20};title.layouts.mobile={x:2,y:i/10,width:90,height:15};title.style={fontSize:20+i%30,color:'#123456',textAlign:i%2?'start':'center'};
  img.content={src:'data:image/png;base64,AA==',alt:'تصویر '+i,width:32,height:32,variants:[{src:'data:image/png;base64,AQ==',width:16,height:16}]};button.content.href=i%2?'/catalog/':'/bridal-towels/';
  assert.equal(v1.validModel(next,legacy.model,legacy.anchors),true);history.commit(next);
 }
 for(let i=0;i<13;i++)history.undo();
 const raw=v1.encodeDraft(history),parsed=JSON.parse(raw),before=JSON.stringify(parsed),restored=decodeDraft(raw,current.model,current.anchors);
 assert.equal(restored.past.length,107);assert.equal(restored.future.length,13);assert.equal(restored.present.base.restoreCommit,checkpoint);sameContent(restored.present,history.present);assert.equal(JSON.stringify(parsed),before);
 for(let i=0;i<13;i++){assert.ok(restored.redo());history.redo();sameContent(restored.present,history.present);}
 for(let i=0;i<HISTORY_LIMIT;i++){assert.ok(restored.undo());history.undo();sameContent(restored.present,history.present);}
 assert.equal(restored.undo(),false);assert.equal(history.undo(),false);
 const once=encodeDraft(restored);let recovered=decodeDraft(once,current.model,current.anchors);
 for(let i=0;i<4;i++){const next=decodeDraft(encodeDraft(recovered),current.model,current.anchors);assert.deepEqual(next.serialize(),recovered.serialize());recovered=next;}
 assert.equal(recovered.present.base.restoreCommit,checkpoint);
});

test('malformed, unsupported, missing-image, stale-revision and inconsistent historic states fail closed without touching valid history',()=>{
 const {html,path}=realPages[0],legacy=oldBuilder.builderPage(html,'real-file-revision',path),base=builderPage(html,'real-file-revision',path),good=v1.encodeDraft(new v1.History(legacy.model)),valid=decodeDraft(good,base.model,base.anchors),initial=valid.serialize(),before=JSON.stringify(initial);
 const changes=[d=>d.version=0,d=>d.version=3,d=>d.history.present.schemaVersion=99,d=>d.history.present.base.revision='stale',d=>d.history.present.elements[0].source.selector='body',d=>d.history.present.elements[0].content.href='javascript:alert(1)',d=>d.history.present.elements[0].layouts.mobile.width=-2,d=>d.history.present.elements.push(clone(d.history.present.elements[0])),d=>d.history.past.push({...clone(legacy.model),base:{...legacy.model.base,revision:'incompatible-past'}}),d=>d.history.present.elements.find(e=>e.type==='image').content.src='asset:missing',d=>d.history.future=Array(121).fill(legacy.model)];
 for(const [index,change]of changes.entries()){const bad=JSON.parse(good);change(bad);const raw=JSON.stringify(bad);assert.throws(()=>decodeDraft(raw,base.model,base.anchors),`negative migration case ${index}`);assert.equal(JSON.stringify(valid.serialize()),before);assert.equal(JSON.stringify(bad),raw);}
 for(const raw of ['{','null','[]','{"version":1,"history":{}}','{"version":1,"history":{"past":[],"future":[],"present":null}}'])assert.throws(()=>decodeDraft(raw,base.model,base.anchors));
});

test('migration uses authoritative protected section metadata and retains safe Free/Flow geometry stash through history',()=>{
 const {html,path}=realPages[0],old=oldBuilder.builderPage(html,'real-file-revision',path),base=builderPage(html,'real-file-revision',path);
 const migrated=migrateModel(old.model,null,base.anchors);assert.ok(migrated.sections.filter(s=>base.anchors.find(a=>a.id===s.id).protected).every(s=>s.protected));
 const next=clone(base.model),target=next.elements[0];target.freeLayouts={desktop:{x:17,width:42,widthUnit:'vw'},tablet:{width:280,widthUnit:'px'},mobile:{x:3,height:20,heightUnit:'vh'}};assert.ok(validModel(next,base.model,base.anchors));
 const history=new History(base.model);history.commit(next);assert.deepEqual(decodeDraft(encodeDraft(history),base.model,base.anchors).present.elements[0].freeLayouts,target.freeLayouts);
 for(const invalid of [{desktop:{widthUnit:'em'}},{desktop:{x:NaN}},{phone:{}},[],{mobile:{width:-1}},{desktop:{background:'url(javascript:x)'}}]){target.freeLayouts=invalid;assert.equal(validModel(next,base.model,base.anchors),false);}
});

test('real V1 publication can be migrated, edited and atomically republished as V2 while old revision remains recoverable',async()=>{
 const {repo,state}=await githubSimulation(),{html,path}=realPages.find(p=>p.path==='public/index.html');state.files.set(path,Buffer.from(html));state.snapshots.set(state.head,new Map(state.files));
 const file=await repo.read(path),legacy=oldBuilder.builderPage(file.content,file.sha,path),base=builderPage(file.content,file.sha,path),history=new v1.History(legacy.model),next=clone(legacy.model),title=next.elements.find(e=>e.tag==='h1');title.content.text='مهاجرت واقعی و انتشار ایزوله';title.layouts.desktop={x:3,width:55};title.layouts.mobile={x:1,width:90};history.commit(next);
 const migrated=decodeDraft(v1.encodeDraft(history),base.model,base.anchors),original=Buffer.from(state.files.get(path)),previous=state.head;
 const response=await publishBuilder(repo,{requestId:crypto.randomUUID(),model:migrated.present},{username:'migration-fixture',role:'admin'},false);assert.equal(response.publication.commit,'committed');assert.equal(state.commits.length,1);
 const output=(await repo.read(path)).content,doc=parseHTML(output).document,stored=JSON.parse(doc.querySelector('#builder-state').textContent);assert.equal(stored.schemaVersion,2);assert.equal(doc.querySelector('h1').textContent,title.content.text);
 const reloaded=builderPage(output,(await repo.read(path)).sha,path),item=reloaded.model.elements.find(e=>e.id===title.id);assert.deepEqual(effectiveLayout(item,'mobile'),title.layouts.mobile);assert.deepEqual(effectiveLayout(item,'desktop'),title.layouts.desktop);assert.deepEqual(effectiveStyle(item,'mobile'),title.style);
 assert.equal((await repo.read(path,previous)).content,original.toString());assert.equal(legacy.model.elements.find(e=>e.id===title.id).content.text,parseHTML(html).document.querySelector('h1').textContent);
});
