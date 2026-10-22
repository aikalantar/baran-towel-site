// Online authenticated launcher only: no offline cache or credential storage.
let pendingPrompt=null,installedThisSession=false,relatedInstalled=false;
const standalone=matchMedia('(display-mode: standalone)'),appDisplay=matchMedia('(display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const installed=()=>installedThisSession||relatedInstalled||standalone.matches||appDisplay.matches||navigator.standalone===true;
function update(){
  const done=installed();
  for(const button of document.querySelectorAll('[data-cms-install]')){button.hidden=done;button.textContent=button.hasAttribute('data-cms-install-compact')?'نصب پنل':pendingPrompt?'نصب برنامهٔ مدیریت':'راهنمای افزودن به صفحهٔ اصلی';}
  for(const hint of document.querySelectorAll('[data-cms-install-hint]'))hint.hidden=done||!(ios()||pendingPrompt);
  if(done)document.querySelector('#cms-install-dialog')?.close();
}
export async function checkInstalled(){
  // Safari cannot enumerate Home Screen installs from an ordinary browser tab.
  // Opening instructions or accepting a prompt is not proof of installation.
  if(navigator.getInstalledRelatedApps){
    try{const apps=await navigator.getInstalledRelatedApps(),manifest=new URL('/admin/cms.webmanifest',location.origin).href;relatedInstalled=apps.some(app=>app.platform==='webapp'&&app.url&&new URL(app.url,location.origin).href===manifest);}catch{/* Optional browser capability. */}
  }
  update();return installed();
}
export function mountInstall(container,{promotion=null}={}){
  if(!container)return;
  if(!container.querySelector('[data-cms-install]')){const button=document.createElement('button');button.type='button';button.className='cms-install';button.dataset.cmsInstall='';container.append(button);}
  if(promotion&&!document.querySelector('[data-cms-install-hint]')){
    const hint=document.createElement('aside');hint.className='cms-install-hint cms-install-compact';hint.dataset.cmsInstallHint='';hint.setAttribute('aria-label','افزودن پنل به صفحهٔ اصلی');
    const help=document.createElement('button');help.type='button';help.dataset.cmsInstall='';help.dataset.cmsInstallCompact='';help.setAttribute('aria-label','راهنمای نصب پنل روی صفحهٔ اصلی');hint.append(help);promotion.append(hint);
  }
  update();void checkInstalled();
}
function guidance(message){
  let dialog=document.querySelector('#cms-install-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='cms-install-dialog';dialog.setAttribute('aria-labelledby','cms-install-title');dialog.innerHTML='<h2 id="cms-install-title">افزودن مدیریت سایت به صفحهٔ اصلی</h2><p data-install-help></p><p>پس از افزودن، پنل را از آیکون آن باز کنید. استفاده به اینترنت و ورود به حساب نیاز دارد.</p><form method="dialog"><button>متوجه شدم</button></form>';document.body.append(dialog);}
  dialog.querySelector('[data-install-help]').textContent=message;if(!dialog.open)dialog.showModal();
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installedThisSession=false;relatedInstalled=false;pendingPrompt=event;update();});
window.addEventListener('appinstalled',()=>{installedThisSession=true;pendingPrompt=null;update();});
standalone.addEventListener('change',()=>{update();void checkInstalled();});
appDisplay.addEventListener('change',()=>{update();void checkInstalled();});
window.addEventListener('pageshow',()=>void checkInstalled());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkInstalled();});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-cms-install]');if(!button||installed())return;
  if(pendingPrompt){
    const prompt=pendingPrompt;pendingPrompt=null;button.disabled=true;
    try{await prompt.prompt();await prompt.userChoice;}
    catch{guidance('پنجرهٔ نصب اکنون در دسترس نیست. از منوی مرورگر، نصب برنامه یا افزودن به صفحهٔ اصلی را بررسی کنید.');}
    finally{button.disabled=false;update();void checkInstalled();}return;
  }
  guidance(ios()
    ?'در Safari منوی اشتراک‌گذاری (Share، مربع و پیکان رو به بالا) را باز کنید؛ در بعضی چیدمان‌ها ابتدا دکمهٔ بیشتر (…) را بزنید. «افزودن به صفحهٔ اصلی» (Add to Home Screen) و سپس Add را انتخاب کنید. اگر «Open as Web App» وجود دارد آن را روشن بگذارید. اگر گزینه را نمی‌بینید، پایین فهرست «Edit Actions» را بررسی کنید. در مرورگر داخل پیام‌رسان، ابتدا این صفحه را در Safari باز کنید.'
    :'از منوی مرورگر، «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را انتخاب کنید. هرگاه مرورگر نصب بومی را پشتیبانی و پیشنهاد کند، همین دکمه پنجرهٔ واقعی نصب را باز می‌کند.');
});
