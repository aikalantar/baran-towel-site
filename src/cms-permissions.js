import {CMSFailure} from './content.js';
export const cmsPermissions=user=>({edit:['admin','editor'].includes(user?.role),studio:user?.role==='admin',publish:user?.role==='admin'});
// Customer accounts may change content, never structure, locks or styling.
// This runs on the server's trusted base, independent of route or browser flags.
export function enforceContentPermission(user,base,next){
  if(cmsPermissions(user).studio)return;
  if(!cmsPermissions(user).edit)throw new CMSFailure('دسترسی ویرایش ندارید.',403);
  if(next.base.creation&&(next.base.creation.kind==='duplicate'||next.base.creation.template!=='blank'))throw new CMSFailure('طراحی و تکثیر حرفه‌ای فقط برای مدیر مجاز است.',403);
  const withoutContent=model=>({...model,elements:model.elements.map(({content,...e})=>e)});
  if(JSON.stringify(withoutContent(base))!==JSON.stringify(withoutContent(next)))throw new CMSFailure('تغییر طراحی فقط برای مدیر مجاز است.',403);
}
