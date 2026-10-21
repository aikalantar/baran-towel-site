import {CMSFailure,pagePath,SITE,routeFor} from './content.js';
import {lockedBy} from '../public/admin/builder/locks.js';
import {CUSTOMER_STYLE_KEYS,customerSame,customerCanStyle,customerCanAdd,customerSimpleLeaf,customerCanRemove,customerStyleValue,protectedCustomerRegion} from '../public/admin/builder/customer-capabilities.js';

const deny=message=>{throw new CMSFailure(message,403);};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const pageActions=['rename','archive','delete','restore'];
export const cmsPermissions=user=>({edit:['admin','editor'].includes(user?.role),studio:user?.role==='admin',publish:['admin','editor'].includes(user?.role)});
// Accounts belong to this single-site installation. Optional server-only policy
// narrows an editor's membership; no policy is accepted from request bodies.
export function contentUser(user,env){
 if(!user||user.role==='admin')return user;
 if(!cmsPermissions(user).edit)deny('دسترسی ویرایش ندارید.');
 let policy={};
 if(env.CMS_EDITOR_ACCESS!==undefined){
  let policies;try{policies=JSON.parse(env.CMS_EDITOR_ACCESS);}catch{deny('پیکربندی محدودهٔ دسترسی معتبر نیست.');}
  if(!plain(policies)||!Object.hasOwn(policies,user.username)||!plain(policies[user.username]))deny('این حساب برای محتوای این سایت مجاز نیست.');
  policy=policies[user.username];
  if(Object.keys(policy).some(k=>!['site','repository','pages','createPages','contacts','pageActions'].includes(k)))deny('پیکربندی محدودهٔ دسترسی دارای گزینهٔ ناشناخته است.');
 }
 const site=env.CMS_SITE_ID||SITE;
 if(policy.site!==undefined&&policy.site!==site||policy.repository!==undefined&&policy.repository!==(env.CMS_REPOSITORY||''))deny('این حساب به سایت یا مخزن دیگری تعلق دارد.');
 const pages=policy.pages??['*'];
 if(!Array.isArray(pages)||!pages.length||pages.length>500||pages.some(p=>p!=='*'&&!(typeof p==='string'&&/^public\/(?!admin\/)(?:[a-z0-9-]+\/)*index\.html$/.test(p))))deny('محدودهٔ صفحات معتبر نیست.');
 for(const key of ['createPages','contacts'])if(policy[key]!==undefined&&typeof policy[key]!=='boolean')deny('محدودهٔ دسترسی معتبر نیست.');
 const actions=policy.pageActions??pageActions;
 if(!Array.isArray(actions)||actions.some(a=>!pageActions.includes(a)))deny('عملیات صفحه در محدودهٔ مجاز نیست.');
 return {...user,contentAccess:{site,pages,createPages:policy.createPages??true,contacts:policy.contacts??true,pageActions:actions}};
}
export function canAccessPage(user,path){return user?.role==='admin'||user?.role==='editor'&&(user.contentAccess?.pages||['*']).some(p=>p==='*'||p===path);}
export function assertPageAccess(user,path){pagePath(path);if(!canAccessPage(user,path))deny('این صفحه در محدودهٔ دسترسی شما نیست.');return path;}
export function assertPageCreation(user,path,creation){
 assertPageAccess(user,path);if(user.role==='admin')return;
 if(user.contentAccess?.createPages===false)deny('ساخت صفحه برای این حساب مجاز نیست.');
 if(!creation)return;
 const p=creation.page,language=path.startsWith('public/en/')?'en':'fa';
 if(creation.kind==='duplicate'||creation.template!=='blank'||creation.sourcePath!==(language==='en'?'public/en/index.html':'public/index.html')||!p||p.canonical!==SITE+routeFor(path)||p.robots!=='index'||p.visibility!=='public'||p.language!==language||p.direction!==(language==='en'?'ltr':'rtl')||p.menu?.included!==false||p.menu?.order!==0)deny('ساختار، منو و تنظیمات فنی صفحه فقط برای مدیر مجاز است.');
}
export function assertPageAction(user,body){
 assertPageAccess(user,body?.path);if(user.role==='admin')return;
 if(!(user.contentAccess?.pageActions||pageActions).includes(body.action)||Object.keys(body).some(k=>!['action','path','head','requestId','confirm','title'].includes(k)))deny('این عملیات یا تنظیمات صفحه فقط برای مدیر مجاز است.');
}
export function assertContacts(user,paths){
 if(user.role==='admin')return;
 if(user.contentAccess?.contacts===false||paths.some(path=>!canAccessPage(user,path)))deny('انتشار تماس سراسری به دسترسی همهٔ صفحات سایت نیاز دارد.');
}
// Final write boundary: derived indexes are server-generated, never arbitrary
// client files. A scoped operation cannot rewrite navigation on another page.
export function scopedRepository(repo,user){
 if(user.role==='admin')return repo;
 const scoped=Object.create(repo);
 scoped.commit=async(head,changes,message)=>{
  for(const change of changes){
   if(/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(change.path)){assertPageAccess(user,change.path);continue;}
   if(['public/builder-pages.json','public/sitemap.xml'].includes(change.path)&&!change.delete)continue;
   if(/^public\/assets\/uploads\/[a-f0-9]{64}\.(webp|png|jpg)$/.test(change.path)&&change.encoding==='base64'&&!change.delete)continue;
   deny('نوشتن فایل یا تنظیم فنی خارج از محدودهٔ محتوا مجاز نیست.');
  }
  return repo.commit(head,changes,message);
 };
 return scoped;
}
const stable=x=>Array.isArray(x)?x.map(stable):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const pageContent=['title','description','ogTitle','ogDescription','ogImage'];
function design(model,base=model,document){
 const copy=structuredClone(model);delete copy.base.restoreCommit;delete copy.base.title;
 for(const key of pageContent)delete copy.page[key];
 copy.sections=copy.sections.map(({label,content,...s})=>({...s,...(content&&Object.keys(content).some(k=>k!=='text')?{content:Object.fromEntries(Object.entries(content).filter(([k])=>k!=='text'))}:{})}));
 copy.elements=copy.elements.filter(e=>base.elements.some(n=>n.id===e.id)).map(({content,imageChanged,...e})=>{
  if(customerCanStyle(base,e.id))for(const style of [e.style,...Object.values(e.responsiveStyles||{})])for(const key of CUSTOMER_STYLE_KEYS)delete style[key];
  if(customerCanRemove(base,e.id,document))delete e.deleted;
  return e;
 });
 return copy;
}
export function enforceContentPermission(user,base,next,document){
 if(cmsPermissions(user).studio)return;
 if(!cmsPermissions(user).edit)deny('دسترسی ویرایش ندارید.');
 assertPageAccess(user,next.base.path);
 if(next.base.creation)assertPageCreation(user,next.base.path,next.base.creation);
 if(!same(design(base,base,document),design(next,base,document)))deny('تغییر طراحی حرفه‌ای یا بخش محافظت‌شده فقط برای مدیر مجاز است.');
 const additions=next.elements.filter(e=>!base.elements.some(n=>n.id===e.id));
 if(additions.length>50)deny('در هر انتشار حداکثر ۵۰ محتوای ساده اضافه کنید.');
 const orders=new Set();
 for(const e of next.elements){
  const old=base.elements.find(n=>n.id===e.id);
  if(!old){
   const minimum=Math.max(-1,...base.elements.filter(n=>n.parentId===e.parentId).map(n=>n.order||0))+1,key=e.parentId+':'+e.order;
   if(!customerSimpleLeaf(e)||!customerCanAdd(base,e.parentId,document)||!Number.isInteger(e.order)||e.order<minimum||orders.has(key))deny('فقط نوشته، عنوان، تصویر یا دکمهٔ ساده در بخش مجاز قابل افزودن است.');
   orders.add(key);
  }
  for(const device of ['desktop','tablet','mobile']){
   const before=device==='desktop'?old?.style:old?.responsiveStyles?.[device],after=device==='desktop'?e.style:e.responsiveStyles?.[device];
   for(const key of new Set([...Object.keys(before||{}),...Object.keys(after||{})]))if(!customerSame(before?.[key],after?.[key])){
    if(!CUSTOMER_STYLE_KEYS.includes(key)||old&&!customerCanStyle(base,e.id)||!customerStyleValue(key,after?.[key],e.type))deny('این ویژگی ظاهر در محدودهٔ ویرایش ساده نیست.');
   }
  }
  if(same(old?.content,e.content))continue;
  if(old&&protectedCustomerRegion(base,e.id))deny('محتوای پوستهٔ محافظت‌شده فقط برای طراح مجاز است؛ اطلاعات تماس را از بخش تماس تغییر دهید.');
  if(lockedBy(base,e.id))deny('تغییر محتوای بخش قفل‌شده فقط برای مدیر مجاز است.');
  const allowed=e.type==='image'?['src','alt','width','height','variants']:['text','runs','href'];
  const extra=content=>Object.fromEntries(Object.entries(content||{}).filter(([k])=>!allowed.includes(k)));
  if(!['text','heading','button','image'].includes(e.type)||!same(extra(old?.content),extra(e.content)))deny('این تغییر از محدودهٔ محتوای مجاز خارج است.');
 }
}
