// Presentation only: use the existing controls and mutation/permission paths.
// UI preferences never become part of a draft, history or published page.
import {lockedBy} from './locks.js';

const preferenceKey='baran-builder-ui-mode';
const simpleFields={
  text:['fontFamily','fontSize','color','textAlign'],heading:['fontFamily','fontSize','color','textAlign'],
  button:['fontFamily','fontSize','color','textAlign','backgroundColor','padding','borderRadius'],
  image:['objectFit','focalX','focalY'],section:['backgroundColor','padding','margin','display','gridColumns','gap','flexDirection'],
  container:['backgroundColor','padding','margin','display','gridColumns','gap','flexDirection'],
  divider:['backgroundColor','borderColor','borderWidth'],spacer:[],
};
const names={text:'متن',heading:'عنوان',image:'تصویر',button:'دکمه',section:'بخش',container:'بلوک',divider:'جداکننده',spacer:'فاصله'};
const fieldLabels={fontSize:'اندازه نوشته',color:'رنگ نوشته',textAlign:'تراز نوشته',backgroundColor:'رنگ پس‌زمینه',padding:'فاصلهٔ داخلی',margin:'فاصلهٔ بیرونی',display:'چیدمان محتوا',gridColumns:'تعداد ستون‌ها',gap:'فاصلهٔ بین محتوا',flexDirection:'جهت چیدمان',objectFit:'نمایش تصویر',borderRadius:'گردی گوشه‌ها'};

