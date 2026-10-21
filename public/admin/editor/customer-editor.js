import {History,clone} from '../builder/model.js';
import {lockedBy} from '../builder/locks.js';
import {createDraftSafety} from '../draft-safety.js';

// Suggestions are editable routes, never identities. Server route policy remains authoritative.
export function suggestSlug(title){
  const letters={'ا':'a','آ':'a','ب':'b','پ':'p','ت':'t','ث':'s','ج':'j','چ':'ch','ح':'h','خ':'kh','د':'d','ذ':'z','ر':'r','ز':'z','ژ':'zh','س':'s','ش':'sh','ص':'s','ض':'z','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'gh','ک':'k','ك':'k','گ':'g','ل':'l','م':'m','ن':'n','و':'v','ه':'h','ی':'y','ي':'y'};
  return [...title.toLowerCase().normalize('NFKD')].map(c=>letters[c]||c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70).replace(/-$/,'')||'new-page';
}
const names={text:'ویرایش نوشته',heading:'ویرایش عنوان',image:'تغییر تصویر',button:'ویرایش دکمه'};
export function installCustomerEditor(ctx){
  const $=s=>document.querySelector(s),dialog=$('#customer-dialog'),body=$('#customer-dialog-body'),sheet=$('#customer-selection');
  let busy=false,contact=null,contactSaving=Promise.resolve(),contactRevision=0;
  const contactSafety=createDraftSafety();
  $('#draft-save-export').textContent='دانلود پشتیبان';
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>run(fn);return b;};
  const note=text=>{const p=document.createElement('p');p.className='customer-note';p.textContent=text;return p;};
  const field=(form,id,label,value='',type='text')=>{const l=document.createElement('label');l.textContent=label;const input=document.createElement(type==='textarea'?'textarea':'input');input.id=id;input.name=id;input.value=value;if(type!=='textarea')input.type=type;input.dir='auto';l.append(input);form.append(l);return input;};
  async function run(fn){if(busy)return;busy=true;body.inert=true;$('#customer-error').textContent='';dialog.setAttribute('aria-busy','true');try{await fn();}catch(e){$('#customer-error').textContent=e.message;ctx.notice(e.message);}finally{busy=false;body.inert=false;dialog.removeAttribute('aria-busy');}}
  function open(title){$('#customer-tasks').hidden=true;$('#customer-menu').setAttribute('aria-expanded','false');sheet.hidden=true;body.replaceChildren();$('#customer-error').textContent='';$('#customer-dialog-title').textContent=title;if(!dialog.open)dialog.showModal();}
  async function persist(){if(await ctx.save()===false)throw Error('برای حفظ تغییرات، ذخیره را دوباره امتحان کنید یا پشتیبان بگیرید.');}
  function revealSelection(){
    const e=ctx.getElement(ctx.getSelected()[0]);
    if(!e||!names[e.type]||ctx.isReadOnly())return;
    $('#selection-label').textContent=names[e.type];
    $('#text').dir=ctx.getModel().page.direction;
    $('#customer-locked').hidden=!lockedBy(ctx.getModel(),e.id);
    if(e.type==='image')$('#selected-image-preview').src=e.content.src;else $('#selected-image-preview').removeAttribute('src');
    sheet.hidden=false;sheet.scrollTop=0;
  }
  $('#selection-close').onclick=()=>{sheet.hidden=true;$('.canvas-hit-plane')?.focus();};
  $('#customer-menu').onclick=()=>{const n=$('#customer-tasks');n.hidden=!n.hidden;$('#customer-menu').setAttribute('aria-expanded',String(!n.hidden));};
  $('#customer-dialog-close').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('#customer-backup').onclick=()=>ctx.exportDraft();
  new MutationObserver(()=>{const status=$('#customer-product-status');if(status)status.textContent=$('#save-status').textContent;}).observe($('#save-status'),{childList:true,subtree:true,characterData:true});
  $('#customer-history').onclick=()=>run(async()=>{
    open('نسخه‌های قبلی و پشتیبان');
    body.append(note('نسخهٔ قبلی ابتدا به‌صورت پیش‌نویس باز می‌شود؛ تا تأیید انتشار سایت تغییر نمی‌کند.'));
    for(const [id,label]of [['revisions','نسخه‌های منتشرشده'],['archives','پشتیبان‌های قبلی']]){
      const select=$('#'+id).cloneNode(true);select.id='customer-'+id;select.setAttribute('aria-label',label);select.onchange=()=>{$('#'+id).value=select.value;};body.append(select);
      body.append(button(id==='revisions'?'باز کردن نسخهٔ انتخاب‌شده':'دانلود پشتیبان قبلی',()=>{$('#'+(id==='revisions'?'load-revision':'download-archive')).click();if(id==='revisions')dialog.close();}));
    }
    body.append(button('باز کردن نسخهٔ فعلی',()=>{$('#load-current').click();dialog.close();}));
  });
  function fit(){const width=$('.canvas').clientWidth;if(!width)return;ctx.setDevice(width<=640?'mobile':width<1024?'tablet':'desktop',width);}
  new ResizeObserver(()=>requestAnimationFrame(fit)).observe($('.canvas'));
  window.visualViewport?.addEventListener('resize',()=>{if(sheet.contains(document.activeElement))document.activeElement.scrollIntoView({block:'nearest'});});
  function refresh(){
    const session=ctx.getSession();$('#studio-link').hidden=!session?.permissions?.studio;
    $('#customer-publish-help').hidden=!session?.user||!!session.permissions?.publish;
    $('[data-task="publish"]').disabled=!session?.permissions?.publish;
    $('#publish').title=session?.permissions?.publish?'انتشار تغییرات همین صفحه':'انتشار خارج از محدودهٔ دسترسی این حساب است';
    const selected=ctx.getElement(ctx.getSelected()[0]);if(selected?.type==='image'&&$('#selected-image-preview').getAttribute('src')!==selected.content.src)$('#selected-image-preview').src=selected.content.src;
    $('#studio-link').href='/admin/builder/?path='+encodeURIComponent(ctx.getPath());
    if(ctx.isReadOnly())sheet.hidden=true;
    const doc=ctx.getDocument();if(doc&&!doc.getElementById('customer-selection-style')){const style=doc.createElement('style');style.id='customer-selection-style';style.textContent='[data-builder-editing]{outline:3px solid #237658!important;outline-offset:4px}';doc.head.append(style);}
  }
  ctx.onUpdate(refresh);

  async function images(target=null){
    const path=ctx.getPath();open('تصاویر');
    if(!target)body.append(note('تصویر را روی سایت لمس کنید، سپس «انتخاب تصویر دیگر» را بزنید. تصاویر زیر برای دیدن کتابخانه‌اند.'));
    const search=field(body,'customer-image-search','جست‌وجوی تصویر','','search'),grid=document.createElement('div');grid.className='customer-grid';body.append(grid);
    const items=ctx.getLibrary().images;
    function draw(){grid.replaceChildren();for(const image of items.filter(i=>i.url.toLowerCase().includes(search.value.toLowerCase()))){
      const b=button(target?'انتخاب تصویر':'نمایش تصویر',()=>{
        if(!target){open('تصویر کتابخانه');const img=document.createElement('img');img.src=image.url;img.alt=image.path.split('/').at(-1);img.style.maxWidth='100%';body.append(img);return;}
        if(path!==ctx.getPath())throw Error('صفحه تغییر کرده است؛ تصویر را دوباره انتخاب کنید.');
        const changed=ctx.mutate(next=>{const e=next.elements.find(e=>e.id===target);if(!e||e.type!=='image')return;e.content.src=image.url;delete e.content.variants;delete e.content.width;delete e.content.height;});
        if(!changed)throw Error('این تصویر تغییری نکرده یا بخش محافظت شده است.');
        dialog.close();ctx.select(target);ctx.notice('تصویر در پیش‌نویس عوض شد؛ هنوز منتشر نشده است.');
      });const img=document.createElement('img');img.src=image.url;img.alt=image.path.split('/').at(-1);img.loading='lazy';const label=document.createElement('small');label.textContent=img.alt;b.prepend(img);b.append(label);grid.append(b);
    }}search.oninput=draw;draw();
  }
  $('#customer-replace-image').onclick=()=>run(()=>images(ctx.getSelected()[0]));

  async function pages(){
    await persist();open('صفحات سایت');
    const listing=await ctx.api('/builder/pages'),drafts=await ctx.dbRecord(`pages-drafts:${ctx.getUser()}`)||[];
    body.append(button('+ صفحهٔ تازه',newPage));
    const all=[...drafts.filter(d=>!listing.pages.some(p=>p.path===d.path)).map(d=>({...d,status:'draft'})),...listing.pages.filter(p=>p.status==='published')];
    const list=document.createElement('div');list.className='customer-list';body.append(list);
    for(const page of all)list.append(button(`${page.title} · ${page.path.startsWith('public/en/')?'English':'فارسی'}${page.status==='draft'?' · پیش‌نویس':''}`,async()=>{await ctx.loadPage(page.path);dialog.close();}));
  }
  function newPage(){
    open('ساخت صفحهٔ ساده');const form=document.createElement('form');body.append(form);
    const title=field(form,'customer-page-title','عنوان صفحه');title.required=true;title.maxLength=180;
    const language=document.createElement('select');language.id='customer-page-language';language.setAttribute('aria-label','زبان صفحه');language.add(new Option('فارسی','fa'));language.add(new Option('English','en'));form.append(language);
    const slug=field(form,'customer-page-address','آدرس پیشنهادی','new-page');slug.dir='ltr';slug.pattern='[a-z0-9][a-z0-9-]*';slug.required=true;slug.maxLength=78;let manual=false;
    const route=note('/new-page/');route.className='customer-route';form.append(route);
    const description=field(form,'customer-page-description','متن معرفی','','textarea');description.maxLength=600;
    const suggest=()=>{if(!manual)slug.value=suggestSlug(title.value);route.textContent=`/${language.value==='en'?'en/':''}${slug.value}/`;};title.oninput=suggest;slug.oninput=()=>{manual=true;suggest();};language.onchange=suggest;
    const submit=button('ساخت پیش‌نویس',()=>{});submit.type='submit';submit.onclick=null;form.append(note('آدرس خودکار پیشنهاد می‌شود و قابل تغییر است. صفحه تا زمان انتشار فقط در همین مرورگر می‌ماند.'),submit);
    form.onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!form.reportValidity())return;await persist();
      const key=`pages-drafts:${ctx.getUser()}`,drafts=await ctx.dbRecord(key)||[];
      const prepared=await ctx.api('/builder/pages/prepare',{title:title.value.trim(),slug:slug.value,language:language.value,description:description.value,template:'blank'});
      if(drafts.some(d=>d.path===prepared.model.base.path))throw Error('صفحه‌ای با این آدرس در پیش‌نویس‌ها هست؛ آدرس دیگری انتخاب کنید.');
      await ctx.dbRecord(`prepared:${ctx.getUser()}:${prepared.model.base.path}`,prepared);
      await ctx.dbRecord(key,[...drafts,{path:prepared.model.base.path,title:title.value,preparedAt:new Date().toISOString()}]);
      await ctx.openPrepared(prepared);dialog.close();ctx.notice('صفحه ساخته و پیش‌نویس ذخیره شد. نوشته را روی سایت لمس کنید.');
    });};
  }
  async function products(){
    await persist();const path=ctx.getModel().page.language==='en'?'public/en/catalog/index.html':'public/catalog/index.html';
    if(ctx.getPath()!==path)await ctx.loadPage(path);
    open('محصولات');const nodes=[...ctx.getDocument().querySelectorAll('.product-card[id]')];
    if(!nodes.length){body.append(note('این صفحه کاتالوگ تصویری یا فایل معرفی است. نوشته یا تصویر موردنظر را روی سایت لمس کنید.'),button('ویرایش کاتالوگ روی سایت',()=>dialog.close()));return;}
    const grid=document.createElement('div');grid.className='customer-grid';body.append(grid);
    for(const node of nodes){const heading=node.querySelector('h2,h3'),image=node.querySelector('img'),id=heading?.dataset.builderId;
      if(!id)continue;const b=button(heading.textContent.trim(),()=>product(node.id));if(image){const img=document.createElement('img');img.src=image.src;img.alt='';b.prepend(img);}grid.append(b);
    }
  }
  function product(productId){
    const node=ctx.getDocument().getElementById(productId);open('ویرایش محصول');
    const controls=document.createElement('div');body.append(controls,note('تمام تغییرات این محصول در همان پیش‌نویس صفحه ذخیره می‌شوند؛ انتشار، تغییرات کل همین صفحه را ثبت می‌کند.'));
    const status=note($('#save-status').textContent);status.id='customer-product-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');body.append(status);
    const ids=[...node.querySelectorAll('[data-builder-id]')].map(n=>n.dataset.builderId),entries=ctx.getModel().elements.filter(e=>ids.includes(e.id)&&!e.deleted);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='مشخصات و جزئیات محصول';details.append(summary);
    const mainHeading=node.querySelector('h2'),description=node.querySelector('.product-copy > p:not(.section-kicker):not(.price)'),price=node.querySelector('.price strong');
    for(const e of entries.filter(e=>['heading','text'].includes(e.type))){
      const n=ctx.getNode(e.id),primary=n===mainHeading||n===description||n===price;
      if(!primary&&!n.matches('dd,li')&&!n.closest('.spec-list,.set-list'))continue;
      const label=n===mainHeading?'نام محصول':n===description?'معرفی محصول':n===price?'قیمت':n.matches('dd')?n.previousElementSibling?.textContent||'مشخصات':'جزئیات';
      const input=field(primary?controls:details,'product-'+e.id,label,e.content.text,n===description?'textarea':'text');input.maxLength=12000;input.disabled=!!lockedBy(ctx.getModel(),e.id);
      input.oninput=()=>ctx.mutate(next=>{const target=next.elements.find(n=>n.id===e.id);target.content.text=input.value;delete target.content.runs;},false);
    }
    for(const e of entries.filter(e=>e.type==='image')){const img=document.createElement('img');img.src=e.content.src;img.alt=e.content.alt||'';img.style.cssText='width:120px;height:100px;object-fit:cover';controls.append(img,button('تغییر تصویر محصول',()=>images(e.id)),button('بارگذاری تصویر محصول',()=>{dialog.close();ctx.select(e.id);$('#upload').click();}));}
    controls.append(details,button('ذخیرهٔ محصول',async()=>{await persist();dialog.close();ctx.notice('محصول در پیش‌نویس ذخیره شد؛ برای انتشار از دکمهٔ انتشار استفاده کنید.');}),button('دانلود پشتیبان صفحه',()=>ctx.exportDraft()));
  }
  const contactKey=()=>`contacts:${ctx.getUser()}`;
  function downloadContact(value){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));a.href=url;a.download='baran-contact-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function saveContact(){
    const snapshot=clone(contact),version=contactRevision;
    const save=contactSaving.catch(()=>{}).then(()=>ctx.dbRecord(contactKey(),snapshot));contactSaving=save;
    try{await save;contactSafety.saved(version);if($('#contact-save-status'))$('#contact-save-status').textContent=version===contactRevision?'اطلاعات تماس در پیش‌نویس ذخیره شد؛ هنوز منتشر نشده':'در حال ذخیره…';return true;}
    catch{if($('#contact-save-status'))$('#contact-save-status').textContent='ذخیره ناموفق؛ این تب را باز نگه دارید و دوباره ذخیره کنید.';return false;}
  }
  async function contacts(){
    await persist();open('اطلاعات تماس');
    if(!contact){const live=await ctx.api('/contacts'),saved=await ctx.dbRecord(contactKey());contact=saved||{head:live.head,history:new History(live.values).serialize()};contactSafety.reset();}
    const h=new History(contact.history.present,contact.history),form=document.createElement('form');body.append(note('این اطلاعات پس از انتشار روی همهٔ صفحات اعمال می‌شود. آدرس فارسی فقط در صفحات فارسی تغییر می‌کند.'),form);
    const labels={phone:'شماره تماس با کد کشور',email:'ایمیل',whatsapp:'واتساپ',instagram:'اینستاگرام',telegram:'تلگرام',bale:'بله',address:'آدرس فارسی'};
    for(const [key,label]of Object.entries(labels)){const input=field(form,'contact-'+key,label,h.present[key],key==='address'?'textarea':'text');input.maxLength=key==='address'?300:2000;input.oninput=()=>{h.commit({...h.present,[key]:input.value});contact.history=h.serialize();contactRevision=contactSafety.changed();$('#contact-save-status').textContent='در حال ذخیره…';for(const b of document.querySelectorAll('[data-contact-travel]'))b.disabled=b.dataset.contactTravel==='undo'?!h.past.length:!h.future.length;saveContact();};}
    const state=note('پیش‌نویس تماس؛ هنوز منتشر نشده');state.id='contact-save-status';state.setAttribute('role','status');state.setAttribute('aria-live','polite');body.append(state);
    const actions=document.createElement('div');actions.className='customer-inline';body.append(actions);
    for(const [direction,label]of [['undo','واگرد تماس'],['redo','بازانجام تماس']]){const b=button(label,async()=>{if(h[direction]()){contact.history=h.serialize();contactRevision=contactSafety.changed();await saveContact();await contacts();}});b.dataset.contactTravel=direction;b.disabled=direction==='undo'?!h.past.length:!h.future.length;actions.append(b);}
    actions.append(button('ذخیرهٔ تماس',async()=>{if(!await saveContact())throw Error('ذخیره ناموفق بود؛ پشتیبان تماس را دانلود کنید.');}),button('دانلود پشتیبان تماس',()=>downloadContact(contact)),button('پیش‌نمایش تماس',async()=>{const result=await ctx.api('/contacts/preview',{head:contact.head,values:h.present,path:ctx.getModel().base.creation?'public/index.html':ctx.getPath()});$('#output-frame').srcdoc=result.html;$('#output-dialog').showModal();}));
    const recovery=document.createElement('details'),summary=document.createElement('summary');summary.textContent='پشتیبان‌های تماس و بازیابی';recovery.append(summary);body.append(recovery);
    const restore=field(recovery,'contact-import','بازیابی پشتیبان تماس','','file');restore.accept='application/json,.json';
    restore.onchange=()=>run(async()=>{
      const file=restore.files[0];if(!file)return;if(file.size>1000000)throw Error('فایل پشتیبان تماس باید کوچک‌تر از یک مگابایت باشد.');
      let saved;try{saved=JSON.parse(await file.text());}catch{throw Error('این فایل پشتیبان معتبر نیست.');}
      if(!saved||!saved.history||!Array.isArray(saved.history.past)||!Array.isArray(saved.history.future))throw Error('این فایل پشتیبان تماس معتبر نیست.');
      const states=[saved.history.present,...saved.history.past,...saved.history.future];
      if(typeof saved.head!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(saved.head)||!saved.history||!Array.isArray(saved.history.past)||!Array.isArray(saved.history.future)||saved.history.past.length>120||saved.history.future.length>120||states.some(state=>!state||Object.keys(labels).some(key=>typeof state[key]!=='string'||state[key].length>(key==='address'?300:2000))))throw Error('پشتیبان تماس با این ویرایشگر سازگار نیست؛ فایل اصلی را نگه دارید.');
      await ctx.dbRecord(`archive:${contactKey()}:${Date.now()}`,contact);
      contact={head:saved.head,history:new History(saved.history.present,saved.history).serialize(),...(saved.published?{published:saved.published}:{})};contactRevision=contactSafety.changed();
      if(!await saveContact())throw Error('بازیابی در این تب انجام شد اما ذخیره ناموفق بود؛ دوباره ذخیره کنید.');
      await contacts();ctx.notice('اطلاعات تماس و واگردها از پشتیبان بازیابی شدند؛ هنوز منتشر نشده است.');
    });
    recovery.append(button('نمایش پشتیبان‌های قبلی تماس',async()=>{const keys=await ctx.listRecords(`archive:${contactKey()}:`);for(const key of keys.sort().reverse())recovery.append(button('دانلود پشتیبان '+new Date(Number(key.split(':').at(-1))).toLocaleString('fa-IR'),async()=>downloadContact(await ctx.dbRecord(key))));if(!keys.length)recovery.append(note('هنوز پشتیبان قبلی در این مرورگر وجود ندارد.'));}));
    body.append(button('بررسی اطلاعات فعلی سایت',async()=>{
      if(contactSafety.atRisk&&!await saveContact())throw Error('پیش از ادامه، ذخیره را دوباره امتحان کنید یا پشتیبان بگیرید.');
      open('باز کردن اطلاعات فعلی');body.append(note('پیش‌نویس فعلی ابتدا در پشتیبان‌های این مرورگر نگه داشته می‌شود؛ سپس اطلاعات فعلی سایت باز می‌شود.'),button('نگه‌داشتن پشتیبان و باز کردن اطلاعات فعلی',async()=>{await ctx.dbRecord(`archive:${contactKey()}:${Date.now()}`,contact);await ctx.dbRecord(contactKey(),null);contact=null;await contacts();}));
    }));
    const publish=button('انتشار تماس در همهٔ صفحات',async()=>{
      if(!await saveContact()||contactSafety.atRisk)throw Error('ابتدا ذخیرهٔ پیش‌نویس را دوباره امتحان کنید.');
      open('تأیید انتشار اطلاعات تماس');body.append(note('اطلاعات تماس ذخیره‌شده در همهٔ صفحات ثبت می‌شود. پیش‌نویس‌های باز صفحات ممکن است پس از این کار نیاز به بازکردن نسخهٔ تازه داشته باشند.'),button('تأیید انتشار تماس',async()=>{
        const result=await ctx.api('/contacts',{head:contact.head,values:contact.history.present});
        // Store the exact successful receipt before allowing a second publication.
        contact.published=result;await ctx.dbRecord(contactKey(),contact);
        body.replaceChildren(note(ctx.getSession().mode==='local'?'اطلاعات تماس در فایل‌های محلی ثبت شد؛ انتشار آنلاین انجام نشده است.':'اطلاعات تماس ثبت شد؛ وضعیت انتشار آنلاین هنوز تأیید نشده است.'));
        if(ctx.getSession().mode!=='local')body.append(button('بررسی انتشار تماس',async()=>{const status=await ctx.api('/builder/status?sha='+encodeURIComponent(result.sha));body.append(note(status.deployment==='success'&&['cloudflare-active-production-version','github-cloudflare-production-deployment'].includes(status.evidence)?'انتشار آنلاین همین نسخه تأیید شد.':'انتشار آنلاین همین نسخه هنوز تأیید نشده است.'));}));
        body.append(button('باز کردن اطلاعات ثبت‌شده',async()=>{await ctx.dbRecord(`archive:${contactKey()}:${Date.now()}`,contact);contact=null;await ctx.dbRecord(contactKey(),null);await contacts();}));
      }));
    });publish.disabled=!ctx.getSession().permissions.publish||!!contact.published;body.append(publish);
    if(contact.published)body.append(note('این پیش‌نویس قبلاً ثبت شده است؛ برای شروع دوباره اطلاعات فعلی را باز کنید.'),button('باز کردن اطلاعات فعلی',async()=>{await ctx.dbRecord(`archive:${contactKey()}:${Date.now()}`,contact);contact=null;await ctx.dbRecord(contactKey(),null);await contacts();}));
  }
  window.addEventListener('pagehide',()=>{if(contact&&contactSafety.atRisk)saveContact();});
  for(const task of document.querySelectorAll('[data-task]'))task.onclick=()=>run(async()=>{
    $('#customer-tasks').hidden=true;$('#customer-menu').setAttribute('aria-expanded','false');
    const name=task.dataset.task;
    if(name==='edit'){
      open('ویرایش سایت');body.append(note('نوشته یا تصویر را روی سایت لمس کنید، یا از فهرست زیر انتخاب کنید.'));
      const list=document.createElement('div');list.className='customer-list';body.append(list);
      for(const e of ctx.getModel().elements.filter(e=>!e.deleted&&names[e.type]))list.append(button((e.content.text||e.content.alt||names[e.type]).slice(0,90),()=>{dialog.close();ctx.getNode(e.id)?.scrollIntoView({block:'center'});ctx.select(e.id);}));return;
    }
    if(name==='pages')return pages();if(name==='products')return products();if(name==='images')return images();if(name==='contact')return contacts();
    if(name==='preview')$('#public-preview').click();if(name==='publish')$('#publish').click();
  });
  return {revealSelection,cancelReveal:()=>{},get mode(){return 'customer';}};
}
