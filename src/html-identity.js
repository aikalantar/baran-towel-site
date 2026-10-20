import {CMSFailure} from './content.js';
import {allocateIdentityMap,isElementID,stableElementID,remapFragment,remapElementIdentity} from '../public/admin/builder/identity.js';
import {layoutCSS} from '../public/admin/builder/layout.js';
import {BLOCK_CSS} from '../public/admin/builder/blocks.js';

const all = root => [root,...root.querySelectorAll('*')];
const fail = () => { throw new CMSFailure('شناسه یا دادهٔ صفحه تکراری، ناقص یا نامعتبر است؛ هیچ محتوایی اصلاح یا حذف نشد. نسخهٔ سالم را بازیابی کنید.',422); };
// Called before mutation, including on read by Builder. A Map must never hide
// duplicate records, and a querySelector must never choose an ambiguous owner.
export function publishedIdentity(document) {
  const htmlIDs=new Set();
  for(const node of document.querySelectorAll('[id]')){if(htmlIDs.has(node.id))fail();htmlIDs.add(node.id);}
  if (document.querySelectorAll('#builder-state').length > 1 || document.querySelectorAll('#builder-layout').length > 1) fail();
  const nodes=new Map(),anchors=new Map();
  for (const node of document.querySelectorAll('[data-builder-id]')) {
    const id=node.getAttribute('data-builder-id');
    if (!isElementID(id)||nodes.has(id)) fail();
    nodes.set(id,node);
  }
  for (const node of document.querySelectorAll('[data-builder-anchor]')) {
    const id=node.getAttribute('data-builder-anchor');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||anchors.has(id)||nodes.has(id)&&nodes.get(id)!==node) fail();
    anchors.set(id,node);
  }
  for (const node of document.querySelectorAll('[data-builder-unit]')) {
    const id=node.getAttribute('data-builder-unit');
    if (!nodes.has(id) || node!==nodes.get(id) && !node.contains(nodes.get(id))) fail();
  }
  const script=document.querySelector('#builder-state');let state=null;
  if (script) {
    try {state=JSON.parse(script.textContent);} catch {fail();}
    if (!state||typeof state!=='object'||Array.isArray(state)) fail();
    if (state.schemaVersion!=null) {
      if(state.schemaVersion!==2||!Array.isArray(state.elements)||!Array.isArray(state.sections))fail();
      const ids=new Set();
      for(const e of [...state.sections,...state.elements]) {
        if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(e.id)||ids.has(e.id))fail();ids.add(e.id);
      }
      for(const e of state.elements)if(!isElementID(e.id)||!e.source&&!nodes.has(e.id))fail();
    } else for(const id of Object.keys(state))if(!isElementID(id))fail();
  }
  // Retired generated selectors remain reserved while their CSS is retained.
  // This prevents later unannotated DOM nodes from inheriting a deleted node's CSS.
  const reserved=new Set([...nodes.keys(),...anchors.keys(),...(state?.schemaVersion===2?state.elements.map(e=>e.id):Object.keys(state||{}))]);
  for(const match of (document.querySelector('#builder-layout')?.textContent||'').matchAll(/data-builder-(?:id|anchor|unit)=["']([a-zA-Z0-9_-]+)["']/g))reserved.add(match[1]);
  return {state,script,nodes,anchors,reserved};
}
export function legacyIdentityMutation(document) {
  const initial=publishedIdentity(document),state=initial.state,clones=[];
  const ownedIDs=new Set(initial.nodes.keys()),ownedAnchors=new Set(initial.anchors.keys());
  function duplicate(source,copy,newHTMLId) {
    const sourceNodes=all(source),copyNodes=all(copy),ids=sourceNodes.filter(n=>n.hasAttribute('data-builder-id')).map(n=>n.getAttribute('data-builder-id'));
    const used=new Set(initial.reserved);
    const factory=old=>{
      const prefix=old.startsWith('base-')?'base-':'new-legacy-';let attempt=0,id;
      do {id=prefix+stableElementID(`clone:${newHTMLId}:${old}:${attempt++}`).slice(5);}while(used.has(id));
      used.add(id);return id;
    };
    const mapping=allocateIdentityMap(ids,{reserved:initial.reserved,idFactory:factory});
    for(const id of mapping.values())initial.reserved.add(id);
    for(const node of sourceNodes.filter(n=>n.hasAttribute('data-builder-anchor'))){
      const old=node.getAttribute('data-builder-anchor');if(mapping.has(old))continue;
      let attempt=0,id;do{id='section-clone-'+stableElementID(`${newHTMLId}:${old}:${attempt++}`).slice(5);}while(initial.reserved.has(id));
      mapping.set(old,id);initial.reserved.add(id);
    }
    for(const old of ids)ownedIDs.add(mapping.get(old));
    for(const node of sourceNodes.filter(n=>n.hasAttribute('data-builder-anchor')))ownedAnchors.add(mapping.get(node.getAttribute('data-builder-anchor')));
    const htmlMap=new Map(),htmlUsed=new Set([...document.querySelectorAll('[id]')].map(n=>n.id));
    htmlMap.set(source.id,newHTMLId);htmlUsed.add(newHTMLId);
    for(const node of sourceNodes.filter(n=>n.id&&n!==source)) {
      if(htmlMap.has(node.id))fail();
      let id,attempt=0;do{id=`${newHTMLId}-${stableElementID(node.id+':'+attempt++).slice(5)}`;}while(htmlUsed.has(id));
      htmlMap.set(node.id,id);htmlUsed.add(id);
    }
    for(const node of copyNodes) {
      if(node.id)node.id=htmlMap.get(node.id);
      for(const attr of ['data-builder-id','data-builder-anchor','data-builder-unit','data-builder-parent'])if(mapping.has(node.getAttribute(attr)))node.setAttribute(attr,mapping.get(node.getAttribute(attr)));
      for(const attr of ['href','xlink:href'])if(node.hasAttribute(attr))node.setAttribute(attr,remapFragment(node.getAttribute(attr),htmlMap));
      for(const attr of ['aria-labelledby','aria-describedby','aria-controls','aria-owns','aria-details','aria-activedescendant','aria-flowto','for','headers','list','form'])if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).split(/\s+/).map(id=>htmlMap.get(id)||id).join(' '));
      for(const attr of [...node.attributes])if(/url\(\s*["']?#/.test(attr.value))node.setAttribute(attr.name,attr.value.replace(/url\(\s*(["']?)#([^\s)'";]+)\1\s*\)/g,(full,q,id)=>htmlMap.has(id)?`url(${q}#${htmlMap.get(id)}${q})`:full));
    }
    const sourceEntries=state?.schemaVersion===2?state.elements:[];
    for(const [old,id]of mapping) {
      const section=state?.schemaVersion===2?state.sections.find(s=>s.id===old):null;
      if(section){const next=remapElementIdentity(section,mapping);next.source={anchor:id};state.sections.push(next);clones.push(next);continue;}
      const entry=sourceEntries.find(e=>e.id===old);
      if(entry) {const next=remapElementIdentity(entry,mapping);if(next.content?.href)next.content.href=remapFragment(next.content.href,htmlMap);for(const run of next.content?.runs||[])if(run.href)run.href=remapFragment(run.href,htmlMap);state.elements.push(next);clones.push(next);}
      else if(state&&!state.schemaVersion&&state[old]) {
        state[id]=structuredClone(state[old]);
        clones.push({...state[id],id,type:sourceNodes.find(n=>n.getAttribute('data-builder-id')===old).localName==='img'?'image':'text',source:{},responsiveInheritance:false});
      }
    }
    return mapping;
  }
  function finish({pageId}={}) {
    if(state?.schemaVersion===2) {
      // Only nodes removed by this explicit mutation may retire stored records.
      const present=new Map([...document.querySelectorAll('[data-builder-id]')].map(n=>[n.getAttribute('data-builder-id'),n]));
      state.elements=state.elements.filter(e=>!ownedIDs.has(e.id)||present.has(e.id));
      state.sections=state.sections.filter(e=>!ownedAnchors.has(e.id)||document.querySelector(`[data-builder-anchor="${e.id}"]`));
      const removed=new Set([...ownedIDs,...ownedAnchors].filter(id=>!present.has(id)&&!document.querySelector(`[data-builder-anchor="${id}"]`)));
      for(const e of [...state.sections,...state.elements])if(removed.has(e.parentId)||removed.has(e.anchor))fail();
      for(const e of state.elements) {
        const node=present.get(e.id);if(!node)continue;
        if(e.content&&['text','heading','button'].includes(e.type)&&!e.source&&e.content.text!==node.textContent){e.content.text=node.textContent;delete e.content.runs;}
        if(e.content?.href!=null&&node.hasAttribute('href'))e.content.href=node.getAttribute('href');
        if(e.type==='image') {
          const src=node.getAttribute('src');
          if(e.content.src!==src){e.content.src=src;e.content.variants=[];for(const key of ['width','height']){const n=Number(node.getAttribute(key));if(n>0)e.content[key]=n;else delete e.content[key];}}
          e.content.alt=node.getAttribute('alt')||'';
        }
      }
    } else if(state)for(const id of ownedIDs)if(!document.querySelector(`[data-builder-id="${id}"]`))delete state[id];
    if(pageId&&state?.page)state.page.id=pageId;
    if(pageId)for(const node of document.querySelectorAll('meta[name="builder-page-id"]'))node.setAttribute('content',pageId);
    if(initial.script)initial.script.textContent=JSON.stringify(state).replace(/</g,'\\u003c');
    if(clones.length) {
      let style=document.querySelector('#builder-layout');if(!style){style=document.createElement('style');style.id='builder-layout';document.head.append(style);}
      // Preserve the exact existing CSS; add rules only for intentional clones.
      style.textContent+=layoutCSS(clones).replace(BLOCK_CSS,'');
    }
    for(const node of document.querySelectorAll('meta[name="builder-request"],meta[name="builder-fingerprint"]'))node.remove();
    publishedIdentity(document);
  }
  return {duplicate,finish};
}
