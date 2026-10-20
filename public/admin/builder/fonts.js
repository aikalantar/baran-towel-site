// Pinned, unmodified OFL fonts. Provenance and licenses: /assets/builder-fonts/.
export const FONT_CATALOG = [
  {id:'Vazirmatn',label:'وزیرمتن · Vazirmatn',files:[['vazirmatn-variable.woff2','100 900']]},
  {id:'Estedad',label:'استعداد · Estedad',files:[['estedad-variable.woff2','100 900']]},
  {id:'Shabnam',label:'شبنم · Shabnam',files:[['shabnam-regular.woff2','400'],['shabnam-bold.woff2','700']]},
  {id:'Sahel',label:'ساحل · Sahel',files:[['sahel-variable.woff2','400 900']]},
  {id:'Inter',label:'Inter · انگلیسی',files:[['inter-variable.woff2','100 900']]},
  {id:'Lato',label:'Lato · انگلیسی',files:[['lato-400.woff2','400'],['lato-700.woff2','700']]},
];
export const FONT_IDS=['Tahoma','Arial','Georgia','system-ui',...FONT_CATALOG.map(f=>f.id)];
export function fontStack(id){
  if(!FONT_IDS.includes(id))throw Error('قلم نامعتبر است.');
  return id==='system-ui'?'system-ui,Tahoma,sans-serif':id==='Georgia'?'Georgia,serif':`"${id}",Tahoma,Arial,sans-serif`;
}
export function fontFacesFor(families){
  const chosen=new Set(families);
  return FONT_CATALOG.filter(f=>chosen.has(f.id)).flatMap(f=>f.files.map(([file,weight])=>`@font-face{font-family:"${f.id}";font-style:normal;font-weight:${weight};font-display:swap;src:url("/assets/builder-fonts/${file}") format("woff2")}`)).join('');
}
export function fontFacesCSS(elements){
  return fontFacesFor(elements.filter(e=>!e.deleted).flatMap(e=>[e.style?.fontFamily,...Object.values(e.responsiveStyles||{}).map(s=>s.fontFamily)]));
}
export function installFontPreview(ctx){
  const input=document.querySelector('#pro-fontFamily'),sample=document.createElement('p'),faces=document.createElement('style');
  sample.id='font-preview';sample.dir='auto';sample.setAttribute('aria-label','نمونه قلم روی نوشته انتخاب‌شده');
  input.options[0].textContent='قلم فعلی سایت / ارث‌بری';
  input.closest('.pro-field').append(sample);document.head.append(faces);
  ctx.onUpdate(()=>{
    const e=ctx.getElement(ctx.getSelected()[0]);
    const node=ctx.getNode(e?.id),inherited=!input.value&&node?node.ownerDocument.defaultView?.getComputedStyle(node).fontFamily||'inherit':'inherit';
    const inheritedNames=inherited.split(',').map(name=>name.trim().replace(/^["']|["']$/g,''));
    const family=input.value||FONT_CATALOG.find(font=>inheritedNames.includes(font.id))?.id;
    faces.textContent=fontFacesFor([family]);
    sample.style.fontFamily=input.value?fontStack(input.value):inherited;
    sample.textContent=(e?.content?.text||ctx.getNode(e?.id)?.textContent||'باران، زیبایی در زندگی · Beautiful everyday').trim().slice(0,180);
  });
}
