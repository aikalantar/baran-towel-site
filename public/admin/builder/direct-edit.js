export function installDirectEdit(ctx,customerUI){
  const $=s=>document.querySelector(s),builder=$('#builder'),canvas=$('.canvas'),wrap=$('#frame-wrap'),frame=$('#page'),panel=$('#selection-inspector');
  const toggle=document.createElement('button');toggle.id='direct-edit-toggle';toggle.textContent='ویرایش تمام‌صفحه';toggle.setAttribute('aria-pressed','false');$('.toolbar .tools').before(toggle);
  const bar=document.createElement('nav');bar.id='direct-edit-bar';bar.hidden=true;bar.setAttribute('aria-label','ابزارهای ویرایش تمام‌صفحه');
  bar.innerHTML='<button id="direct-exit" aria-label="خروج از ویرایش تمام‌صفحه">خروج</button><button id="direct-inspector" aria-controls="selection-inspector" aria-expanded="false">تنظیمات</button><label class="direct-select-label">انتخاب عنصر<select id="direct-element"><option value="">روی صفحه لمس کنید</option></select></label>';
  builder.append(bar);
  const close=document.createElement('button');close.id='direct-close';close.textContent='بستن تنظیمات ×';close.hidden=true;panel.prepend(close);
  let active=false,previousDevice,restore=[];
  const move=(node,to)=>{const marker=document.createComment('editor control home');node.before(marker);to.append(node);restore.push(()=>marker.replaceWith(node));};
  function fit(){
    if(!active)return;
    const viewport=window.visualViewport;
    if(!viewport||viewport.scale===1){builder.style.setProperty('--direct-height',`${viewport?.height||innerHeight}px`);builder.style.setProperty('--direct-top',`${viewport?.offsetTop||0}px`);}
    builder.style.setProperty('--direct-bar-height',`${bar.offsetHeight}px`);
    const width=canvas.clientWidth,device=width<=640?'mobile':width<=1023?'tablet':'desktop';
    if(ctx.getDevice()!==device||parseFloat(wrap.style.width)!==width)ctx.setDevice(device,width);
    frame.style.height=`${Math.max(160,canvas.clientHeight)}px`;
    const input=document.activeElement;
    if(panel.contains(input)&&/INPUT|TEXTAREA|SELECT/.test(input.tagName)){
      const r=input.getBoundingClientRect(),p=panel.getBoundingClientRect();if(r.bottom>p.bottom-8)panel.scrollTop+=r.bottom-p.bottom+8;
    }
  }
  function open(focus=false){
    if(!active)return false;
    if(ctx.isPreview()||!ctx.getSelected().length)return true;
    panel.hidden=false;$('#direct-inspector').setAttribute('aria-expanded','true');
    // Content controls stay first; only this sheet scrolls, never the canvas.
    panel.scrollTop=0;
    if(focus){const field=[...panel.querySelectorAll('textarea,input,select,summary')].find(n=>!n.disabled&&n.getClientRects().length);field?.focus({preventScroll:true});}
    return true;
  }
  function hide(){customerUI.cancelReveal();panel.hidden=true;$('#direct-inspector').setAttribute('aria-expanded','false');$('.canvas-hit-plane')?.focus({preventScroll:true});}
  function enter(){
    if(!ctx.getModel())return;
    active=true;previousDevice=ctx.getDevice();document.body.classList.add('direct-edit');bar.hidden=false;toggle.setAttribute('aria-pressed','true');
    for(const id of ['save','undo','redo','preview','save-status'])move($('#'+id),bar);
    move(panel,builder);move($('.mode-switch'),panel);close.hidden=false;panel.hidden=true;
    fit();ctx.refreshInput();
  }
  function exit(){
    if(!active)return;
    active=false;document.body.classList.remove('direct-edit');bar.hidden=true;toggle.setAttribute('aria-pressed','false');
    for(const fn of restore.reverse())fn();restore=[];close.hidden=true;panel.hidden=false;frame.style.height='';ctx.setDevice(previousDevice);ctx.refreshInput();toggle.focus({preventScroll:true});
  }
  toggle.onclick=enter;$('#direct-exit').onclick=exit;close.onclick=hide;$('#direct-inspector').onclick=()=>open(true);
  $('#direct-element').onchange=event=>{if(event.target.value){ctx.select(event.target.value);ctx.getNode(event.target.value)?.scrollIntoView({block:'center'});ctx.drawSelection();}};
  customerUI.setRevealHandler(open);
  ctx.onUpdate(()=>{
    if(!active)return;
    const select=$('#direct-element'),model=ctx.getModel(),selected=ctx.getSelected()[0]||'';
    const entries=[...model.sections,...model.elements].filter(e=>!e.deleted);
    const signature=entries.map(e=>e.id+':'+(e.content?.text||e.label||e.type)).join('|');
    if(select.dataset.signature!==signature){select.dataset.signature=signature;select.replaceChildren(new Option('روی صفحه لمس کنید',''),...entries.map(e=>new Option((e.content?.text||e.content?.alt||e.label||e.type||'بخش').slice(0,65),e.id)));}
    select.value=selected;select.disabled=ctx.isReadOnly();$('#direct-inspector').disabled=ctx.isReadOnly()||!selected;
    if(ctx.isPreview())panel.hidden=true;
  });
  window.addEventListener('resize',()=>{if(active)requestAnimationFrame(fit);});
  new ResizeObserver(()=>{if(active)requestAnimationFrame(fit);}).observe(canvas);
  window.visualViewport?.addEventListener('resize',()=>{if(active)requestAnimationFrame(fit);});
  window.visualViewport?.addEventListener('scroll',()=>{if(active)requestAnimationFrame(fit);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){if(!panel.hidden)hide();else exit();}});
  return {fit,exit};
}
