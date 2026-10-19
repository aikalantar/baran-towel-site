// Page operations use the existing authenticated CMS client. New pages remain
// IndexedDB drafts until the normal, confirmed Builder publication flow.
export function installPagesUI(ctx) {
  if(document.querySelector("#pages-manager"))return;
  const style=document.createElement("style");
  style.textContent=`#pages-manager{width:min(1000px,94vw);max-height:90dvh;overflow:auto;border:1px solid #d8dee8;border-radius:16px;padding:20px;color:#172033;background:#fff;font:14px Tahoma,Arial,sans-serif}#pages-manager::backdrop{background:#17203399}#pages-manager h2{margin:0}#pages-manager .pm-header,#pages-manager .pm-tabs,#pages-manager .pm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#pages-manager .pm-header{justify-content:space-between}#pages-manager .pm-tabs{margin:16px 0;border-bottom:1px solid #d8dee8;padding-bottom:10px}#pages-manager button{padding:9px 12px;border:1px solid #cdd6e2;border-radius:7px;background:#f6f8fc;color:#172033;cursor:pointer;font:inherit}#pages-manager button[aria-selected=true],#pages-manager .pm-primary{background:#1e4e95;color:#fff}#pages-manager button:disabled{opacity:.55;cursor:default}#pages-manager input,#pages-manager textarea,#pages-manager select{box-sizing:border-box;width:100%;padding:9px;border:1px solid #bcc8d8;border-radius:6px;background:white;color:#172033;font:inherit}#pages-manager label{display:grid;gap:7px;margin:10px 0}#pages-manager label.pm-check{display:flex;align-items:center;gap:8px}#pages-manager input[type=checkbox]{width:auto}#pages-manager .pm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px}#pages-manager .pm-muted{color:#58677b;line-height:1.9}#pages-manager .pm-list{display:grid;gap:10px}#pages-manager .pm-row{padding:12px;border:1px solid #d8dee8;border-radius:10px;display:grid;gap:9px}#pages-manager .pm-row strong{font-size:15px}#pages-manager .pm-route{font:12px ui-monospace,monospace;direction:ltr;overflow-wrap:anywhere;text-align:right}#pages-manager .pm-danger{color:#a12020;border-color:#e6b7b7}#pages-manager .pm-error{color:#a12020;white-space:pre-wrap;line-height:1.9}#pages-manager .pm-warning{background:#fff7df;border:1px solid #e8d5a4;border-radius:8px;padding:10px;line-height:1.9}#pages-manager [hidden]{display:none!important}#pages-manager .pm-span{grid-column:1/-1}@media(max-width:640px){#pages-manager{padding:12px}#pages-manager .pm-grid{grid-template-columns:1fr}}`;
  document.head.append(style);
  const dialog=document.createElement("dialog");dialog.id="pages-manager";dialog.dir="rtl";
  dialog.setAttribute("aria-labelledby","pages-manager-title");
  dialog.innerHTML=`<div class="pm-header"><h2 id="pages-manager-title">صفحات و تنظیمات سایت</h2><button type="button" id="pm-close" aria-label="بستن مدیریت صفحات">بستن ×</button></div>
    <p id="pm-environment" class="pm-muted"></p><div class="pm-tabs" role="tablist" aria-label="مدیریت صفحات"><button role="tab" data-pm-tab="list" aria-selected="true">صفحات</button><button role="tab" data-pm-tab="create" aria-selected="false">صفحه جدید / تکثیر</button><button role="tab" data-pm-tab="seo" aria-selected="false">تنظیمات پیش‌نویس فعلی</button></div>
    <p id="pm-message" role="status" aria-live="polite"></p><p id="pm-error" class="pm-error" role="alert"></p>
    <section data-pm-panel="list"><div class="pm-actions"><button type="button" id="pm-refresh">تازه‌سازی فهرست</button></div><p class="pm-muted">صفحات منتشرنشده فقط در همین مرورگر ذخیره می‌شوند. نسخه‌های بایگانی‌شده با سابقهٔ انتشار قابل بازیابی‌اند.</p><div id="pm-pages" class="pm-list"></div></section>
    <section data-pm-panel="create" hidden><form id="pm-create-form"><div class="pm-grid"><label>عنوان صفحه<input id="pm-new-title" required maxlength="180" placeholder="مثلاً درباره باران"></label><label>نامک آدرس — انگلیسی<input id="pm-new-slug" dir="ltr" required maxlength="79" pattern="[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?" placeholder="about-baran"></label><label>زبان<select id="pm-new-language"><option value="fa">فارسی · راست به چپ</option><option value="en">English · left to right</option></select></label><label>روش ساخت<select id="pm-new-kind"><option value="template">صفحه از قالب</option><option value="duplicate">تکثیر صفحه موجود</option></select></label><label id="pm-template-label">قالب<select id="pm-new-template"><option value="blank">صفحه ساده</option><option value="hero">معرفی و فراخوان</option><option value="content">صفحه محتوایی</option></select></label><label id="pm-source-label" hidden>صفحه منبع<select id="pm-new-source"></select></label><label class="pm-span">توضیح کوتاه<textarea id="pm-new-description" maxlength="600" rows="2"></textarea></label></div><p id="pm-new-route" class="pm-route"></p><p class="pm-muted">پوسته، فونت‌ها، منو و پاورقی از سایت واقعی گرفته می‌شوند. آدرس تا پیش از انتشار ساخته نمی‌شود. افزودن صفحه به منو در تنظیمات پیش‌نویس در دسترس است.</p><button class="pm-primary" type="submit" id="pm-create-submit">ساخت پیش‌نویس و شروع ویرایش</button></form></section>
    <section data-pm-panel="seo" hidden><form id="pm-seo-form"><p class="pm-warning">این تنظیمات بخشی از پیش‌نویس هستند و با واگرد/بازانجام برمی‌گردند. برای اعمال روی خروجی سایت از دکمهٔ «ثبت تغییرات» استفاده کنید.</p><div class="pm-grid"><label>عنوان در نتایج جست‌وجو<input id="pm-seo-title" required maxlength="180"></label><label>canonical — آدرس همین سایت<input id="pm-seo-canonical" dir="ltr" type="url" required maxlength="2000"></label><label class="pm-span">توضیح صفحه<textarea id="pm-seo-description" maxlength="600" rows="3"></textarea></label><label>نمایه‌سازی<select id="pm-seo-robots"><option value="index">اجازهٔ نمایه‌سازی</option><option value="noindex">عدم نمایه‌سازی</option></select></label><label>دیده‌شدن صفحه<select id="pm-seo-visibility"><option value="public">عمومی</option><option value="unlisted">فقط با آدرس مستقیم — خارج از منو و نقشه سایت</option></select></label><label>عنوان اشتراک‌گذاری<input id="pm-seo-og-title" maxlength="180"></label><label>تصویر اشتراک‌گذاری از کتابخانه<input id="pm-seo-og-image" dir="ltr" maxlength="2000" placeholder="/assets/images/..."></label><label class="pm-span">توضیح اشتراک‌گذاری<textarea id="pm-seo-og-description" maxlength="600" rows="2"></textarea></label><label>زبان و جهت<input id="pm-seo-locale" readonly></label><label class="pm-check"><input type="checkbox" id="pm-seo-menu-included">نمایش پیوند در منوی سایت</label><label>متن پیوند منو<input id="pm-seo-menu-label" maxlength="100"></label><label>ترتیب منو — صفر ابتدای منو<input id="pm-seo-menu-order" type="number" min="0" max="10000" step="1"></label></div><p class="pm-muted">حالت «آدرس مستقیم» خصوصی نیست؛ هر کسی که آدرس را بداند می‌تواند صفحه را بخواند. برای زبان دیگر صفحهٔ جدا بسازید؛ hreflang جعلی اضافه نمی‌شود.</p><button type="submit" id="pm-seo-submit" class="pm-primary">اعمال در پیش‌نویس</button></form></section>
    <section id="pm-operation" hidden><h3 id="pm-operation-title"></h3><p id="pm-operation-copy" class="pm-warning"></p><form id="pm-operation-form"><label id="pm-operation-value-label">مقدار جدید<input id="pm-operation-value" maxlength="180"></label><label id="pm-confirm-label">برای تأیید مسیر کامل زیر را وارد کنید<input id="pm-confirm" dir="ltr" autocomplete="off"></label><p id="pm-confirm-path" class="pm-route"></p><label id="pm-rewrite-label" class="pm-check"><input id="pm-rewrite" type="checkbox">پیوندهای داخلی شناسایی‌شده را به مسیر تازه اصلاح کن؛ تغییرمسیر امن مسیر قبلی هم ساخته شود.</label><div class="pm-actions"><button type="submit" class="pm-primary" id="pm-operation-submit">تأیید و ثبت عملیات</button><button type="button" id="pm-operation-cancel">انصراف</button></div></form></section>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector),error=message=>{$("#pm-error").textContent=message||"";},message=text=>{$("#pm-message").textContent=text||"";};
  let listing=null,busy=false,operation=null;
  const username=()=>ctx.getUser();
  const indexKey=()=>`pages-drafts:${username()}`;
  const persist=async()=>{if(await ctx.save()===false)throw new Error('ذخیره پیش‌نویس ناموفق بود؛ پیش از ادامه، JSON را دانلود یا ذخیره را دوباره امتحان کنید.');};
  const admin=()=>ctx.getSession()?.user?.role==="admin";
  const setBusy=value=>{for(const button of dialog.querySelectorAll("button,input,select,textarea"))button.disabled=value;};
  const run=async fn=>{if(busy)return;busy=true;setBusy(true);error("");dialog.setAttribute("aria-busy","true");try{await fn();}catch(e){error(e.message);ctx.notice(e.message);}finally{busy=false;setBusy(false);dialog.removeAttribute("aria-busy");}};
  const tab=name=>{
    $("#pm-operation").hidden=true;
    for(const panel of dialog.querySelectorAll("[data-pm-panel]"))panel.hidden=panel.dataset.pmPanel!==name;
    for(const button of dialog.querySelectorAll("[data-pm-tab]"))button.setAttribute("aria-selected",String(button.dataset.pmTab===name));
    error("");if(name==="seo")fillSEO();
  };
  const button=(label,callback,css="")=>{const node=document.createElement("button");node.type="button";node.textContent=label;if(css)node.className=css;node.onclick=callback;return node;};
  const fillSEO=()=>{
    const page=ctx.getModel()?.page;if(!page)return;
    $("#pm-seo-title").value=page.title||"";$("#pm-seo-canonical").value=page.canonical||"";$("#pm-seo-description").value=page.description||"";
    $("#pm-seo-robots").value=page.robots||"index";$("#pm-seo-visibility").value=page.visibility||"public";
    $("#pm-seo-og-title").value=page.ogTitle||page.title||"";$("#pm-seo-og-description").value=page.ogDescription||page.description||"";$("#pm-seo-og-image").value=page.ogImage||"";
    $("#pm-seo-locale").value=page.language==="en" ? "English · LTR" : "فارسی · RTL";
    $("#pm-seo-menu-included").checked=page.menu?.included||false;$("#pm-seo-menu-label").value=page.menu?.label||page.title||"";$("#pm-seo-menu-order").value=page.menu?.order||0;
  };
  async function refresh(){
    listing=await ctx.api("/builder/pages");
    const drafts=(await ctx.dbRecord(indexKey()))||[];
    const livePaths=new Set(listing.pages.map(p=>p.path)),unsaved=drafts.filter(d=>!livePaths.has(d.path));
    $("#pm-pages").replaceChildren();$("#pm-new-source").replaceChildren();
    for(const page of listing.pages.filter(p=>p.status==="published")){
      const option=document.createElement("option");option.value=page.path;option.textContent=`${page.title} · ${page.route}`;$("#pm-new-source").append(option);
    }
    if([...$("#pm-new-source").options].some(o=>o.value===ctx.getPath()))$("#pm-new-source").value=ctx.getPath();
    for(const page of [...unsaved.map(d=>({...d,status:"draft",route:"/"+d.path.slice(7).replace(/index\.html$/,""),managed:true})),...listing.pages]){
      const row=document.createElement("article");row.className="pm-row";row.dataset.path=page.path;
      const title=document.createElement("strong");title.textContent=page.title||page.page?.title||page.path;
      const route=document.createElement("div");route.className="pm-route";route.textContent=page.route;
      const status=document.createElement("span");status.className="pm-muted";status.textContent=({draft:"پیش‌نویس این مرورگر",published:"منتشرشده",archived:"بایگانی‌شده",deleted:"حذف‌شده — نسخه بازیابی موجود"})[page.status]||page.status;
      const actions=document.createElement("div");actions.className="pm-actions";
      if(["draft","published"].includes(page.status))actions.append(button("باز کردن در ویرایشگر",()=>run(async()=>{await persist();await ctx.loadPage(page.path);dialog.close();})));
      if(page.status==="published")actions.append(button("تکثیر",()=>{tab("create");$("#pm-new-kind").value="duplicate";$("#pm-new-language").value=page.language||page.page?.language||(page.path.startsWith('public/en/')?'en':'fa');$("#pm-new-source").value=page.path;$("#pm-new-title").value=`${page.title} — نسخه جدید`;$("#pm-new-slug").value="";toggleKind();routePreview();$("#pm-new-slug").focus();}));
      if(admin()&&page.status==="published"){
        actions.append(button("تغییر نام",()=>startOperation(page,"rename")));
        if(page.managed)actions.append(button("تغییر نامک",()=>startOperation(page,"slug")),button("بایگانی",()=>startOperation(page,"archive")),button("حذف امن",()=>startOperation(page,"delete"),"pm-danger"));
      }
      if(admin()&&["archived","deleted"].includes(page.status))actions.append(button("بازیابی صفحه",()=>startOperation(page,"restore")));
      if(page.status==="published"){
        const link=document.createElement("a");link.href=page.route;link.target="_blank";link.rel="noopener";link.textContent="مشاهده خروجی عمومی";actions.append(link);
      }
      if(!page.managed&&page.status==="published"){
        const protectedNote=document.createElement("small");protectedNote.className="pm-muted";protectedNote.textContent="مسیر اصلی سایت محفوظ است؛ مدیریت مقاله و کاتالوگ در CMS فعلی ادامه دارد.";row.append(protectedNote);
      }
      row.prepend(title,route,status);row.append(actions);$("#pm-pages").append(row);
    }
    message(`${listing.pages.filter(p=>p.status==="published").length} صفحه منتشرشده · ${unsaved.length} پیش‌نویس تازه در این مرورگر`);
  }
  function toggleKind(){const duplicate=$("#pm-new-kind").value==="duplicate";$("#pm-source-label").hidden=!duplicate;$("#pm-template-label").hidden=duplicate;}
  $("#pm-new-kind").onchange=toggleKind;
  const routePreview=()=>{$("#pm-new-route").textContent=`/${$("#pm-new-language").value==="en"?"en/":""}${$("#pm-new-slug").value || "your-page"}/`;};
  $("#pm-new-language").onchange=routePreview;$("#pm-new-slug").oninput=routePreview;
  $("#pm-create-form").onsubmit=event=>{event.preventDefault();run(async()=>{
    if(!$("#pm-create-form").reportValidity())return;
    const duplicate=$("#pm-new-kind").value==="duplicate",payload={slug:$("#pm-new-slug").value.trim(),language:$("#pm-new-language").value,title:$("#pm-new-title").value.trim(),description:$("#pm-new-description").value,kind:duplicate?"duplicate":"template",template:duplicate?"blank":$("#pm-new-template").value,...(duplicate?{sourcePath:$("#pm-new-source").value}:{})};
    const prepared=await ctx.api("/builder/pages/prepare",payload),drafts=(await ctx.dbRecord(indexKey()))||[];
    if(drafts.some(d=>d.path===prepared.model.base.path))throw new Error("یک پیش‌نویس محلی با همین نامک وجود دارد؛ آن را باز کنید یا نامک دیگری انتخاب کنید.");
    await persist();await ctx.dbRecord(`prepared:${username()}:${prepared.model.base.path}`,prepared);
    await ctx.dbRecord(indexKey(),[...drafts,{path:prepared.model.base.path,title:prepared.model.page.title,preparedAt:new Date().toISOString()}]);
    await ctx.openPrepared(prepared);await persist();dialog.close();ctx.notice("صفحه تازه به‌صورت پیش‌نویس ساخته شد؛ بلوک‌ها را اضافه کنید و پس از پیش‌نمایش، ثبت کنید.");
  });};
  $("#pm-seo-form").onsubmit=event=>{event.preventDefault();run(async()=>{
    if(!$("#pm-seo-form").reportValidity())return;
    const canonical=$("#pm-seo-canonical").value.trim(),image=$("#pm-seo-og-image").value.trim();
    if(!/^https:\/\/luxtowelco\.com\/[a-zA-Z0-9_/-]*$/.test(canonical))throw new Error("canonical باید آدرس همین سایت باشد؛ پارامتر، fragment یا اسکریپت پذیرفته نمی‌شود.");
    if(image&&!/^\/assets(?:-v[23])?\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g)$/i.test(image)||image.includes(".."))throw new Error("تصویر اشتراک‌گذاری را با مسیر معتبر کتابخانه انتخاب کنید.");
    const patch={title:$("#pm-seo-title").value.trim(),description:$("#pm-seo-description").value,canonical,robots:$("#pm-seo-robots").value,visibility:$("#pm-seo-visibility").value,ogTitle:$("#pm-seo-og-title").value,ogDescription:$("#pm-seo-og-description").value,ogImage:image,menu:{included:$("#pm-seo-menu-included").checked,label:$("#pm-seo-menu-label").value,order:Number($("#pm-seo-menu-order").value)}};
    const changed=ctx.mutate(next=>Object.assign(next.page,patch));if(changed===false)throw new Error("تنظیمات تغییری نکرده یا در حالت پیش‌نمایش هستید؛ برای ویرایش به بوم برگردید.");
    await persist();message("تنظیمات در پیش‌نویس اعمال شد؛ برای انتشار دکمهٔ ثبت تغییرات را بزنید.");ctx.notice("تنظیمات صفحه ذخیره شد و قابل واگرد است.");
  });};
  async function startOperation(page,action){
    await run(async()=>{
      await persist();operation={page,action};error("");
      for(const panel of dialog.querySelectorAll("[data-pm-panel]"))panel.hidden=true;
      $("#pm-operation").hidden=false;
      const names={rename:"تغییر نام صفحه",slug:"تغییر نامک و مسیر",archive:"بایگانی صفحه",delete:"حذف امن صفحه",restore:"بازیابی صفحه"};
      $("#pm-operation-title").textContent=names[action];
      $("#pm-operation-value-label").hidden=!["rename","slug"].includes(action);$("#pm-operation-value").value=action==="rename"?page.title:page.path.split("/").at(-2);
      $("#pm-operation-value").required=["rename","slug"].includes(action);$("#pm-confirm-label").hidden=action==="rename";$("#pm-confirm-path").hidden=action==="rename";
      $("#pm-confirm-path").textContent=page.path;$("#pm-confirm").value="";$("#pm-confirm").required=action!=="rename";$("#pm-rewrite-label").hidden=action!=="slug";$("#pm-rewrite").checked=false;
      let copy=action==="rename"?"عنوان صفحه در فایل منتشرشده و فهرست مدیریت ثبت می‌شود. برای ویرایش صرفاً در پیش‌نویس از تنظیمات پیش‌نویس فعلی استفاده کنید.":action==="restore"?"محتوا از نسخه ثبت‌شدهٔ پیش از حذف بازیابی می‌شود؛ فایل موجود بازنویسی نمی‌شود.":"فایل عمومی این صفحه تغییر می‌کند. محتوا در سابقهٔ Git یا نسخهٔ خصوصی محلی قابل بازیابی می‌ماند. مسیرهای اصلی سایت در این بخش حذف نمی‌شوند.";
      if(["slug","archive","delete"].includes(action)){
        const result=await ctx.api(`/builder/pages?path=${encodeURIComponent(page.path)}`);listing=result;
        const links=result.impact?.links||[];
        copy+=links.length?`\n${links.length} پیوند ورودی شناسایی شد: ${[...new Set(links.map(l=>"/"+l.path.slice(7).replace(/index\.html$/,"")))].slice(0,8).join("، ")}. ${action==="slug"?"برای اصلاح خودکار همین پیوندها گزینهٔ پایین را فعال کنید.":"پیش از حذف/بایگانی این پیوندها را در ویرایشگر اصلاح کنید؛ عملیات فعلاً رد خواهد شد."}`:"\nپیوند ورودیِ نیازمند اصلاح پیدا نشد؛ پیوندهای منوی ساخته‌شده خودکار تنظیم می‌شوند.";
        const redirects=result.impact?.redirects||[];
        if(redirects.length)copy+=`\n${redirects.length} تغییرمسیر به این صفحه وجود دارد؛ حذف یا بایگانی تا اصلاح این تغییرمسیرها مجاز نیست. مسیرهای منبع: ${redirects.slice(0,8).map(item=>item.from||item.source||'').join('، ')}.`;
      }
      $("#pm-operation-copy").textContent=copy;
      $("#pm-operation-submit").textContent=ctx.getSession()?.mode==="local"?"تأیید و ثبت در فایل‌های محلی":"تأیید و ثبت در GitHub";
      $("#pm-operation-value-label").hidden?$("#pm-confirm").focus():$("#pm-operation-value").focus();
    });
  }
  $("#pm-operation-form").onsubmit=event=>{event.preventDefault();run(async()=>{
    if(!operation||!listing||!$("#pm-operation-form").reportValidity())return;
    const {page,action}=operation;
    if(action!=="rename"&&$("#pm-confirm").value!==page.path)throw new Error("مسیر تأیید با مسیر صفحه یکسان نیست؛ مسیر کامل نمایش‌داده‌شده را وارد کنید.");
    const body={path:page.path,head:listing.head,action,requestId:crypto.randomUUID(),...(action!=="rename"?{confirm:$("#pm-confirm").value}:{}),...(action==="rename"?{title:$("#pm-operation-value").value}:{}),...(action==="slug"?{slug:$("#pm-operation-value").value,updateLinks:$("#pm-rewrite").checked}:{})};
    const result=await ctx.api("/builder/pages/action",body);
    await ctx.refreshLibrary();tab("list");await refresh();
    ctx.notice("عملیات صفحه ثبت شد. پیش‌نویس‌های قبلی محفوظ‌اند؛ برای ادامهٔ ویرایش، نسخه ثبت‌شده را دوباره باز کنید.");
    message(`عملیات ${action} برای ${result.route||page.route} ثبت شد. ${result.mode==="local"?"هیچ انتشار آنلاینی انجام نشد.":"ثبت GitHub تأیید استقرار Cloudflare نیست."}`);
  });};
  $("#pm-operation-cancel").onclick=()=>tab("list");
  $("#pm-close").onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  for(const control of dialog.querySelectorAll("[data-pm-tab]"))control.onclick=()=>{if(!busy)tab(control.dataset.pmTab);};
  $("#pm-refresh").onclick=()=>run(refresh);
  const open=async(name="list")=>{
    error("");$("#pm-environment").textContent=ctx.getSession()?.mode==="local"?"محیط محلی: هیچ Push یا Deploy انجام نمی‌شود. ساخت صفحه فقط پیش‌نویس است؛ عملیات روی صفحات منتشرشده با تأیید شما در فایل‌های همین محیط ثبت می‌شود.":"پیش‌نویس‌ها محلی‌اند. عملیات مدیریت صفحات منتشرشده فقط برای مدیر و پس از تأیید، در GitHub ثبت می‌شود.";
    tab(name);dialog.showModal();await run(refresh);routePreview();
  };
  const manager=button("صفحات +",()=>open("list"));manager.id="pages-manager-open";manager.title="ساخت، تکثیر، مدیریت و تنظیمات صفحات";
  document.querySelector(".toolbar")?.append(manager);
  const settings=button("تنظیمات صفحه و SEO",()=>open("seo"));settings.id="page-settings-open";
  document.querySelector("#page-selector")?.closest("label")?.after(settings);
  return {open,refresh};
}
