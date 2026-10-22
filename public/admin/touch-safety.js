// A scroll/cancel must never become a delayed tap on Close, Exit or a link.
// Native scrolling in sheets remains native; only outward edge chaining is stopped.
export function installTouchSafety(root=document) {
  let pointer=null,release=null;
  const started=event=>{
    release=null;
    if(event.pointerType!=='touch'){pointer=null;return;}
    if(pointer){pointer.cancelled=true;return;}
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false};
  };
  root.addEventListener('pointerdown',started,true);
  root.addEventListener('pointermove',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    pointer.lastX=event.clientX;pointer.lastY=event.clientY;
    if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>10)pointer.moved=true;
  },true);
  const ended=event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    if(pointer.moved||pointer.cancelled||event.type==='pointercancel')release={id:pointer.id,x:pointer.lastX,y:pointer.lastY,until:performance.now()+900};
    pointer=null;
  };
  root.addEventListener('pointerup',ended,true);root.addEventListener('pointercancel',ended,true);
  root.addEventListener('click',event=>{
    if(!release||performance.now()>release.until)return;
    // Preserve keyboard/assistive activation and every subsequent deliberate tap.
    if(event.detail===0&&event.pointerType!=='touch')return;
    if(event.pointerId===release.id||Math.hypot(event.clientX-release.x,event.clientY-release.y)<32){event.preventDefault();event.stopImmediatePropagation();release=null;}
  },true);
  let touch=null;
  root.addEventListener('touchstart',event=>{
    touch=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;
  },{passive:true});
  root.addEventListener('touchmove',event=>{
    if(!touch||event.touches.length!==1||!event.cancelable)return;
    const next=event.touches[0],dy=next.clientY-touch.y,dx=next.clientX-touch.x;touch={x:next.clientX,y:next.clientY};
    const boundary=event.target.closest?.('#customer-selection,dialog[open],#customer-tasks,.direct-edit #selection-inspector');
    if(!boundary||Math.abs(dy)<=Math.abs(dx))return;
    // Allow textareas, lists and any inner scroller to consume the gesture first.
    for(let node=event.target;node&&boundary.contains(node);node=node.parentElement){
      const style=getComputedStyle(node);
      if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1&&((dy<0&&node.scrollTop<node.scrollHeight-node.clientHeight-1)||(dy>0&&node.scrollTop>0)))return;
      if(node===boundary)break;
    }
    event.preventDefault();
  },{passive:false});
  root.addEventListener('touchend',()=>{touch=null;},{passive:true});
  root.addEventListener('touchcancel',()=>{touch=null;},{passive:true});
}
