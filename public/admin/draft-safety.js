// Tracks durability, not publication. A saved unpublished draft is safe to leave.
// A completion for an older edit must never acknowledge a newer edit.
export function createDraftSafety(target=window) {
  let revision=0,persisted=0,busy=false,attached=false;
  const beforeUnload=event=>{if(atRisk()){event.preventDefault();event.returnValue='';}};
  const atRisk=()=>revision>persisted||busy;
  function sync(){const needed=atRisk();if(needed===attached)return;target[needed?'addEventListener':'removeEventListener']('beforeunload',beforeUnload);attached=needed;}
  return {
    get revision(){return revision;},get atRisk(){return atRisk();},
    changed(){revision++;sync();return revision;},
    saved(version){persisted=Math.max(persisted,Math.min(version,revision));sync();},
    reset(){revision=0;persisted=0;busy=false;sync();},
    busy(value){busy=!!value;sync();},
  };
}

export function installDraftRecovery({retry,exportDraft}) {
  const panel=document.createElement('aside');panel.id='draft-recovery';panel.hidden=true;panel.dir='rtl';
  panel.setAttribute('aria-label','حفاظت از پیش‌نویس');
  panel.innerHTML='<p id="draft-recovery-message" role="status" aria-live="polite"></p><div><button id="draft-save-retry" type="button">تلاش دوباره برای ذخیره</button><button id="draft-save-export" type="button">دانلود JSON پیش‌نویس</button></div>';
  document.body.append(panel);
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='/admin/draft-recovery.css';document.head.append(stylesheet);
  panel.querySelector('#draft-save-retry').onclick=async()=>{try{await retry();}catch{panel.querySelector('p').textContent='ذخیره هنوز ممکن نیست؛ JSON را دانلود کنید و این صفحه را باز نگه دارید.';}};
  panel.querySelector('#draft-save-export').onclick=exportDraft;
  return {show(message,retryable=true){panel.hidden=false;panel.querySelector('p').textContent=message;panel.querySelector('#draft-save-retry').disabled=!retryable;},clear(){panel.hidden=true;}};
}
