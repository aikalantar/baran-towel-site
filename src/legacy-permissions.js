import {CMSFailure,describePage,safeURL} from './content.js';
import {builderPage} from './builder.js';
import {lockedBy} from '../public/admin/builder/locks.js';
import {enforceContentPermission} from './cms-permissions.js';
import {imageInfo} from '../public/admin/builder/image-format.js';

export async function authorizeLegacy(user,repo,head,path,current,source,body){
 if(user.role==='admin')return;
 if(!Array.isArray(body.updates||[])||!Array.isArray(body.operations||[])||(body.updates||[]).length>1500||(body.operations||[]).length>40)throw new CMSFailure('حجم یا نوع تغییرات معتبر نیست.');
 const base=builderPage(current,'permission',path,false),fields=describePage(source,path,'permission').fields;
 const locked=node=>{
  if(node?.closest('header.site-header,footer'))throw new CMSFailure('ویرایش پوستهٔ محافظت‌شده فقط برای طراح مجاز است؛ از بخش تماس برای اطلاعات تماس استفاده کنید.',403);
  for(const el of [node,...node?.querySelectorAll('[data-builder-id]')||[]]){
   const id=el?.getAttribute('data-builder-id')||el?.getAttribute('data-builder-anchor');
   if(id&&lockedBy(base.model,id))throw new CMSFailure('تغییر محتوای قفل‌شده فقط برای مدیر مجاز است.',403);
  }
 };
 for(const update of body.updates||[]){const f=fields.find(f=>f.id===update.id);if(f)locked(base.document.querySelector(f.selector));}
 if(body.operations?.length){
  if(!['public/catalog/index.html','public/en/catalog/index.html'].includes(path)||body.restoreCommit)throw new CMSFailure('عملیات محصول در این مسیر مجاز نیست.',403);
  for(const op of body.operations){
   if(!op||!['duplicate','remove','up'].includes(op.type)||Object.keys(op).some(k=>!['type','id','newId','name','updates','image'].includes(k)))throw new CMSFailure('این عملیات از محدودهٔ محصول خارج است.',403);
   // Lookup by exact DOM ID; do not interpolate a client selector.
   const product=base.document.getElementById(op.id);
   if(!product?.matches('.product-card'))throw new CMSFailure('محصول مجاز پیدا نشد.',403);
   locked(product);
  }
 }
 const changedImages=[];
 for(const update of body.updates||[]){const f=fields.find(f=>f.id===update.id);if(f?.kind==='image'&&f.value!==update.value)changedImages.push(update);}
 for(const op of body.operations||[])if(op.image)changedImages.push(op.image);
 for(const image of changedImages){
  safeURL(image.value,true);
  const upload=body.images?.find(i=>'/' + i.path?.slice(7)===image.value);
  const bytes=upload?Uint8Array.from(atob(upload.data),c=>c.charCodeAt(0)):await repo.readBytes('public'+image.value,head);
  let info;try{info=imageInfo(bytes);}catch{throw new CMSFailure('ساختار تصویر معتبر نیست.');}
  if(info.width!==Number(image.width)||info.height!==Number(image.height))throw new CMSFailure('ابعاد تصویر باید با فایل واقعی تطبیق داشته باشد.',403);
 }
}
export function authorizeLegacyResult(user,path,current,next,operations=[]){
 if(user.role==='admin'||operations.length)return;
 enforceContentPermission(user,builderPage(current,'permission',path,false).model,builderPage(next,'permission',path,false).model);
}
// Contact is an existing semantic adapter: it can replace nested email text,
// but accepts no style/tree commands. Check its exact targets against persisted
// locks instead of treating that known text normalization as a design change.
export function authorizeContacts(user,path,current,values){
 if(user.role==='admin')return;
 const base=builderPage(current,'permission',path,false);
 const prefixes={phone:'tel:',email:'mailto:',whatsapp:'https://wa.me/',instagram:'https://www.instagram.com/',telegram:'https://t.me/',bale:'https://ble.ir/'};
 const targets=[];
 for(const node of base.document.querySelectorAll('a[href]'))for(const [key,prefix]of Object.entries(prefixes))if(node.getAttribute('href').startsWith(prefix)){
  const before=node.getAttribute('href'),after=key==='phone'||key==='email'?prefix+values[key]:values[key];
  if(before.split('?')[0]!==after?.split('?')[0]||key==='email'&&node.textContent!==values.email)targets.push(node);
 }
 const address=base.document.querySelector('[aria-labelledby="footer-address"] address p:last-child span');
 if(address&&base.document.documentElement.lang==='fa'&&values.address?.trim()&&address.textContent!==values.address)targets.push(address);
 for(const node of targets)for(const n of [node,...node.querySelectorAll('[data-builder-id]')]){
  const id=n.getAttribute('data-builder-id');if(id&&lockedBy(base.model,id))throw new CMSFailure('تغییر اطلاعات تماس قفل‌شده فقط برای مدیر مجاز است.',403);
 }
}
