// The preview remains script-disabled. In WebKit its document event handlers do
// not execute, so edit input is owned by the trusted parent and hit-tested in the
// actual same-origin document. No customer scripts or cloned page are involved.
import {BLOCKS} from './blocks.js';
export function installCanvasInput(ctx){
  const frame=document.querySelector('#page'),wrap=document.querySelector('#frame-wrap');
  const plane=document.createElement('div');plane.className='canvas-hit-plane';plane.tabIndex=0;
  plane.setAttribute('role','region');plane.setAttribute('aria-label',document.body.dataset.experience==='customer'?'سایت شما؛ لمس برای انتخاب و کشیدن برای پیمایش. انتخاب با صفحه‌کلید از منوی ویرایش سایت در دسترس است.':'بوم ویرایش؛ لمس برای انتخاب، کشیدن برای پیمایش. جابه‌جایی با دستگیره. انتخاب با صفحه‌کلید از فهرست عناصر.');wrap.append(plane);
  const webkit=/AppleWebKit/.test(navigator.userAgent)&&!/(Chrome|Chromium|Edg)\//.test(navigator.userAgent)||/iP(ad|hone|od)/.test(navigator.userAgent);
  let active=null,releaseClick=null;
  document.addEventListener('pointerdown',()=>{releaseClick=null;},true);
  document.addEventListener('click',event=>{
    if(!releaseClick||event.detail===0||event.timeStamp-releaseClick.time>800)return;
    const samePointer=event.pointerId===releaseClick.id;
    if(samePointer||Math.hypot(event.clientX-releaseClick.x,event.clientY-releaseClick.y)<12){
      releaseClick=null;event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  function local(event){const r=frame.getBoundingClientRect();return {x:(event.clientX-r.left)*frame.offsetWidth/r.width,y:(event.clientY-r.top)*frame.offsetHeight/r.height};}
  function mapped(event,target){const p=local(event);return {target:target||ctx.getDocument()?.elementFromPoint(p.x,p.y),clientX:p.x,clientY:p.y,pointerId:event.pointerId,pointerType:event.pointerType,button:event.button,shiftKey:event.shiftKey,altKey:event.altKey,captureTarget:plane,preventDefault:()=>event.preventDefault()};}
  function cancel(){active=null;ctx.cancelGesture();}
  plane.addEventListener('pointerdown',event=>{
    if(ctx.isPreview()||ctx.isReadOnly())return;
    // Suppress compatibility mouse clicks: opening a sheet beneath the finger
    // must not let the release click activate its newly exposed parent button.
    event.preventDefault();
    if(active){cancel();return;}
    const e=mapped(event);if(!e.target)return;
    const handle=e.target.closest('[data-resize],[data-move]');
    active={id:event.pointerId,x:event.clientX,y:event.clientY,lastY:event.clientY,lastX:event.clientX,pan:false,gesture:event.pointerType!=='touch'||!!handle,target:e.target};
    plane.setPointerCapture(event.pointerId);
    if(active.gesture)ctx.startGesture(e);
  });
  plane.addEventListener('pointermove',event=>{
    if(!active||active.id!==event.pointerId)return;
    if(active.gesture){ctx.moveGesture(mapped(event,active.target));return;}
    if(Math.hypot(event.clientX-active.x,event.clientY-active.y)>9)active.pan=true;
    if(active.pan){
      const scale=frame.offsetHeight/frame.getBoundingClientRect().height,win=ctx.getDocument().defaultView,dy=(active.lastY-event.clientY)*scale,before=win.scrollY;
      win.scrollBy(0,dy);
      // The ordinary editor can clip an 800px frame into a shorter canvas.
      // Pass unused pan distance to that canvas so its bottom stays reachable.
      wrap.parentElement.scrollTop+=(dy-(win.scrollY-before))/scale;
      wrap.parentElement.scrollLeft+=active.lastX-event.clientX;ctx.drawSelection();
    }
    active.lastY=event.clientY;active.lastX=event.clientX;
  });
  plane.addEventListener('pointerup',event=>{
    if(!active||active.id!==event.pointerId)return;
    event.preventDefault();
    releaseClick={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp};
    const end=active;active=null;
    if(end.gesture)ctx.endGesture(mapped(event,end.target));
    else if(!end.pan)ctx.selectAt(mapped(event,end.target));
  });
  plane.addEventListener('pointercancel',cancel);plane.addEventListener('lostpointercapture',()=>{if(active)cancel();});
  plane.addEventListener('wheel',event=>{const doc=ctx.getDocument();if(!doc)return;const before=doc.defaultView.scrollY;doc.defaultView.scrollBy(0,event.deltaY*(event.deltaMode===1?20:1));if(before!==doc.defaultView.scrollY){event.preventDefault();ctx.drawSelection();}},{passive:false});
  plane.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();ctx.revealSelection(true);}else ctx.keyboard(event);});
  plane.addEventListener('click',event=>event.preventDefault());
  plane.addEventListener('dragover',event=>{if(!ctx.isReadOnly()&&[...event.dataTransfer.types].includes('text/x-baran-block')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
  plane.addEventListener('drop',event=>{
    if(ctx.isReadOnly())return;
    const kind=event.dataTransfer.getData('text/x-baran-block');if(!BLOCKS.some(b=>b.id===kind))return;
    event.preventDefault();const hit=mapped(event).target?.closest('[data-builder-type=container],[data-builder-anchor]');
    ctx.insertBlock(kind,hit?.dataset.builderId||hit?.dataset.builderAnchor||document.querySelector('#anchor').value);
  });
  const refresh=()=>{plane.hidden=ctx.isPreview()||!(webkit||navigator.maxTouchPoints>0||matchMedia('(any-pointer:coarse)').matches||document.body.classList.contains('direct-edit'));};
  ctx.onUpdate(refresh);refresh();
  return {refresh,focus:()=>plane.focus({preventScroll:true})};
}
