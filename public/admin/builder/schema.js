export const SCHEMA_VERSION = 2;
export const HISTORY_LIMIT = 120;
export const DEVICES = ["desktop", "tablet", "mobile"];
export const clone = value => JSON.parse(JSON.stringify(value));
export const emptyLayout = () => ({ desktop: {}, tablet: {}, mobile: {} });
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
const idOK = value => typeof value === "string" && /^(?:base-[a-z0-9]+|new-[a-zA-Z0-9-]+|section-[a-zA-Z0-9_-]+)$/.test(value);
export function stablePageID(path) { let hash=2166136261; for(const c of path) hash=Math.imul(hash^c.charCodeAt(0),16777619);return `page-${(hash>>>0).toString(36).padStart(8,"0")}`; }
export function safeLink(value) { return typeof value === "string" && value.length <= 2000 && !/[\u0000-\u0020\\]/.test(value) && /^(?:\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(value); }
export function safeImage(value) { return typeof value === "string" && value.length < 3_000_000 && ((/^\/assets(?:-v[23])?\/[a-zA-Z0-9_./-]+\.(webp|png|jpe?g)$/i.test(value) && !value.includes("..")) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)); }
export const STYLE_RULES = {
 fontFamily:["Tahoma","Arial","Georgia","system-ui"],fontSize:[8,200],fontWeight:[100,900],lineHeight:[.7,4],letterSpacing:[-10,30],textAlign:["start","center","end","justify"],
 color:"color",backgroundColor:"color",opacity:[0,1],padding:[0,500],paddingTop:[0,500],paddingRight:[0,500],paddingBottom:[0,500],paddingLeft:[0,500],margin:[-200,500],marginTop:[-200,500],marginRight:[-200,500],marginBottom:[-200,500],marginLeft:[-200,500],
 borderWidth:[0,30],borderColor:"color",borderStyle:["solid","dashed","dotted","none"],borderRadius:[0,500],boxShadow:["none","soft","medium","strong"],objectFit:["cover","contain","fill","scale-down"],focalX:[0,100],focalY:[0,100],minWidth:[0,4000],maxWidth:[0,4000],minHeight:[0,4000],maxHeight:[0,4000],backgroundImage:"image",gridColumns:[1,6],gap:[0,200],display:["block","grid","flex"],flexDirection:["row","column"],alignItems:["start","center","end","stretch"],justifyContent:["start","center","end","space-between"]
};
export function validStyle(style) {
 if(!record(style))return false;
 return Object.entries(style).every(([key,value])=>{
  const rule=STYLE_RULES[key];if(!rule)return false;
  if(rule==="color")return typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value);
  if(rule==="image")return safeImage(value)&&!value.startsWith("data:");
  if(typeof rule[0]==="number")return typeof value==="number"&&Number.isFinite(value)&&value>=rule[0]&&value<=rule[1]&&(!["gridColumns","fontWeight"].includes(key)||Number.isInteger(value));
  return rule.includes(value);
 });
}
export const CONTAINER_KINDS = ["section","container","columns","hero","cards","gallery","faq","faq-item","feature","testimonial","cta","group","card"];
export function effectiveLayout(e,device) {
 const layouts=e.layouts||{};
 if(device==="desktop")return {...layouts.desktop};
 if(device==="mobile"&&e.responsiveInheritance===false)return {...layouts.mobile};
 return {...layouts.desktop,...layouts.tablet,...(device==="mobile"?layouts.mobile:{})};
}
export function effectiveStyle(e,device) { return {...e.style,...(device!=="desktop"?e.responsiveStyles?.tablet:{}),...(device==="mobile"?e.responsiveStyles?.mobile:{})}; }
export function migrateModel(input,base,anchors=[]) {
 if(!input||![1,2].includes(input.schemaVersion))throw Error("نسخه مدل پشتیبانی نمی‌شود؛ فایل اصلی را نگه دارید.");
 const model=clone(input);
 if(model.schemaVersion===1){
  model.schemaVersion=2;
  model.page=clone(base?.page||{id:stablePageID(model.base.path),title:model.base.title||"صفحه",description:"",language:model.base.path.startsWith("public/en/")?"en":"fa",direction:model.base.path.startsWith("public/en/")?"ltr":"rtl",robots:"index",canonical:"https://luxtowelco.com/"+model.base.path.slice(7).replace(/index\.html$/,""),visibility:"public",menu:{included:false,label:"",order:0}});
  model.sections=clone(base?.sections||anchors.map((a,i)=>({id:a.id,label:a.label,parentId:"page",source:{anchor:a.id},order:i,protected:i===0,deleted:false,locked:false,layoutMode:"flow",layouts:emptyLayout(),style:{},responsiveStyles:{tablet:{},mobile:{}}})));
  model.elements=model.elements.map(e=>({...e,source:e.source||null,parentId:e.anchor,layoutMode:!e.source||e.free===true?"free":"flow",layouts:{desktop:{},tablet:{},mobile:{},...e.layouts},responsiveStyles:{tablet:{},mobile:{}},responsiveInheritance:false,locked:false}));
 }
 model.warningsDismissed ||= [];
 return model;
}
export class History {
 constructor(model,saved){this.present=clone(model);this.past=saved?.past?.slice(-HISTORY_LIMIT).map(clone)||[];this.future=saved?.future?.slice(-HISTORY_LIMIT).map(clone)||[];}
 commit(model){if(JSON.stringify(model)===JSON.stringify(this.present))return false;this.past.push(this.present);this.past=this.past.slice(-HISTORY_LIMIT);this.present=clone(model);this.future=[];return true;}
 undo(){if(!this.past.length)return false;this.future.push(this.present);this.present=this.past.pop();return true;}
 redo(){if(!this.future.length)return false;this.past.push(this.present);this.present=this.future.pop();return true;}
 serialize(){return {present:this.present,past:this.past,future:this.future};}
}
function layoutValid(layout){
 if(!record(layout)||Object.keys(layout).some(k=>!["x","y","width","height","widthUnit","heightUnit","hidden"].includes(k)))return false;
 for(const [key,val]of Object.entries(layout)){
  if(key==="hidden"){if(typeof val!=="boolean")return false;continue;}
  if(key.endsWith("Unit")){if(!(key==="widthUnit"?["%","px","vw"]:["%","px","vh"]).includes(val))return false;continue;}
  const dimension=key==="width"||key==="height",max=dimension&&(layout[key+"Unit"]||"%")!=="%"?4000:dimension?300:500;
  if(typeof val!=="number"||!Number.isFinite(val)||(dimension?val<.1||val>max:Math.abs(val)>max))return false;
 }
 return true;
}
function nodeSettings(e){
 if(!record(e.layouts)||Object.keys(e.layouts).some(k=>!DEVICES.includes(k))||!DEVICES.every(d=>layoutValid(e.layouts[d]||{}))||!validStyle(e.style))return false;
 if(e.responsiveStyles!=null&&(!record(e.responsiveStyles)||Object.keys(e.responsiveStyles).some(k=>!["tablet","mobile"].includes(k))||!Object.values(e.responsiveStyles).every(validStyle)))return false;
 if(e.layoutMode!=null&&!["free","flow"].includes(e.layoutMode))return false;
 if(e.responsiveInheritance!=null&&typeof e.responsiveInheritance!=="boolean")return false;
 if(e.locked!=null&&typeof e.locked!=="boolean")return false;
 if(typeof e.deleted!=="boolean"||(e.z!=null&&(!Number.isInteger(e.z)||Math.abs(e.z)>10000)))return false;
 if(e.order!=null&&(!Number.isInteger(e.order)||e.order<0||e.order>10000))return false;
 return true;
}
function pageValid(p){
 if(!record(p)||typeof p.id!=="string"||!/^page-[a-zA-Z0-9-]{1,80}$/.test(p.id)||!["fa","en"].includes(p.language)||p.direction!==(p.language==="fa"?"rtl":"ltr"))return false;
 for(const key of ["title","description","ogTitle","ogDescription"])if(p[key]!=null&&(typeof p[key]!=="string"||p[key].length>(key.includes("escription")?2000:300)))return false;
 if(typeof p.title!=="string"||!p.title.trim()||!["index","noindex"].includes(p.robots)||!["public","unlisted"].includes(p.visibility||"public"))return false;
 if(p.canonical!=null&&!/^https:\/\/luxtowelco\.com\/[a-zA-Z0-9_/-]*$/.test(p.canonical))return false;
 if(p.ogImage&&(!safeImage(p.ogImage)||p.ogImage.startsWith("data:")))return false;
 if(p.menu!=null&&(!record(p.menu)||typeof p.menu.included!=="boolean"||typeof p.menu.label!=="string"||p.menu.label.length>100||!Number.isInteger(p.menu.order)||Math.abs(p.menu.order)>10000))return false;
 return true;
}
// Stored JSON is untrusted. Shared by import, editor and Worker.
export function validModel(input,baseInput,anchors=[]) {
 try{
 const base=migrateModel(baseInput,baseInput,anchors),model=migrateModel(input,base,anchors);
 if(JSON.stringify(model.base)!==JSON.stringify(base.base)||!pageValid(model.page)||model.page.id!==base.page.id||!Array.isArray(model.elements)||model.elements.length>2000||!Array.isArray(model.sections)||model.sections.length>200)return false;
 if(!Array.isArray(model.warningsDismissed)||model.warningsDismissed.length>500||model.warningsDismissed.some(x=>typeof x!=="string"||x.length>150))return false;
 const original=new Map(base.elements.map(e=>[e.id,e])),sections=new Map(base.sections.map(s=>[s.id,s])),ids=new Set(),nodes=new Map();
 for(const s of model.sections){const old=sections.get(s.id);if(!old||ids.has(s.id)||JSON.stringify(s.source)!==JSON.stringify(old.source)||s.parentId!=="page"||typeof s.protected!=="boolean"||s.protected!==!!old.protected||!nodeSettings(s)||Object.values(s.layouts).some(l=>Object.keys(l).some(k=>k!=='hidden'))||(old.protected&&(s.order!==old.order||s.deleted)))return false;ids.add(s.id);nodes.set(s.id,{...s,type:"container",isSection:true});}
 if(model.sections.length!==base.sections.length)return false;
 for(const e of model.elements){
  if(!record(e)||!idOK(e.id)||ids.has(e.id)||typeof e.parentId!=='string'||!["text","heading","image","button","container","divider","spacer"].includes(e.type)||!nodeSettings(e)||!record(e.content))return false;
  ids.add(e.id);nodes.set(e.id,e);
  const orig=original.get(e.id);
  if(orig&&(e.type!==orig.type||JSON.stringify(e.source)!==JSON.stringify(orig.source)||e.tag!==orig.tag||e.kind!==orig.kind))return false;
  if(e.id.startsWith("base-")&&!orig||!orig&&(e.source!=null||!e.id.startsWith("new-")))return false;
  if(orig&&e.anchor!==orig.anchor&&(orig.movable===false||e.free!==true))return false;
  if(orig?.movable===false&&(e.parentId!==orig.parentId||e.free===true&&orig.free!==true))return false;
  if(e.free!=null&&typeof e.free!=="boolean")return false;
  if(e.type==="container"){if(!CONTAINER_KINDS.includes(e.kind)||!["div","section","details"].includes(e.tag)||e.tag!==(e.kind==="faq-item"?"details":e.kind==="section"?"section":"div"))return false;}
  else if(e.type==="image"){
   if(e.tag!=="img"||!safeImage(e.content.src)||typeof e.content.alt!=="string"||e.content.alt.length>2000)return false;
   if(e.content.variants!=null&&(!Array.isArray(e.content.variants)||e.content.variants.length>3||e.content.variants.some(v=>!record(v)||!safeImage(v.src)||!Number.isInteger(v.width)||v.width<1||v.width>8000||!Number.isInteger(v.height)||v.height<1||v.height>8000)))return false;
   for(const d of ["width","height"])if(e.content[d]!=null&&(!Number.isInteger(e.content[d])||e.content[d]<1||e.content[d]>8000))return false;
  }else if(["text","heading","button"].includes(e.type)){
   if(typeof e.content.text!=="string"||e.content.text.length>12000)return false;
   if(!orig&&(e.type==="text"?!["p","span"].includes(e.tag):e.type==="heading"?!["h1","h2","h3","h4","h5","h6","summary"].includes(e.tag):e.tag!=="a"))return false;
   if(e.content.href!=null&&!safeLink(e.content.href))return false;
   if(e.content.runs!=null&&(!Array.isArray(e.content.runs)||e.content.runs.length>100||e.content.runs.map(r=>r.text).join("")!==e.content.text||e.content.runs.some(r=>!record(r)||Object.keys(r).some(k=>!["text","bold","italic","underline","href"].includes(k))||typeof r.text!=="string"||["bold","italic","underline"].some(k=>r[k]!=null&&typeof r[k]!=="boolean")||r.href!=null&&!safeLink(r.href))))return false;
  }else if(e.type==="divider"?e.tag!=="hr":e.tag!=="div")return false;
 }
 for(const e of model.elements){
  let parent=e.parentId||e.anchor,seen=new Set([e.id]),depth=0,root;
  if(parent==="page"&&(e.type!=="container"||e.kind!=="section"||e.anchor!==e.id))return false;
  while(parent!=="page"){
   const p=nodes.get(parent);if(!p||p.type!=="container"||seen.has(parent)||++depth>8)return false;seen.add(parent);
   if(p.isSection){root=p.id;break;}
   root=p.id;parent=p.parentId||p.anchor;
  }
  if(e.anchor!==(root||e.id))return false;
  if(!e.source&&e.tag==="summary"&&nodes.get(e.parentId)?.kind!=="faq-item")return false;
 }
 for(const e of model.elements.filter(e=>e.kind==="faq-item"&&!e.deleted)){
  const children=model.elements.filter(c=>c.parentId===e.id&&!c.deleted).sort((a,b)=>(a.order||0)-(b.order||0));
  if(children[0]?.tag!=="summary"||children.filter(c=>c.tag==="summary").length!==1)return false;
 }
 return [...original.keys()].every(id=>ids.has(id));
 }catch{return false;}
}
export function decodeDraft(raw,base,anchors){
 if(!raw||raw.length>30_000_000)throw Error("پیش‌نویس معتبر نیست یا بیش از حد بزرگ است.");
 const saved=JSON.parse(raw);
 if(![1,2].includes(saved.version)||!saved.history||!Array.isArray(saved.history.past)||!Array.isArray(saved.history.future)||saved.history.past.length>HISTORY_LIMIT||saved.history.future.length>HISTORY_LIMIT)throw Error("ساختار پیش‌نویس پشتیبانی نمی‌شود.");
 for(const m of [saved.history.present,...saved.history.past,...saved.history.future])for(const e of m?.elements||[])for(const content of [e.content,...(e.content?.variants||[])])if(typeof content?.src==="string"&&content.src.startsWith("asset:")){const asset=saved.assets?.[content.src.slice(6)];if(typeof asset!=="string")throw Error("تصویر پیش‌نویس ناقص است.");content.src=asset;}
 const models=[saved.history.present,...saved.history.past,...saved.history.future].map(m=>migrateModel(m,base,anchors));
 if(!models.every(m=>validModel(m,base,anchors)))throw Error("پیش‌نویس با نسخه فعلی صفحه سازگار نیست؛ فایل پشتیبان را نگه دارید.");
 const history={present:models[0],past:models.slice(1,1+saved.history.past.length),future:models.slice(1+saved.history.past.length)};
 return new History(history.present,history);
}
export function encodeDraft(history){
 const data={version:2,savedAt:new Date().toISOString(),history:clone(history.serialize()),assets:{}},assets=new Map();
 for(const model of [data.history.present,...data.history.past,...data.history.future])for(const e of model.elements)for(const content of [e.content,...(e.content.variants||[])]){const src=content.src;if(!src?.startsWith("data:"))continue;if(!assets.has(src))assets.set(src,`image-${assets.size}`);const id=assets.get(src);data.assets[id]=src;content.src=`asset:${id}`;}
 return JSON.stringify(data);
}