export function installCustomerUI(ctx,professional){
  const $=s=>document.querySelector(s),aside=$('.inspector'),properties=$('#properties'),panel=$('#professional-controls');
  let mode='simple',scheduled=0,revealHandler;
  try{if(localStorage.getItem(preferenceKey)==='advanced')mode='advanced';}catch{}
  const section=document.createElement('section');section.id='selection-inspector';section.setAttribute('aria-label','تنظیمات انتخاب');
  section.innerHTML='<div class="selection-header"><div><span class="selection-eyebrow">انتخاب روی صفحه</span><h2 id="context-title">چه چیزی را ویرایش می‌کنید؟</h2></div><button id="selection-edit" type="button">ویرایش</button></div><p id="selection-help" class="muted">روی متن، تصویر یا یک بلوک کلیک کنید؛ تنظیمات همان مورد اینجا باز می‌شود.</p><button id="select-parent" type="button" hidden>انتخاب بخش والد</button><p id="selection-locked" class="muted" role="status" hidden>این عنصر یا بخش والد قفل است؛ برای مدیریت قفل، حالت پیشرفته را باز کنید.</p><div id="context-controls"></div>';
  aside.insertBefore(section,$('#block-library'));
  $('#context-controls').append(properties,panel);
  const actions=document.createElement('div');actions.className='selection-actions';
  for(const tools of properties.querySelectorAll(':scope > .tools'))if(tools.id!=='rich-tools')actions.append(tools);
  $('#context-controls').append(actions);
  const title=$('#selection-label');title.hidden=true;
  const jump=document.createElement('nav');jump.className='inspector-shortcuts';jump.setAttribute('aria-label','بخش‌های ویرایشگر');
  for(const [target,label]of [['selection-inspector','ویرایش انتخاب'],['block-library','افزودن بلوک'],['layers-panel','عناصر صفحه']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>scrollToControl(document.getElementById(target));jump.append(button);
  }
  section.before(jump);
  const action=document.createElement('button');action.id='canvas-edit-selection';action.type='button';action.hidden=true;$('.canvas-label').prepend(action);
  for(const node of [panel.querySelector('h2'),panel.querySelector('.pro-selection-note'),panel.querySelector('.pro-action-grid'),panel.querySelector('.pro-align-grid')?.closest('details'),$('#pro-layout-mode')?.closest('label'),$('#pro-layout-mode')?.closest('label')?.nextElementSibling,$('#pro-reset-style')])if(node)node.dataset.advancedOnly='';
  const fields=[...panel.querySelectorAll('.pro-field')];
  for(const field of fields){const label=field.querySelector('label');field.dataset.style=field.querySelector('[data-pro-style]').dataset.proStyle;field.dataset.label=label.firstChild.textContent;}

  const entries=()=>{const model=ctx.getModel();return model?[...model.sections,...model.elements].filter(e=>!e.deleted&&ctx.getSelected().includes(e.id)):[];};
  const kind=e=>ctx.getModel().sections.some(s=>s.id===e.id)?'section':e.type;
  const primary=()=>{
    const chosen=entries();if(!chosen.length)return null;
    if(chosen.length>1)return [...panel.querySelectorAll('input,select')].find(n=>!n.disabled&&n.getClientRects().length)||$('#context-title');
    const type=kind(chosen[0]);return type==='image'?$('#change-image'):['text','heading','button'].includes(type)?$('#text'):['section','container'].includes(type)?$('#pro-backgroundColor'):$('#height');
  };
  function scrollToControl(target){
    if(!target)return;
    if(matchMedia('(max-width: 900px)').matches){target.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});}
    else{const a=aside.getBoundingClientRect(),r=target.getBoundingClientRect();aside.scrollTop+=r.top-a.top-20;}
  }
  function revealSelection(focus=false){
    if(ctx.isReadOnly())return;
    const handled=revealHandler?.(false);
    cancelAnimationFrame(scheduled);
    const key=ctx.getSelected().join('|');
    scheduled=requestAnimationFrame(()=>{
      if(key!==ctx.getSelected().join('|')||!entries().length)return;
      // Open only relevant appearance groups. Content editing remains first.
      for(const details of panel.querySelectorAll('.pro-details'))if(!details.hidden&&mode==='simple')details.open=true;
      const type=kind(entries()[0]);
      for(const key of (['text','heading','button'].includes(type)?['fontSize',...(type==='button'?['backgroundColor']:[])]:type==='image'?['objectFit']:['backgroundColor'])){
        const details=$('#pro-'+key)?.closest('details');if(details&&!details.hidden)details.open=true;
      }
      if(entries().some(e=>kind(e)==='image'))$('#image-picker').open=true;
      const target=primary();
      for(let details=target?.closest('details');details;details=details.parentElement?.closest('details'))details.open=true;
      if(handled){if(focus)revealHandler?.(true);return;}
      scrollToControl(section);
      if(target){const r=target.getBoundingClientRect(),a=aside.getBoundingClientRect();if(r.bottom>(matchMedia('(max-width: 900px)').matches?innerHeight:a.bottom)-12)scrollToControl(target);}
      if(focus&&target&&!target.disabled){target.focus({preventScroll:true});if(target===$('#text'))target.select();}
    });
  }
  function refresh(){
    const chosen=entries(),first=chosen[0],types=chosen.map(kind),multiple=chosen.length>1;
    section.dataset.selectionType=multiple?'multiple':first?kind(first):'none';
    $('#context-controls').hidden=!first;$('#selection-help').hidden=!!first;
    const label=multiple?`${chosen.length.toLocaleString('fa-IR')} عنصر`:names[types[0]]||'عنصر';
    $('#context-title').textContent=first?`تنظیمات ${label}`:'چه چیزی را ویرایش می‌کنید؟';
    $('#selection-edit').hidden=!first;action.hidden=!first;
    const editLabel=multiple?'ویرایش ظاهر':types[0]==='image'?'تغییر تصویر':types[0]==='button'?'ویرایش دکمه':['text','heading'].includes(types[0])?'ویرایش نوشته':'ویرایش بخش';
    $('#selection-edit').textContent=action.textContent=editLabel;
    const isLocked=first&&chosen.some(e=>lockedBy(ctx.getModel(),e.id));
    $('#selection-locked').hidden=!isLocked;$('#selection-edit').disabled=action.disabled=!!isLocked||ctx.isReadOnly();
    actions.inert=ctx.isReadOnly();
    const parent=first&&[...ctx.getModel().sections,...ctx.getModel().elements].find(e=>e.id===first.parentId&&!e.deleted);
    $('#select-parent').hidden=!parent||multiple;
    $('#select-parent').textContent=parent?`انتخاب ${names[kind(parent)]||'بخش'} والد`:'';
    $('#select-parent').onclick=()=>{if(parent)ctx.select(parent.id);};
    $('#properties').dataset.contentHidden=mode==='simple'&&multiple?'true':'false';
    $('#selection-size').hidden=mode==='simple'&&(multiple||!['image','divider','spacer'].includes(types[0]));
    for(const coordinate of ['x','y','width'])$('#'+coordinate).closest('label').dataset.simpleHidden=types[0]==='spacer'?'true':'false';
    const allowed=new Set(first?(simpleFields[types[0]]||[]):[]);
    if(multiple)for(const key of allowed)if(types.some(t=>!simpleFields[t]?.includes(key)))allowed.delete(key);
    for(const field of fields){field.hidden=mode==='simple'&&!allowed.has(field.dataset.style);field.querySelector('label').firstChild.textContent=mode==='simple'?(fieldLabels[field.dataset.style]||field.dataset.label):field.dataset.label;}
    for(const details of panel.querySelectorAll('.pro-details'))if(mode==='simple'&&!details.querySelector('.pro-field:not([hidden])'))details.hidden=true;
    if(first?.type==='image'&&$('#selected-image-preview').getAttribute('src')!==first.content.src)$('#selected-image-preview').src=first.content.src;
    if(!first)$('#selected-image-preview').removeAttribute('src');
    const textLabel=types[0]==='button'?'متن روی دکمه':'نوشتهٔ انتخاب‌شده';$('#text-group').firstChild.textContent=textLabel;
    $('#text').rows=types[0]==='button'?2:4;
    document.body.dataset.uiMode=mode;
    for(const value of ['simple','advanced'])$('#mode-'+value).setAttribute('aria-pressed',String(value===mode));
    // Styling is confined to the inert editor iframe; never serialized/published.
    const doc=ctx.getDocument();
    if(doc&&!doc.getElementById('customer-selection-style')){const style=doc.createElement('style');style.id='customer-selection-style';style.textContent='html:not([data-builder-preview]) [data-builder-editing]{outline:3px solid #237658!important;outline-offset:4px}';doc.head.append(style);}
  }
  function setMode(value){mode=value;try{localStorage.setItem(preferenceKey,value);}catch{}professional.refresh();refresh();revealSelection();}
  $('#mode-simple').onclick=()=>setMode('simple');$('#mode-advanced').onclick=()=>setMode('advanced');
  $('#selection-edit').onclick=action.onclick=()=>revealSelection(true);
  ctx.onUpdate(refresh);refresh();
  return {refresh,revealSelection,cancelReveal:()=>cancelAnimationFrame(scheduled),setRevealHandler:fn=>{revealHandler=fn;},get mode(){return mode;}};
}
