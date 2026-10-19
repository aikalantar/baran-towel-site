import {effectiveLayout,effectiveStyle,validStyle} from './model.js';
import {BLOCK_CSS} from './blocks.js';
export const isFree=e=>e.free===true||(e.layoutMode?e.layoutMode==='free'&&!e.source:!e.source);
export const CREATED_CSS=BLOCK_CSS;
const px=new Set(['fontSize','letterSpacing','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','borderWidth','borderRadius','minWidth','maxWidth','minHeight','maxHeight','gap']);
const shadows={none:'none',soft:'0 2px 8px #00000018',medium:'0 8px 24px #00000026',strong:'0 16px 48px #00000040'};
export function styleDeclarations(style){
 if(!validStyle(style))throw Error('سبک نامعتبر است.');
 const rules=[];
 for(const [key,value]of Object.entries(style)){
  if(['focalX','focalY'].includes(key))continue;
  const property=key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
  if(key==='aspectRatio')rules.push(`aspect-ratio:${value||'auto'}`);
  else if(key==='boxShadow')rules.push(`box-shadow:${shadows[value]}`);
  else if(key==='gridColumns')rules.push(`grid-template-columns:repeat(${value},minmax(0,1fr))`);
  else if(key==='backgroundImage')rules.push(`background-image:url("${value}");background-size:cover;background-position:center`);
  else rules.push(`${property}:${value}${px.has(key)?'px':''}`);
 }
 if(style.focalX!=null||style.focalY!=null)rules.push(`object-position:${style.focalX??50}% ${style.focalY??50}%`);
 return rules.flatMap(rule=>rule.split(';')).map(rule=>`${rule}!important`).join(';');
}
export function layoutCSS(elements){
 const outputs={desktop:[],tablet:[],mobile:[]},shared=[];
 for(const e of elements.filter(e=>!e.deleted)){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(e.id))throw Error('شناسه سبک معتبر نیست.');
  const selector=e.source?.anchor?`[data-builder-anchor="${e.id}"]`:`[data-builder-id="${e.id}"]`;
  const unit=e.type==='image'?`:is([data-builder-unit="${e.id}"],[data-builder-id="${e.id}"]:not(picture > img))`:selector;
  if(e.z!=null)shared.push(`${unit}{z-index:${e.z};position:${isFree(e)?'absolute':'relative'}}`);
  for(const device of ['desktop','tablet','mobile']){
   const layout=effectiveLayout(e,device),rules=[],appearance=effectiveStyle(e,device),style=styleDeclarations(appearance),ratio=e.type==='image'&&appearance.aspectRatio>0?appearance.aspectRatio:null;
   if(isFree(e))rules.push(`position:absolute!important;left:${layout.x??10}%;top:${layout.y??10}%`);
   else if(layout.x!=null||layout.y!=null)rules.push(`translate:calc(var(--builder-w,100vw) * ${(layout.x||0)/100}) calc(var(--builder-h,0px) * ${(layout.y||0)/100})`);
   for(const dim of ['width','height'])if(layout[dim]!=null&&!(dim==='height'&&ratio)){const u=layout[dim+'Unit']||'%';rules.push(`${dim}:${u==='%'?`calc(var(--builder-${dim==='width'?'w':'h'},${dim==='width'?'100vw':'0px'}) * ${layout[dim]/100})`:layout[dim]+u}!important;min-${dim}:0!important${dim==='width'?';max-width:none!important':''}`);}
   if(ratio)rules.push(`height:auto!important;aspect-ratio:${ratio}!important${layout.width==null?';width:100%!important':''}`);
   if(layout.hidden)rules.push('display:none!important');
   if(rules.length)outputs[device].push(`${unit}{${rules.join(';')}}`);
   if(style)outputs[device].push(`${selector}{${style}}`);
   if(ratio)outputs[device].push(`${selector}{height:auto!important;aspect-ratio:${ratio}!important}`);
   if(e.type==='image'&&isFree(e))outputs[device].push(`[data-builder-unit="${e.id}"]>img{width:100%!important;height:100%!important;object-fit:${effectiveStyle(e,device).objectFit||'cover'}}`);
  }
 }
 return BLOCK_CSS+shared.join('')+`@media(min-width:1024px){${outputs.desktop.join('')}}@media(min-width:641px) and (max-width:1023px){${outputs.tablet.join('')}}@media(max-width:640px){${outputs.mobile.join('')}}`;
}
