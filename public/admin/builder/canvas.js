import {layoutCSS,isFree} from './layout.js';
import {renderBlockNode} from './blocks.js';
const sectionStyles=new WeakMap();
export function updateGeometry(doc){
 const lookup=id=>id==='page'?doc.querySelector('main'):doc.querySelector(`[data-builder-id="${id}"]`)||doc.querySelector(`[data-builder-anchor="${id}"]`);
 for(const n of doc.querySelectorAll('[data-builder-anchor],[data-builder-type=container]'))if(doc.defaultView.getComputedStyle(n).position==='static')n.style.position='relative';
 for(const n of doc.querySelectorAll('[data-builder-parent]')){const p=lookup(n.dataset.builderParent);if(!p)continue;const r=p.getBoundingClientRect();n.style.setProperty('--builder-w',`${r.width}px`);n.style.setProperty('--builder-h',`${Math.max(1,r.height)}px`);}
}
export function renderCanvas({doc,draft,base,originals,nodeFor,unitFor,anchorFor}){
 const all=new Map([...draft.sections,...draft.elements].map(e=>[e.id,e]));
 const alive=e=>{if(e.deleted)return false;let parent=e.parentId;while(parent&&parent!=='page'){const p=all.get(parent);if(p?.deleted)return false;parent=p?.parentId;}return true;};
 const parentFor=e=>e.parentId==='page'?doc.querySelector('main'):nodeFor(e.parentId)||anchorFor(e.parentId||e.anchor);
 for(const original of [...originals.values()].reverse())if(original.unit.parentNode!==original.parent)original.parent.insertBefore(original.unit,original.next?.parentNode===original.parent?original.next:null);
 for(const node of doc.querySelectorAll('[data-builder-added]'))if(!draft.elements.some(e=>e.id===node.dataset.builderId&&alive(e)))node.remove();
 for(const section of draft.sections){const node=anchorFor(section.id);if(!node)continue;if(!sectionStyles.has(node))sectionStyles.set(node,node.getAttribute('style'));const style=sectionStyles.get(node);if(style)node.setAttribute('style',style);else node.removeAttribute('style');if(section.deleted)node.style.setProperty('display','none','important');}
 for(const section of [...draft.sections].filter(s=>!s.deleted&&!s.protected).sort((a,b)=>a.order-b.order)){const node=anchorFor(section.id);if(node)doc.querySelector('main').append(node);}
 for(const e of draft.elements){
  let node=nodeFor(e.id);
  if(!node&&!e.source&&alive(e)){node=renderBlockNode(doc,e);node.dataset.builderAdded='true';doc.querySelector('main').append(node);}
  if(!node)continue;
  const original=originals.get(e.id),unit=node.closest('picture')||node;
  node.removeAttribute('data-builder-editing');
  if(original?.style)unit.setAttribute('style',original.style);else unit.removeAttribute('style');
  if(unit!==node){if(original?.nodeStyle)node.setAttribute('style',original.nodeStyle);else node.removeAttribute('style');}
  if(!alive(e)){unit.style.setProperty('display','none','important');continue;}
  if(e.type==='image'){
   node.src=e.content.src;node.alt=e.content.alt;
   if(!e.source||e.content.src!==original?.src){node.removeAttribute('srcset');for(const s of original?.sources||[])s.node.removeAttribute('srcset');for(const k of ['width','height'])if(e.content[k])node.setAttribute(k,e.content[k]);if(e.content.variants?.length){node.srcset=[...e.content.variants,{src:e.content.src,width:e.content.width}].map(v=>`${v.src} ${v.width}w`).join(', ');node.sizes='100vw';}}
   else{if(original.srcset)node.setAttribute('srcset',original.srcset);for(const k of ['width','height']){if(original[k])node.setAttribute(k,original[k]);else node.removeAttribute(k);}for(const s of original.sources)if(s.srcset)s.node.setAttribute('srcset',s.srcset);}
  }else if(e.source){e.source.textNodes?.forEach((index,i)=>{if(node.childNodes[index]?.nodeType===3)node.childNodes[index].textContent=i?'':e.content.text;});}
  else if(['text','heading','button'].includes(e.type)){const replacement=renderBlockNode(doc,e);node.replaceChildren(...replacement.childNodes);}
  if(e.content.href!=null)node.setAttribute('href',e.content.href);
  unit.dataset.builderParent=e.parentId||e.anchor;
  if(e.type==='container'&&e.parentId==='page')node.dataset.builderAnchor=e.id;
  if(e.z!=null||Object.values(e.layouts).some(l=>Object.keys(l).length))unit.dataset.builderGeometry='';
 }
 for(const e of draft.elements.filter(alive).sort((a,b)=>(a.order||0)-(b.order||0))){const node=nodeFor(e.id),original=base.model.elements.find(o=>o.id===e.id);if(!e.source||isFree(e)||e.parentId!==original?.parentId){const parent=parentFor(e);if(parent&&parent!==node)parent.append(node.closest('picture')||node);}}
 let style=doc.querySelector('#builder-editor-layout');if(!style){style=doc.createElement('style');style.id='builder-editor-layout';doc.head.append(style);}style.textContent=layoutCSS([...draft.sections,...draft.elements]);
 updateGeometry(doc);
 return alive;
}
