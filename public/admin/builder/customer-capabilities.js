// Shared customer commands and capability rules; the Worker remains authoritative.
import {createBlock} from './blocks.js';
import {FONT_IDS} from './fonts.js';
import {lockedBy} from './locks.js';

export const CUSTOMER_CONTENT = {heading:'عنوان',richtext:'نوشته',image:'تصویر',button:'دکمه و پیوند'};
export const CUSTOMER_STYLE_KEYS = ['fontFamily','fontSize','fontWeight','color','backgroundColor','textAlign'];
const leafTypes=['text','heading','button','image'];
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
export const customerSame=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
export function protectedCustomerRegion(model,id){
 const nodes=new Map([...model.sections,...model.elements].map(e=>[e.id,e])),seen=new Set();
 for(let e=nodes.get(id);e&&!seen.has(e.id);e=nodes.get(e.parentId||e.anchor)){if(e.protected)return true;seen.add(e.id);}
 return false;
}
export function customerCanStyle(model,id){
 const e=model.elements.find(e=>e.id===id);
 return !!e&&!e.deleted&&leafTypes.includes(e.type)&&!lockedBy(model,id)&&!protectedCustomerRegion(model,id);
}
export function customerStyleValue(key,value,type){
 if(!CUSTOMER_STYLE_KEYS.includes(key))return false;
 if(value===undefined)return true; // Return to the site's inherited appearance.
 if(type==='image'&&key!=='backgroundColor')return false;
 if(key==='fontFamily')return FONT_IDS.includes(value);
 if(key==='fontSize')return Number.isInteger(value)&&value>=10&&value<=96;
 if(key==='fontWeight')return [400,500,600,700,800].includes(value);
 if(key==='textAlign')return ['start','center','end','justify'].includes(value);
 return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
}
export function customerCanAdd(model,parentId,document){
 const section=model.sections.find(s=>s.id===parentId);
 const node=document&&[...document.querySelectorAll('main > section')].find(n=>n.getAttribute('data-builder-anchor')===parentId);
 const complex=model.elements.some(e=>e.anchor===parentId&&!e.deleted&&(e.free===true||e.layoutMode==='free'))||[section?.style,...Object.values(section?.responsiveStyles||{})].some(s=>s&&(s.maxHeight!=null||s.display&&s.display!=='block'))||Object.values(section?.layouts||{}).some(l=>l.hidden);
 // This site's normal .section roots append in document flow. The hero and
 // other bespoke roots can overlay children despite a flow model setting.
 return !!section&&!section.deleted&&!section.protected&&section.layoutMode==='flow'&&!complex&&!lockedBy(model,parentId)&&!!node?.classList.contains('section')&&!node.classList.contains('hero');
}
export function customerContentNode(model,kind,parentId,document){
 if(!Object.hasOwn(CUSTOMER_CONTENT,kind)||!customerCanAdd(model,parentId,document))throw Error('این بخش برای افزودن محتوای ساده مناسب نیست. بخش دیگری را انتخاب کنید.');
 const [node]=createBlock(kind,{anchor:parentId,parentId,language:model.page.language});
 node.order=Math.max(-1,...model.elements.filter(e=>e.parentId===parentId).map(e=>e.order||0))+1;
 return node;
}
function leafDesign(e){const copy=structuredClone(e);for(const key of ['content','style','responsiveStyles','deleted','imageChanged','order'])delete copy[key];return copy;}
export function customerSimpleLeaf(e){
 const kind={heading:'heading',text:'richtext',image:'image',button:'button'}[e?.type];
 if(!kind||e.source!==null)return false;
 const [expected]=createBlock(kind,{anchor:e.anchor,parentId:e.parentId,idFactory:()=>e.id});
 return customerSame(leafDesign(e),leafDesign(expected));
}
export function customerCanRemove(model,id,document){
 const e=model.elements.find(e=>e.id===id);
 return !!e&&!e.deleted&&customerSimpleLeaf(e)&&customerCanAdd(model,e.parentId,document)&&!lockedBy(model,id)&&!model.elements.some(n=>n.parentId===id);
}
export function customerSetStyle(model,id,key,value){
 const e=model.elements.find(e=>e.id===id);
 if(!customerCanStyle(model,id)||!customerStyleValue(key,value,e.type))throw Error('این تغییر ظاهر برای محتوای انتخاب‌شده مجاز نیست.');
 if(value===undefined)delete e.style[key];else e.style[key]=value;
 // One simple appearance applies to all screen sizes, preserving other overrides.
 for(const style of Object.values(e.responsiveStyles||{}))delete style[key];
}
