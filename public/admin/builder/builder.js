import { History, clone, emptyLayout, safeLink, safeImage, validModel, decodeDraft, encodeDraft, effectiveLayout, effectiveStyle, DEVICES } from "./model.js";
import { isFree } from "./layout.js";
import { builderLoginURL } from '../routes.js';
import { mountInstall } from '../pwa.js';
import { optimizeImage } from "./images.js";
import { BLOCKS, createBlock } from './blocks.js';
import {renderCanvas,updateGeometry} from './canvas.js';
import {installProfessionalControls,cloneSubtrees,subtreeIds,selectedRoots} from './pro-controls.js';
import {installPagesUI} from './pages-ui.js';
import {installCustomerUI} from './customer-ui.js';
import {lockedBy,allowsLockedChanges,requiredUnlocks} from './locks.js';
import {createDraftSafety,installDraftRecovery} from '../draft-safety.js';
import {publicationMessage} from './publication-status.js';
import {installCanvasInput} from './canvas-input.js';
import {installDirectEdit} from './direct-edit.js';
import {installFontPreview} from './fonts.js';
import {newElementID} from './identity.js';

const $ = selector => document.querySelector(selector);
const frame = $("#page");
const draftSafety=createDraftSafety();
const draftRecovery=installDraftRecovery({retry:()=>save(),exportDraft:()=>download(encodeDraft(history))});
let base, history, library, db, storageKey, user, doc, selected = [], device = "desktop", preview = false;
let gesture = null, saveTimer, noticeTimer, locked = false, draftWritable = false, saveChain = Promise.resolve(), originals = new Map();
let sessionInfo, currentPath = "public/index.html", activeRef = "", sessionTimer, publishing = false, publishRequest = null, publication = null;
let editView=0,frameLoadListener,frameObserver,canvasInput, pendingTouch, customerUI, selectionPending = false,publicationTimer;
const updateHooks=[];
const notifyControls=()=>{if(history&&doc)for(const fn of updateHooks)fn();};
const model = () => history.present;
const element = id => model().elements.find(e => e.id === id)||model().sections?.find(e=>e.id===id);
const selectedElement = () => element(selected[0]);
const nodeFor = id => originals.get(id)?.node || doc?.querySelector(`[data-builder-id="${id}"]`) || doc?.querySelector(`[data-builder-anchor="${id}"]`);
const unitFor = id => { const node = nodeFor(id); return node?.closest("picture") || node; };
const anchorFor = id => doc.querySelector(`[data-builder-anchor="${id}"]`);
const layoutFor = e => effectiveLayout(e,device);
const parentFor=e=>e.parentId==='page'?doc.querySelector('main'):nodeFor(e.parentId)||anchorFor(e.anchor);
const round = n => Math.round(n * 1000) / 1000;

function notice(text) {
  $("#notice").textContent = text;
  $("#notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("#notice").hidden = true, 7000);
}
async function api(endpoint, body) {
  let response;
  try { response = await fetch(`/api/cms${endpoint}`, { credentials: "same-origin", cache: "no-store", signal:AbortSignal.timeout(body ? 60000 : 30000), ...(body ? {method:"POST",headers:{"Content-Type":"application/json","X-CMS-Request":"1"},body:JSON.stringify(body)} : {}) }); }
  catch { throw new Error(body ? "پاسخ ثبت دریافت نشد؛ ممکن است ثبت انجام شده باشد. پیش‌نویس محفوظ است؛ تکرار همان درخواست امن است." : "ارتباط با CMS برقرار نشد؛ اتصال را بررسی کنید."); }
  const data = await response.json();
  if (!response.ok) {const error=new Error(data.error||'دریافت اطلاعات ممکن نشد.');error.status=response.status;throw error;}
  return data;
}
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("baran-visual-builder", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("ذخیره‌سازی مرورگر در دسترس نیست؛ تنظیمات حریم خصوصی را بررسی کنید."));
  });
}
function readDraft() {
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get(storageKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("خواندن پیش‌نویس ممکن نشد."));
  });
}
function save() {
  clearTimeout(saveTimer);
  // A rejected draft stays read-only until its raw data is archived and the
  // user explicitly starts over. Visibility/pagehide must never replace it.
  if (locked || !history || !draftWritable) return Promise.resolve(true);
  let raw;try{raw=encodeDraft(history);}catch(error){return Promise.resolve(saveFailed(error));}
  const key = storageKey;
  const revision=draftSafety.revision;
  $("#save-status").textContent = "در حال ذخیره…";
  saveChain = saveChain.catch(() => {}).then(() => new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put(raw, key);
    transaction.oncomplete = () => { draftSafety.saved(revision);if(!draftSafety.atRisk)draftRecovery.clear();$("#save-status").textContent = draftSafety.atRisk?"تغییرات تازه در حال ذخیره…":"پیش‌نویس در این مرورگر ذخیره شد"; resolve(true); };
    transaction.onerror = transaction.onabort = () => reject(new Error("ذخیره انجام نشد؛ فضای مرورگر کافی نیست. پیش‌نویس را دانلود کنید."));
  }));
  return saveChain.catch(saveFailed);
}
function saveFailed(error){$("#save-status").textContent="ذخیره ناموفق — پیش‌نویس را دانلود کنید";draftRecovery.show('ذخیره در مرورگر انجام نشد. تغییرات تازه فقط در این تب هستند؛ دوباره ذخیره کنید یا پیش از خروج JSON را دانلود کنید.');notice(error.message);return false;}
function changed() {
  draftSafety.changed();
  $("#save-status").textContent = "تغییرات در حال ذخیره…";
  // Queue a transaction immediately so a refresh after an operation retains it.
  save();
}
function commit(next, updateControls = true) {
  if (locked || preview || publishing || !draftWritable) return false;
  if(!allowsLockedChanges(model(),next)){notice('این عنصر یا ظرف والد آن قفل است؛ ابتدا قفل را از فهرست لایه‌ها باز کنید.');properties();return false;}
  if(!validModel(next,base.model,base.anchors)){notice('این تغییر با ساختار امن صفحه سازگار نیست. والد، H1 یا دادهٔ بلوک را بررسی کنید؛ پیش‌نویس قبلی حفظ شد.');return false;}
  if (!history.commit(next)) return false;
  render();
  if (updateControls) properties();
  updateHistory();
  changed();
  return true;
}
function mutate(fn, controls = true) { const next = clone(model()); fn(next); return commit(next, controls); }
function updateHistory() {
  $("#undo").disabled = !history.past.length || preview || publishing;
  $("#redo").disabled = !history.future.length || preview || publishing;
}
function travel(direction) {
  if (locked || preview || publishing || !draftWritable) return;
  cancelGesture();
  if (history[direction]()) { render(); properties(); updateHistory(); changed(); }
}

function rememberOriginals() {
  originals.clear();
  for (const e of base.model.elements) {
    const node = nodeFor(e.id);
    const unit = unitFor(e.id);
    originals.set(e.id, {
      node, unit, parent:unit.parentNode, next:unit.nextSibling,
      style: unit.getAttribute("style"), nodeStyle:node.getAttribute("style"), html: node.innerHTML,
      width:node.getAttribute("width"), height:node.getAttribute("height"),
      src: node.getAttribute("src"), srcset: node.getAttribute("srcset"),
      sources: [...(node.closest("picture")?.querySelectorAll("source") || [])].map(n => ({ node: n, srcset: n.getAttribute("srcset") })),
    });
  }
}
function render(draft = model()) {
  if (!doc) return;
  const alive=renderCanvas({doc,draft,base,originals,nodeFor,unitFor,anchorFor});
  selected=selected.filter(id=>{const e=[...draft.elements,...draft.sections].find(e=>e.id===id);return e&&alive(e);});
  refreshAnchors(draft);drawSelection();layers(draft);notifyControls();
}
function refreshAnchors(draft=model()){
  const anchors=[...draft.sections.filter(e=>!e.deleted).map(e=>({id:e.id,label:e.label})),...draft.elements.filter(e=>!e.deleted&&e.type==='container').map(e=>({id:e.id,label:e.content.text||e.kind||'ظرف'}))];
  for(const key of ['#anchor','#move-anchor']){const select=$(key),previous=select.value;select.replaceChildren();for(const a of anchors){const option=document.createElement('option');option.value=a.id;option.textContent=a.label;select.append(option);}select.value=anchors.some(a=>a.id===previous)?previous:anchors.find(a=>a.id!=='section-0')?.id||anchors[0]?.id;}
}
function layers(draft = model()) {
  const holder = $("#layers");
  const scroll = holder.scrollTop;
  holder.replaceChildren();
  for (const e of [...draft.sections,...draft.elements].filter(e => !e.deleted)) {
    const button = document.createElement("button");
    button.textContent = `${e.locked?'🔒 ':''}${effectiveLayout(e,device).hidden?'◌ ':''}${e.type === 'container'?'▤':e.type === "image" ? "▧" : "T"} ${e.content?.text || e.content?.alt || e.label || e.kind || e.type}`;
    button.dataset.select = e.id;
    button.setAttribute("aria-pressed", selected.includes(e.id));
    button.title = e.content?.text || e.content?.alt || e.label || e.id;
    let depth=0,parent=e.parentId;while(parent&&parent!=='page'&&depth<8){const p=draft.elements.find(n=>n.id===parent);if(!p)break;depth++;parent=p.parentId;}button.style.paddingInlineStart=`${10+depth*14}px`;
    holder.append(button);
  }
  holder.scrollTop = scroll;
}
function drawSelection() {
  if (!doc) return;
  doc.querySelectorAll('[data-builder-overlay=guide]').forEach(n=>n.remove());
  if (!gesture) doc.querySelectorAll("[data-builder-overlay]").forEach(n => n.remove());
  doc.querySelectorAll("[data-builder-editing]").forEach(n => n.removeAttribute("data-builder-editing"));
  if (preview) return;
  for (const id of selected) {
    const node = nodeFor(id);
    if (!node || !node.getClientRects().length) continue;
    node.setAttribute("data-builder-editing", "true");
    if (selected.length !== 1||element(id)?.locked||model().sections.some(s=>s.id===id)) continue;
    const rect = node.getBoundingClientRect();
    if(rect.bottom<=0||rect.top>=doc.defaultView.innerHeight||rect.right<=0||rect.left>=doc.defaultView.innerWidth)continue;
    const touch=matchMedia("(pointer:coarse)").matches;
    if(!gesture){
      const move=doc.createElement('button');move.dataset.builderOverlay='move';move.dataset.move='true';
      move.setAttribute('aria-label','دستگیره جابه‌جایی');move.textContent='✥';
      move.style.cssText=`position:fixed;left:${Math.max(0,rect.left)}px;top:${Math.max(0,rect.top-48)}px;width:44px;height:44px;z-index:2147483647;border:2px solid #237658;border-radius:8px;background:white;color:#237658;font-size:24px;touch-action:none`;
      doc.body.append(move);
    }
    for (const corner of (touch?["se"]:["nw", "ne", "sw", "se"])) {
      const handle = (gesture && doc.querySelector(`[data-resize="${corner}"]`)) || doc.createElement("button");
      handle.dataset.builderOverlay = "handle";
      handle.dataset.resize = corner;
      handle.setAttribute("aria-label", `تغییر اندازه ${corner}`);
      handle.style.cssText = `position:fixed;left:${(corner.includes("w") ? rect.left : rect.right) - (touch?22:6)}px;top:${(corner.includes("n") ? rect.top : rect.bottom) - (touch?22:6)}px;width:${touch?44:13}px;height:${touch?44:13}px;padding:0;background:white;border:2px solid #2563eb;border-radius:2px;z-index:2147483647;cursor:${corner}-resize;touch-action:none;direction:ltr;`;
      if (!handle.isConnected) doc.body.append(handle);
    }
  }
  if($('#guides').checked&&selected.length){const e=element(selected[0]),parent=parentFor(e).getBoundingClientRect(),rect=nodeFor(e.id).getBoundingClientRect();for(const vertical of [true,false]){const line=doc.createElement('div');line.dataset.builderOverlay='guide';const mid=vertical?parent.left+parent.width/2:parent.top+parent.height/2,aligned=Math.abs((vertical?rect.left+rect.width/2:rect.top+rect.height/2)-mid)<5;line.style.cssText=`position:fixed;pointer-events:none;z-index:2147483646;background:${aligned?'#22a65b':'#a855f7'};opacity:.65;left:${vertical?mid:parent.left}px;top:${vertical?parent.top:mid}px;width:${vertical?1:parent.width}px;height:${vertical?parent.height:1}px`;doc.body.append(line);}}
}
function select(id, multiple = false, {reveal = true} = {}) {
  if (preview || locked) return;
  selected = multiple ? selected.includes(id) ? selected.filter(i => i !== id) : [...selected, id] : [id];
  if (selectedElement()) $("#anchor").value = selectedElement().anchor;
  for(let detail=nodeFor(id)?.closest('details');detail;detail=detail.parentElement?.closest('details'))detail.open=true;
  drawSelection(); layers(); properties();notifyControls();
  if(reveal)customerUI?.revealSelection();
}
function properties() {
  const e = selectedElement();
  $("#properties").hidden = !e;
  if (!e) return;
  $("#selection-label").textContent = selected.length > 1 ? `${selected.length} عنصر انتخاب شده` : ({ text: "متن", heading: "عنوان", image: "تصویر", button: "دکمه / پیوند",container:'بخش / ظرف',divider:'جداکننده',spacer:'فاصله' })[e.type];
  $("#element-id").textContent = e.id;
  $("#text-group").hidden = !['text','heading','button'].includes(e.type);
  $('#rich-tools').hidden=!!e.source||!['text','heading'].includes(e.type);
  $('#section-up').hidden=$('#section-down').hidden=!model().sections.some(s=>s.id===e.id)||!!e.protected;
  $("#image-group").hidden = e.type !== "image";
  $("#typography").hidden = true;
  $("#link-group").hidden = e.type !== "button";
  $("#text").value = e.content.text || "";
  $("#alt").value = e.content.alt || "";
  $("#href").value = e.content.href || "";
  $("#image-library").value = e.content.src || "";
  const node = nodeFor(e.id);if(!node)return;
  const rect = node.getBoundingClientRect(), anchor = parentFor(e).getBoundingClientRect(), layout = layoutFor(e), computed = doc.defaultView.getComputedStyle(node);
  $("#x").value = round(layout.x ?? (isFree(e) ? 10 : 0));
  $("#y").value = round(layout.y ?? (isFree(e) ? 10 : 0));
  for(const dimension of ['width','height']){
    const unit=layout[dimension+'Unit']||'%';
    $('#'+dimension+'-unit').value=unit;
    const reference=unit==='px'?1:unit==='%'?anchor[dimension]/100:(dimension==='width'?doc.defaultView.innerWidth:doc.defaultView.innerHeight)/100;
    $('#'+dimension).value=round(layout[dimension]??rect[dimension]/Math.max(.001,reference));
    $('#'+dimension).max=unit==='%'?'300':'4000';
    $('#'+dimension).previousSibling.textContent=(dimension==='width'?'عرض ':'ارتفاع ')+unit;
  }
  $("#z").value = e.z ?? (parseInt(computed.zIndex) || 0);
  $("#fontSize").value = round(parseFloat(computed.fontSize));
  const rgb = computed.color.match(/\d+/g);
  $("#color").value = e.style.color || (rgb ? `#${rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, "0")).join("")}` : "#263329");
  $("#textAlign").value = e.style.textAlign || "start";
  $("#move-anchor").value = e.parentId||e.anchor;
  $("#order").value = e.order || 0;
  $("#move-section").disabled = e.movable === false||!!e.locked||model().sections.some(s=>s.id===e.id);
  $("#move-advice").textContent = e.movable === false ? "انتقال این عنصر به‌دلیل ساختار تو‌در‌تو یا رفتار صفحه مجاز نیست؛ متن و اندازه قابل ویرایش‌اند." : "پس از انتقال، چیدمان موبایل را بررسی کنید؛ طرح شما خودکار تغییر نمی‌کند.";
  const originalSection=model().sections.some(s=>s.id===e.id);
  const editingLocked=!!lockedBy(model(),e.id);
  for(const name of ['text','alt','href','image-library','upload','order','z','duplicate','delete','move-section','section-up','section-down','rich-bold','rich-italic','rich-underline'])$('#'+name).disabled=editingLocked;
  $('#move-section').disabled ||= e.movable===false||originalSection;
  for(const name of ['x','y','width','height','width-unit','height-unit','reset-layout'])$('#'+name).disabled=originalSection||editingLocked;
  if(editingLocked)$('#move-advice').textContent='عنصر یا ظرف والد قفل است؛ ابتدا قفل را در فهرست لایه‌ها باز کنید.';
  if(originalSection)$('#move-advice').textContent='بخش اصلی ساختار سایت را حفظ می‌کند؛ از ترتیب بخش‌ها، فاصله و کمینهٔ ارتفاع در «ظاهر و چیدمان» استفاده کنید. بخش تازهٔ کتابخانه، جابه‌جایی آزاد دارد.';
  notifyControls();
}

function startGesture(event) {
  if (preview || locked || publishing || event.button !== 0) return;
  const resize = event.target.closest("[data-resize]")?.dataset.resize;
  const hit = event.target.closest("[data-move]")?nodeFor(selected[0]):event.target.closest("[data-builder-id]") || doc.elementsFromPoint(event.clientX, event.clientY).map(n => n.closest("[data-builder-id]")).find(Boolean) || event.target.closest('[data-builder-anchor]');
  selectionPending = !resize;
  if (!resize && !hit) { selectionPending=false;selected = []; drawSelection(); properties(); layers(); notifyControls(); return; }
  if(event.pointerType==='touch'&&!resize&&!event.target.closest('[data-move]')){
    pendingTouch={id:hit.dataset.builderId||hit.dataset.builderAnchor,x:event.clientX,y:event.clientY,pointerId:event.pointerId};selectionPending=false;return;
  }
  event.preventDefault();
  if (!resize) {
    let hitId=hit.dataset.builderId||hit.dataset.builderAnchor;
    if (event.shiftKey) { select(hitId, true,{reveal:false}); return; }
    const group=selected.find(id=>element(id)?.kind==='group'&&nodeFor(id).contains(hit));
    if(group&&customerUI?.mode==='advanced')hitId=group;
    if (!selected.includes(hitId)) select(hitId,false,{reveal:false});
  }
  if(selected.some(id=>lockedBy(model(),id)))return notice('برای جابه‌جایی، ابتدا قفل عنصر یا ظرف والد را باز کنید.');
  if(selected.some(id=>model().sections.some(s=>s.id===id)))return;
  const roots=selectedRoots([...model().sections,...model().elements],selected);
  const items = roots.map(id => {
    const e = element(id), rect = nodeFor(id).getBoundingClientRect(), anchor = parentFor(e).getBoundingClientRect();
    return { id, rect, anchor, layout: layoutFor(e) };
  });
  gesture = { before: clone(model()), x: event.clientX, y: event.clientY, scrollY:doc.defaultView.scrollY, resize, items, moved: false, target: event.target, pointerId: event.pointerId };
  (event.captureTarget||event.target).setPointerCapture?.(event.pointerId);
}
function moveGesture(event) {
  if(pendingTouch&&Math.hypot(event.clientX-pendingTouch.x,event.clientY-pendingTouch.y)>9)pendingTouch=null;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y + doc.defaultView.scrollY - gesture.scrollY;
  if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
  gesture.moved = true;
  const next = clone(gesture.before);
  for (const item of gesture.items) {
    const e = [...next.elements,...next.sections].find(e => e.id === item.id), l = { ...item.layout };
    const xDelta = dx / item.anchor.width * 100, yDelta = dy / item.anchor.height * 100;
    const snap = n => $("#snap").checked ? Math.round(n) : round(n);
    if (gesture.resize) {
      if(e.type==='image'&&effectiveStyle(e,device).aspectRatio>0){const appearance=device==='desktop'?e.style:((e.responsiveStyles||={})[device]||={});appearance.aspectRatio=0;}
      const w = item.rect.width / item.anchor.width * 100, h = item.rect.height / item.anchor.height * 100;
      const west = gesture.resize.includes("w"), north = gesture.resize.includes("n");
      l.width = Math.max(.1, Math.min(300, snap(w + (west ? -xDelta : xDelta))));
      l.height = Math.max(.1, Math.min(300, snap(h + (north ? -yDelta : yDelta))));
      l.widthUnit='%';l.heightUnit='%';
      if (west) l.x = snap((item.layout.x ?? (isFree(e) ? 10 : 0)) + w - l.width);
      if (north) l.y = snap((item.layout.y ?? (isFree(e) ? 10 : 0)) + h - l.height);
    } else {
      l.x = Math.max(-500, Math.min(500, snap((l.x ?? (isFree(e) ? 10 : 0)) + xDelta)));
      l.y = Math.max(-500, Math.min(500, snap((l.y ?? (isFree(e) ? 10 : 0)) + yDelta)));
    }
    e.layouts[device] = l;
  }
  gesture.next = next;
  gesture.drop = null;
  doc.querySelectorAll("[data-builder-drop]").forEach(n => n.removeAttribute("data-builder-drop"));
  if (!gesture.resize && gesture.items.every(item => element(item.id).movable !== false&&!model().sections.some(s=>s.id===item.id))) {
    const excluded=subtreeIds(model().elements,gesture.items.map(i=>i.id));
    const targets=[...model().sections,...model().elements.filter(e=>e.type==='container'&&(e.parentId==='page'||event.altKey))].filter(e=>!e.deleted&&!excluded.has(e.id));
    const target = targets.find(a => { const r = nodeFor(a.id).getBoundingClientRect(); return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom && gesture.items.some(item => (element(item.id).parentId||element(item.id).anchor) !== a.id); });
    if (target) { gesture.drop = {id:target.id,x:event.clientX,y:event.clientY}; nodeFor(target.id).setAttribute("data-builder-drop",""); }
  }
  if (!gesture.resize && event.clientY > doc.defaultView.innerHeight - 25) doc.defaultView.scrollBy(0,18);
  if (!gesture.resize && event.clientY < 25) doc.defaultView.scrollBy(0,-18);
  render(next);
}
function endGesture(event) {
  if(pendingTouch&&(!event||event.pointerId===pendingTouch.pointerId)){const id=pendingTouch.id;pendingTouch=null;select(id);return;}
  if(!gesture){if(selectionPending){selectionPending=false;customerUI?.revealSelection();}return;}
  if(event && event.pointerId !== gesture.pointerId)return;
  const next = gesture.next;
  const drop = gesture.drop;
  const reveal=selectionPending&&!gesture.moved;
  selectionPending=false;
  gesture = null;
  doc.querySelectorAll("[data-builder-drop]").forEach(n => n.removeAttribute("data-builder-drop"));
  if (next && drop) {
    const bounds = nodeFor(drop.id).getBoundingClientRect();
    transfer(next,selected,drop.id,true);
    next.elements.filter(e => selected.includes(e.id)).forEach((e,i) => { e.order = i; e.layouts[device] = {...e.layouts[device],x:round((drop.x-bounds.left)/bounds.width*100),y:round((drop.y-bounds.top)/Math.max(1,bounds.height)*100)}; });
    notice("عنصر به بخش جدید منتقل شد. چیدمان موبایل را بررسی کنید؛ تنظیمات اندازه دیگر حفظ شدند.");
  }
  if (next) commit(next); else drawSelection();
  if(reveal)customerUI?.revealSelection();
}
function cancelGesture() {
  selectionPending=false;
  if (gesture) { gesture = null; render(); properties(); }
}
function rootAnchor(id,draft=model()){
  const section=draft.sections.find(s=>s.id===id);if(section)return id;
  const node=draft.elements.find(e=>e.id===id);return node?.parentId==='page'?node.id:node?.anchor;
}
function transfer(next,ids,destination,free=false){
  const roots=selectedRoots(next.elements,ids),included=subtreeIds(next.elements,roots);
  if(included.has(destination))throw Error('نمی‌توان ظرف را به داخل خودش منتقل کرد.');
  const anchor=rootAnchor(destination,next);
  for(const e of next.elements.filter(e=>included.has(e.id))){if(roots.includes(e.id)){e.parentId=destination;e.layoutMode=free?'free':'flow';e.free=free;}e.anchor=anchor;}
}
function add(type) {
  if (preview || locked) return;
  const id = newElementID(), parentId = $("#anchor").value, anchor=rootAnchor(parentId);
  const e = {
    id, type, anchor, parentId,layoutMode:'free',locked:false,responsiveInheritance:false,responsiveStyles:{tablet:{},mobile:{}},source: null, tag: ({ text: "p", heading: "h2", image: "img", button: "a" })[type],
    content: type === "image" ? { src: library.images[0]?.url || "/assets/images/home/baran-hero.webp", alt: "تصویر جدید" } : { text: ({ text: "متن تازه خود را اینجا بنویسید", heading: "عنوان تازه", button: "مشاهده مجموعه" })[type], ...(type === "button" ? { href: "/catalog/" } : {}) },
    layouts: { desktop: { x: 10, y: 15, width: type === "image" ? 25 : 35, height: type === "image" ? 35 : 12 },tablet:{}, mobile: { x: 5, y: 15, width: type === "image" ? 60 : 85, height: type === "image" ? 35 : 15 } },
    style: type === "image" ? {} : { fontSize: type === "heading" ? 32 : 18 }, z: 10, deleted: false,
  };
  if (mutate(next => next.elements.push(e))) { select(id); nodeFor(id).scrollIntoView({ block: "center" }); }
}
function insertBlock(kind,parentId=$('#anchor').value){
  if(preview||locked||publishing)return;
  try{
    const nodes=createBlock(kind,{anchor:parentId==='page'?'placeholder':rootAnchor(parentId),parentId,language:model().page.language});
    if(parentId==='page'){if(nodes[0].kind!=='section')throw Error('در سطح صفحه، یک بخش اضافه کنید.');for(const e of nodes)e.anchor=nodes[0].id;}
    const siblings=model().elements.filter(e=>(e.parentId||e.anchor)===parentId);nodes[0].order=siblings.length?Math.max(...siblings.map(e=>e.order||0))+1:0;
    if(mutate(next=>next.elements.push(...nodes))){select(nodes[0].id);nodeFor(nodes[0].id).scrollIntoView({block:'center'});}
  }catch(error){notice(error.message);}
}
function duplicate() {
  if(selected.some(id=>model().sections.some(s=>s.id===id)))return notice('برای تکثیر بخش اصلی، صفحه را تکثیر کنید یا یک بخش تازه از کتابخانه بسازید.');
  try{
    const source=clone(model().elements);
    for(const e of source.filter(e=>selected.includes(e.id)&&e.source)){
      const rect=nodeFor(e.id).getBoundingClientRect(),bounds=parentFor(e).getBoundingClientRect();
      for(const d of DEVICES) e.layouts[d]={...effectiveLayout(e,d),x:round((rect.left-bounds.left)/bounds.width*100),y:round((rect.top-bounds.top)/Math.max(1,bounds.height)*100),width:round(rect.width/bounds.width*100),height:round(rect.height/Math.max(1,bounds.height)*100)};
      if(e.type==='text')e.tag='p';
    }
    const copies=cloneSubtrees(source,selected);
    if(mutate(next=>next.elements.push(...copies.elements))){selected=copies.ids;render();properties();}
  }catch(error){notice(error.message);}
}
function remove() {
  if(selected.some(id=>element(id)?.locked||model().sections.find(s=>s.id===id)?.protected))return notice('ابتدا قفل را باز کنید؛ سربرگ و پاورقی اصلی قابل حذف نیستند.');
  const roots=selectedRoots([...model().sections,...model().elements],selected);
  const ids=subtreeIds([...model().sections,...model().elements],roots);
  if([...ids].some(id=>element(id)?.type==='container')&&!confirm('این بخش و محتوای داخل آن از پیش‌نویس حذف شوند؟ واگرد در دسترس است.'))return;
  mutate(next=>[...next.sections,...next.elements].filter(e=>ids.has(e.id)).forEach(e=>e.deleted=true));
}

function bindFrame() {
  doc = frame.contentDocument;
  frame.hidden=false;$('.workspace').inert=false;
  rememberOriginals();
  doc.addEventListener("click", event => { if(!preview){event.preventDefault();event.stopPropagation();} }, true);
  doc.addEventListener("submit", event => event.preventDefault(), true);
  doc.addEventListener("dragstart", event => event.preventDefault());
  doc.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('text/x-baran-block')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
  doc.addEventListener('drop',event=>{const kind=event.dataTransfer.getData('text/x-baran-block');if(!BLOCKS.some(b=>b.id===kind))return;event.preventDefault();const node=event.target.closest('[data-builder-type=container],[data-builder-anchor]');const destination=node?.dataset.builderId||node?.dataset.builderAnchor||$('#anchor').value;insertBlock(kind,destination);});
  doc.addEventListener("pointerdown", startGesture);
  doc.addEventListener("pointermove", moveGesture);
  doc.addEventListener("pointerup", endGesture);
  doc.addEventListener("pointercancel", cancelGesture);
  doc.addEventListener("dblclick", event => {
    const hit = event.target.closest("[data-builder-id]");
    if (hit && !preview && element(hit.dataset.builderId)?.type !== "image") { select(hit.dataset.builderId); $("#text").focus(); $("#text").select(); }
  });
  doc.addEventListener("keydown", keyboard);
  doc.addEventListener("scroll", drawSelection, true);
  frameObserver?.disconnect();frameObserver=new ResizeObserver(()=>drawSelection());frameObserver.observe(doc.body);
  frame.contentWindow.addEventListener("resize", () => { render(); properties(); });
  doc.addEventListener("load", drawSelection, true);
  render(); properties(); updateHistory();
}
function keyboard(event) {
  if (locked || preview) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && ["z", "y"].includes(event.key.toLowerCase())) {
    event.preventDefault(); travel(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo"); return;
  }
  if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); save(); return; }
  if (event.key === "Escape") { cancelGesture(); return; }
  if (typing || !selected.length || selected.some(id=>lockedBy(model(),id))) return;
  if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); remove(); }
  if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (direction) {
    event.preventDefault();
    const roots=selectedRoots([...model().sections,...model().elements],selected);
    mutate(next => [...next.elements,...next.sections].filter(e => roots.includes(e.id)).forEach(e => {
      const l = layoutFor(e), bounds = parentFor(e).getBoundingClientRect(), step = event.shiftKey ? 10 : 1;
      l.x = round((l.x ?? (isFree(e) ? 10 : 0)) + direction[0] * step / bounds.width * 100);
      l.y = round((l.y ?? (isFree(e) ? 10 : 0)) + direction[1] * step / bounds.height * 100);
      e.layouts[device] = l;
    }));
  }
}
function download(raw, filename = "baran-home-draft.json") {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function upload(file) {
  if (!file) return;
  const id = selected[0];
  const path = currentPath, optimized = await optimizeImage(file);
  if (path !== currentPath) throw new Error("صفحه عوض شده است؛ تصویر را دوباره انتخاب کنید.");
  mutate(next => { const e = next.elements.find(e => e.id === id); if (e?.type === "image") e.content = {...e.content,src:optimized.src,width:optimized.width,height:optimized.height,variants:optimized.variants}; });
  if (optimized.warning) notice(optimized.warning);
}

document.addEventListener("keydown", keyboard);
$("#undo").onclick = () => travel("undo");
$("#redo").onclick = () => travel("redo");
$("#save").onclick = () => save();
$("#duplicate").onclick = duplicate;
$("#delete").onclick = remove;
$("#move-section").onclick = () => {
  const destination = $("#move-anchor").value;
  if (selected.some(id => element(id).movable === false)) return notice("یکی از عناصر ساختار وابسته دارد و قابل انتقال نیست.");
  try{mutate(next => {transfer(next,selected,destination,true);next.elements.filter(e => selected.includes(e.id)).forEach((e,i) => {e.order=i;e.layouts[device]={...e.layouts[device],x:10,y:10};});});}catch(error){return notice(error.message);}
  notice("انتقال ساختاری انجام شد. برای موبایل چیدمان را بررسی کنید.");
};
$("#order").onchange = event => {
  const e = selectedElement();
  if (!e || !event.target.checkValidity()) return;
  if (e.movable === false) { properties(); return notice("ساختار این عنصر اجازه تغییر والد/ترتیب را نمی‌دهد."); }
  const rect = unitFor(e.id).getBoundingClientRect(), anchor = parentFor(e).getBoundingClientRect();
  mutate(next => { const item = [...next.elements,...next.sections].find(item => item.id === e.id);item.order=Number(event.target.value);if(next.sections.some(s=>s.id===item.id))return;if(!isFree(item)){item.free=true;item.layoutMode='free';item.layouts[device]={x:round((rect.left-anchor.left)/anchor.width*100),y:round((rect.top-anchor.top)/anchor.height*100),width:round(rect.width/anchor.width*100),height:round(rect.height/Math.max(1,anchor.height)*100)};} });
  notice("ترتیب ساختاری اعمال شد؛ چیدمان موبایل را هم بررسی کنید.");
};
document.querySelectorAll("[data-add]").forEach(button => button.onclick = () => add(button.dataset.add));
$("#layers").onclick = event => {
  const id = event.target.closest("[data-select]")?.dataset.select;
  if (id) { select(id, event.shiftKey); nodeFor(id).scrollIntoView({ block: "center" }); drawSelection(); }
};
function setDevice(value,width){
  cancelGesture();device=value;
  document.querySelectorAll('[data-device]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.device===device)));
  $('#frame-wrap').style.width=`${width||({desktop:1440,tablet:768,mobile:390})[device]}px`;
  $('#device-label').textContent=({desktop:'دسکتاپ',tablet:'تبلت',mobile:'موبایل'})[device];
  requestAnimationFrame(()=>{if(history&&doc&&!preview){render();properties();}});
}
document.querySelectorAll('[data-device]').forEach(button=>button.onclick=()=>setDevice(button.dataset.device));
$("#preview").onclick = () => {
  if (publication?.result) return notice("برای ویرایش بعدی، نسخه ثبت‌شده را با دکمه شروع ویرایش باز کنید؛ پیش‌نویس قبلی محفوظ است.");
  cancelGesture(); preview = !preview;
  document.body.classList.toggle("preview", preview);
  if(!preview&&frame.contentDocument!==doc)loadEditingFrame();
  doc.documentElement.toggleAttribute("data-builder-preview", preview);
  $("#preview").setAttribute("aria-pressed", preview);
  $("#preview").textContent = preview ? "بازگشت به ویرایش" : "پیش‌نمایش";
  drawSelection(); updateHistory();notifyControls();
};
for (const key of ["text", "alt", "href"]) $("#" + key).addEventListener("input", event => {
  if (!selectedElement()) return;
  const value = event.target.value;
  if (key === "href" && !safeLink(value)) { event.target.setCustomValidity("آدرس معتبر سایت یا https وارد کنید."); event.target.reportValidity(); return; }
  event.target.setCustomValidity("");
  mutate(next => {const e=next.elements.find(e=>e.id===selected[0]);if(!e||e.locked)return;e.content[key]=value;if(key==='text')delete e.content.runs;}, false);
});
for (const key of ["x", "y", "width", "height"]) $("#" + key).addEventListener("change", event => {
  if (!selectedElement() || !event.target.checkValidity() || event.target.value === "") { properties(); return; }
  mutate(next => { const e = [...next.elements,...next.sections].find(e => e.id === selected[0]);if(!e||e.locked)return;const layout=e.layouts[device]||={};layout[key] = Number(event.target.value);if(['width','height'].includes(key))layout[key+'Unit']=$('#'+key+'-unit').value;if(key==='height'&&e.type==='image'&&effectiveStyle(e,device).aspectRatio>0)(device==='desktop'?e.style:((e.responsiveStyles||={})[device]||={})).aspectRatio=0; });
});
for(const dimension of ['width','height'])$('#'+dimension+'-unit').onchange=event=>{
  const e=selectedElement();if(!e)return;
  const unit=event.target.value,rect=unitFor(e.id).getBoundingClientRect(),parent=parentFor(e).getBoundingClientRect();
  const reference=unit==='px'?1:unit==='%'?parent[dimension]/100:(dimension==='width'?doc.defaultView.innerWidth:doc.defaultView.innerHeight)/100;
  const value=round(rect[dimension]/Math.max(.001,reference));
  if(value<.1||value>(unit==='%'?300:4000)){properties();return notice('اندازه برای این واحد از محدودهٔ مجاز خارج است؛ ابتدا ابعاد را تغییر دهید.');}
  mutate(next=>{const target=next.elements.find(item=>item.id===e.id);if(target){const layout=target.layouts[device]||={};layout[dimension]=value;layout[dimension+'Unit']=unit;}});
};
for (const key of ["fontSize", "color", "textAlign", "z"]) $("#" + key).addEventListener("change", event => {
  if (!selectedElement() || !event.target.checkValidity()) return;
  mutate(next => { const e = [...next.elements,...next.sections].find(e => e.id === selected[0]);if(!e||e.locked)return;if(key==='z')e.z=Number(event.target.value);else {const style=device==='desktop'?e.style:((e.responsiveStyles||={})[device]||={});style[key]=key==='fontSize'?Number(event.target.value):event.target.value;} });
});
$("#reset-layout").onclick = () => mutate(next => { const e = [...next.elements,...next.sections].find(e => e.id === selected[0]); if (e&&!e.locked){e.layouts[device] = {};delete (device==='desktop'?e.style:((e.responsiveStyles||={})[device]||={})).aspectRatio;} });
$("#image-library").onchange = event => { if (safeImage(event.target.value)) mutate(next => { const content = next.elements.find(e => e.id === selected[0]).content; content.src = event.target.value; delete content.variants; delete content.width; delete content.height; }); };
$("#upload").onchange = event => { upload(event.target.files[0]).catch(error => notice(error.message)); event.target.value = ""; };
$("#export").onclick = () => download(encodeDraft(history));
$("#import").onchange = async event => {
  try {
    const file = event.target.files[0];
    if (!file || file.size > 20_000_000) throw new Error("فایل پیش‌نویس باید حداکثر ۲۰ مگابایت باشد.");
    const raw = await file.text();
    // Keep the exact uploaded bytes, including incompatible JSON and its
    // original history, before attempting an undoable content import.
    await archiveDraft(raw);
    await refreshArchives();
    const imported = decodeDraft(raw, base.model, base.anchors);
    // Import is itself one undoable operation, preserving current local work.
    const changed = commit(imported.present);
    notice(changed ? "محتوای پیش‌نویس بازیابی شد؛ واگرد برای بازگشت در دسترس است. فایل و تاریخچهٔ واردشده در آرشیو محفوظ‌اند." : "فایل در آرشیو محفوظ است؛ محتوای فعلی تغییر نکرد.");
  } catch (error) { notice(error.message); }
  event.target.value = "";
};
window.addEventListener("pagehide", () => { if (history&&draftSafety.atRisk) save(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && history&&draftSafety.atRisk) save(); else if (!document.hidden&&history) checkSession(); });

function lock(message) {
  $('#builder-login').href = builderLoginURL(location.pathname + location.search);
  if(draftSafety.atRisk)draftRecovery.show('دسترسی متوقف شده است و تغییرات تازه هنوز ذخیره نشده‌اند؛ پیش از خروج JSON پیش‌نویس را دانلود کنید.',false);
  locked = true;
  $("#builder").hidden = true;
  $("#gate").hidden = false;
  $("#gate-message").textContent = message;
  frame.srcdoc = "";
}
async function checkSession() {
  if (locked) return;
  try {
    const current = await api("/session");
    if (current.user?.username !== user || !["admin", "editor"].includes(current.user?.role)) lock("نشست شما پایان یافته است؛ دوباره از پنل مدیریت وارد شوید. پیش‌نویس ذخیره‌شده حفظ شده است.");
  } catch { lock("بررسی دسترسی ممکن نشد؛ اتصال را بررسی کرده و صفحه را تازه کنید."); }
}
function loadEditingFrame(){
  const view=String(++editView);
  if(frameLoadListener)frame.removeEventListener('load',frameLoadListener);
  frame.hidden=true;$('.workspace').inert=true;
  // Navigation may still emit a late load for the previous preview URL. Bind
  // only our uniquely marked document, never that unrelated customer page.
  frameLoadListener=()=>{if(frame.contentDocument?.querySelector('meta[name="builder-editor-view"]')?.content!==view)return;frame.removeEventListener('load',frameLoadListener);frameLoadListener=null;bindFrame();};
  frame.addEventListener('load',frameLoadListener);
  frame.srcdoc=base.html.replace('</head>',`<meta name="builder-editor-view" content="${view}"></head>`);
}
function launch() {
  $("#gate").hidden = true; $("#builder").hidden = false;
  loadEditingFrame();
  clearInterval(sessionTimer); sessionTimer = setInterval(checkSession, 45_000);
}
async function loadPage(path, ref = "", fresh = false, prepared = null) {
  if (publishing) return;
  if(locked&&draftSafety.atRisk)throw new Error('دسترسی متوقف شده است؛ پیش از خروج JSON را دانلود کنید.');
  if(history&&storageKey){do{if(await save()===false)throw new Error('ذخیره پیش‌نویس ناموفق بود؛ پیش از تعویض صفحه، JSON را دانلود یا ذخیره را دوباره امتحان کنید.');}while(draftSafety.atRisk);}
  const priorDraftWritable = draftWritable;
  draftWritable = false;
  frame.hidden=true;$('.workspace').inert=true;
  let next=prepared;
  if(!next){try{next=await api(`/builder?path=${encodeURIComponent(path)}${ref ? `&ref=${ref}` : ""}`);}catch(error){if(error.status===404&&!ref)next=await dbRecord(`prepared:${user}:${path}`);if(!next){draftWritable=priorDraftWritable;frame.hidden=false;$('.workspace').inert=false;throw error;}}}
  base = next; currentPath = path; activeRef = ref;
  clearTimeout(publicationTimer);
  const address = new URL(location.href); address.searchParams.set("path",path);
  if (ref) address.searchParams.set("ref",ref); else address.searchParams.delete("ref");
  window.history.replaceState(null,"",address);
  storageKey = `${user}:${path}${ref ? `:restore:${ref}` : ""}`;
  selected = []; originals.clear(); doc = null; preview = false; publication = null; publishRequest = null;
  document.body.classList.remove("preview"); $("#preview").setAttribute("aria-pressed","false"); $("#preview").textContent = "پیش‌نمایش";
  $("#publication-status").textContent = ""; $("#check-publication").hidden = true; $("#continue-editing").hidden = true;
  $("#publish").disabled = sessionInfo.user.role !== "admin";
  if(![...$('#page-selector').options].some(o=>o.value===path)){const option=document.createElement('option');option.value=path;option.textContent=`پیش‌نویس · ${path.slice(7)}`;$('#page-selector').append(option);}
  $("#page-selector").value = path;
  $("#page-heading").textContent = `${base.model.base.title}${ref ? " — بازگردانی در پیش‌نویس" : ""}`;
  for (const selector of ["#anchor","#move-anchor"]) {
    $(selector).replaceChildren();
    for (const anchor of base.anchors) { const option = document.createElement("option"); option.value = anchor.id; option.textContent = anchor.label; $(selector).append(option); }
  }
  $("#anchor").value = base.anchors.find(a => a.id !== "section-0")?.id || base.anchors[0].id;
  history = new History(base.model);
  const saved = await readDraft();
  if (saved && !fresh) {
    try {
      const restored = decodeDraft(saved, base.model, base.anchors);
      if(JSON.parse(saved).version===1){await archiveDraft(saved);notice('پیش‌نویس نسخهٔ ۱ و همهٔ واگردها مهاجرت کردند؛ فایل اصلی در آرشیو حفظ شد.');}
      history = restored;
      $("#save-status").textContent = "پیش‌نویس و تاریخچه قبلی بازیابی شدند";
    }
    catch {
      $("#gate-message").textContent = "نسخه پایه صفحه تغییر کرده یا پیش‌نویس ناسازگار است. ابتدا نسخه قبلی را دانلود کنید. شروع تازه فقط پیش‌نویس این مرورگر را جایگزین می‌کند.";
      try { await archiveDraft(saved); }
      catch { $("#gate-message").textContent += " آرشیو مرورگر در دسترس نیست؛ فایل قبلی را دانلود کنید. پیش‌نویس اصلی جایگزین نشده است."; }
      const prior = await dbRecord(`request:${storageKey}`);
      const recovered = prior?.requestId && prior.requestId === base.receipt?.requestId;
      if (recovered) {
        $("#gate-message").textContent = "ثبت درخواست قبلی در نسخه جاری صفحه تأیید شد. پیش‌نویس اصلی و تاریخچه قبلی جایگزین نشده‌اند؛ ابتدا پشتیبان را دانلود کنید. بازکردن نسخه ثبت‌شده پس از آرشیو موفق ممکن است. وضعیت استقرار آنلاین هنوز تأیید نشده است.";
      }
      const backup = document.createElement("button"); backup.textContent = "دانلود پیش‌نویس قبلی"; backup.onclick = () => download(saved, "baran-previous-draft.json");
      const fresh = document.createElement("button"); fresh.textContent = recovered ? "باز کردن نسخه ثبت‌شده" : "شروع پیش‌نویس تازه از صفحه فعلی";
      fresh.onclick = async () => {
        try { await archiveDraft(saved); backup.remove(); fresh.remove(); await loadPage(currentPath,activeRef,true); await save(); }
        catch (error) { notice(error.message); }
      };
      $("#gate").append(backup, fresh);
      $("#gate").hidden = false; $("#builder").hidden = true;
      return;
    }
  }
  const revisions = base.model.base.creation?{entries:[]}:await api(`/history?path=${encodeURIComponent(path)}`).catch(()=>({entries:[]}));
  $("#revisions").replaceChildren();
  for (const entry of revisions.entries) { const option = document.createElement("option"); option.value = entry.sha; option.textContent = `${entry.date?.slice(0,10) || ""} ${entry.message || "نسخه قبلی"}`; $("#revisions").append(option); }
  $("#load-revision").disabled = !revisions.entries.length;
  await refreshArchives();
  draftWritable = true;
  draftSafety.reset();draftRecovery.clear();
  launch();
}
async function boot() {
  $('#builder-login').href = builderLoginURL(location.pathname + location.search);
  mountInstall(document.querySelector('.toolbar .tools:last-child'));
  sessionInfo = await api("/session");
  if (!sessionInfo.user || !["admin", "editor"].includes(sessionInfo.user.role)) { $("#gate-message").textContent = "برای ویرایش صفحه وارد حساب مدیر یا ویرایشگر شوید؛ پس از ورود به همین صفحه برمی‌گردید."; return; }
  user = sessionInfo.user.username;
  [library,db] = await Promise.all([api("/library"),openDB()]);
  for (const page of library.pages) { const option = document.createElement("option"); option.value = page.path; option.textContent = `${page.language.toUpperCase()} · ${page.route}`; $("#page-selector").append(option); }
  for (const image of library.images) { const option = document.createElement("option"); option.value = image.url; option.textContent = image.path.split("/").slice(-2).join("/"); $("#image-library").append(option); }
  const requested = new URL(location.href).searchParams.get("path");
  const ref = new URL(location.href).searchParams.get("ref") || "";
  const prepared=requested?await dbRecord(`prepared:${user}:${requested}`):null;
  await loadPage(library.pages.some(p => p.path === requested)||prepared ? requested : "public/index.html", /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref) ? ref : "");
}

function dbRecord(key, value) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction("drafts",value === undefined ? "readonly" : "readwrite");
    const request = value === undefined ? tx.objectStore("drafts").get(key) : tx.objectStore("drafts").put(value,key);
    let result; request.onsuccess = () => result = request.result;
    tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(new Error("ثبت اطلاعات بازیابی درخواست ممکن نشد؛ پیش‌نویس را دانلود کنید."));
  });
}
async function archiveDraft(raw) {
  const prefix = `archive:${storageKey}:raw-${await fingerprint(raw)}:`;
  const keys = await new Promise((resolve,reject) => {
    const tx = db.transaction("drafts"), request = tx.objectStore("drafts").getAllKeys();
    request.onsuccess = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error("آرشیو پیش‌نویس ممکن نشد؛ فایل قبلی را دانلود کنید."));
  });
  const existing = keys.find(key => typeof key === "string" && key.startsWith(prefix));
  if (existing) return existing;
  const key = prefix + Date.now();
  await dbRecord(key,raw);
  return key;
}
async function refreshArchives() {
  const keys = await new Promise((resolve,reject) => { const req = db.transaction("drafts").objectStore("drafts").getAllKeys(); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
  $("#archives").replaceChildren();
  for (const key of keys.filter(k => typeof k === "string" && k.startsWith(`archive:${user}:${currentPath}:`)).sort().reverse()) {
    const option = document.createElement("option"); option.value = key;
    option.textContent = new Date(Number(key.split(":").at(-1))).toLocaleString("fa-IR"); $("#archives").append(option);
  }
  $("#download-archive").disabled = !$("#archives").options.length;
}
$("#download-archive").onclick = async () => { const raw = await dbRecord($("#archives").value); if (raw) download(raw,"baran-archived-draft.json"); };
async function fingerprint(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2,"0")).join("");
}
async function status() {
  if (!publication?.result) return;
  if (publication.result.mode === "local") { $("#publication-status").textContent = "در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است."; return; }
  const sha=publication.result.sha;
  let result;try{result=await api(`/builder/status?sha=${encodeURIComponent(sha)}`);}catch{result={commit:'committed',deployment:'unknown'};}
  if(publication?.result.sha!==sha)return;
  $("#publication-status").textContent=publicationMessage(result);
  return result;
}
async function monitorPublication(sha,attempt=0){clearTimeout(publicationTimer);const result=await status();if(publication?.result.sha!==sha||attempt>=5||['success','failure','error','inactive','superseded'].includes(result?.deployment))return;publicationTimer=setTimeout(()=>monitorPublication(sha,attempt+1),10000);}
$("#page-selector").onchange = event => loadPage(event.target.value).catch(error => { $("#page-selector").value = currentPath; notice(error.message); });
$("#load-revision").onclick = () => loadPage(currentPath,$("#revisions").value).catch(error => notice(error.message));
$("#load-current").onclick = () => loadPage(currentPath).catch(error => notice(error.message));
$("#continue-editing").onclick = async () => {
  // Archive the old history before explicitly advancing to the committed base.
  await dbRecord(`archive:${storageKey}:${Date.now()}`,encodeDraft(history));
  await loadPage(currentPath,"",true); await save();
};
$("#check-publication").onclick = async()=>{const button=$("#check-publication");button.disabled=true;try{await status();}finally{button.disabled=false;}};
$("#publish").onclick = () => {
  if (sessionInfo.user.role !== "admin" || publishing) return;
  $("#publish-description").textContent = sessionInfo.mode === "local" ? "صفحه و تصاویر در پروژه محلی ذخیره می‌شوند. هیچ Push یا Deploy انجام نمی‌شود." : "صفحه و تصاویر در GitHub ثبت می‌شوند؛ روند استقرار تنظیم‌شده ممکن است آغاز شود.";
  const unlockIds=requiredUnlocks(base.model,model());
  $('#publish-unlock-group').hidden=!unlockIds.length;
  $('#publish-unlock-confirm').checked=false;
  $('#publish-unlock-count').textContent=String(unlockIds.length);
  $('#publish-confirm').disabled=unlockIds.length>0;
  $("#publish-dialog").showModal();
};
$('#publish-unlock-confirm').onchange=event=>{$('#publish-confirm').disabled=!event.target.checked&&requiredUnlocks(base.model,model()).length>0;};
$("#publish-cancel").onclick = () => $("#publish-dialog").close();
$("#publish-confirm").onclick = async () => {
  if (publishing || sessionInfo.user.role !== "admin") return;
  const unlockIds=requiredUnlocks(base.model,model()).sort();
  if(unlockIds.length&&!$('#publish-unlock-confirm').checked)return notice('برای ثبت تغییرات زیر ظرف قفل‌شده، تأیید بازکردن قفل را انتخاب کنید.');
  $("#publish-dialog").close(); publishing = true;
  $(".workspace").inert = true;
  $("#publish").disabled = true; $("#publication-status").textContent = "در حال اعتبارسنجی و ثبت…";
  try {
    // Upgrade local images from Task 1 drafts through the same real optimizer.
    const normalized = clone(model());
    for (const e of normalized.elements.filter(e => e.type === "image" && !e.deleted && e.content.src.startsWith("data:"))) {
      if (e.content.src.startsWith("data:image/webp") && e.content.width) continue;
      const [header,raw] = e.content.src.split(","), mime = header.slice(5).split(";")[0];
      const bytes = Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
      const optimized = await optimizeImage(new File([bytes],"builder-image",{type:mime}));
      e.content = {...e.content,src:optimized.src,width:optimized.width,height:optimized.height,variants:optimized.variants};
    }
    if (history.commit(normalized)) { draftSafety.changed();render(); updateHistory(); }
    if(await save()===false)throw new Error('ذخیره پیش‌نویس پیش از انتشار ناموفق بود؛ ابتدا JSON را دانلود یا ذخیره را دوباره امتحان کنید.');
    const payload = clone(model()), digest = await fingerprint(unlockIds.length?{model:payload,unlockIds}:payload), key = `request:${storageKey}`, prior = await dbRecord(key);
    publishRequest = prior?.fingerprint === digest ? prior : {requestId:crypto.randomUUID(),fingerprint:digest};
    await dbRecord(key,publishRequest);
    const result = await api("/builder/publish",{requestId:publishRequest.requestId,model:payload,...(unlockIds.length?{unlockIds}:{})});
    if(payload.base.creation)await dbRecord(`prepared:${user}:${currentPath}`,null);
    publication = {...publishRequest,result}; await dbRecord(key,publication);
    await dbRecord(`archive:${storageKey}:${Date.now()}`,encodeDraft(history));
    preview = true; document.body.classList.add("preview"); $("#preview").setAttribute("aria-pressed","true");
    $("#continue-editing").hidden = false; $("#check-publication").hidden = result.mode === "local";
    $("#publication-status").textContent = result.mode === "local" ? "در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است." : "ثبت GitHub موفق بود؛ وضعیت استقرار هنوز تأیید نشده است.";
    if(result.mode!=='local')monitorPublication(result.sha);
    drawSelection(); updateHistory();
  } catch (error) { $("#publication-status").textContent = `${error.message} پیش‌نویس و تاریخچه حفظ شدند.`; notice(error.message); }
  finally { publishing = false; $(".workspace").inert = false; $("#publish").disabled = !!publication?.result || sessionInfo.user.role !== "admin"; updateHistory(); properties(); }
};
async function refreshLibrary(){library=await api('/library');const previous=$('#page-selector').value;$('#page-selector').replaceChildren();for(const page of library.pages){const option=document.createElement('option');option.value=page.path;option.textContent=`${page.language.toUpperCase()} · ${page.route}`;$('#page-selector').append(option);}$('#page-selector').value=previous;return library;}
function blockLibrary(){const query=$('#block-search').value.trim().toLowerCase(),holder=$('#block-list');holder.replaceChildren();for(const block of BLOCKS.filter(b=>[b.label,b.category,b.description,b.id].join(' ').toLowerCase().includes(query))){const button=document.createElement('button');button.dataset.block=block.id;button.draggable=true;const visual=document.createElement('span');visual.className='block-preview';visual.textContent=block.preview;button.append(visual,document.createTextNode(block.label));const small=document.createElement('small');small.textContent=block.description;button.append(small);button.onclick=()=>insertBlock(block.id);button.ondragstart=event=>{event.dataTransfer.setData('text/x-baran-block',block.id);event.dataTransfer.effectAllowed='copy';};holder.append(button);}}
$('#block-search').oninput=blockLibrary;blockLibrary();
$('#new-section').onclick=()=>insertBlock('section','page');
for(const [key,delta]of [['#section-up',-1],['#section-down',1]])$(key).onclick=()=>{const e=selectedElement();if(!e||e.protected)return;mutate(next=>{const sections=next.sections.filter(s=>!s.protected&&!s.deleted).sort((a,b)=>a.order-b.order),i=sections.findIndex(s=>s.id===e.id),other=sections[i+delta];if(other){const a=sections[i];[a.order,other.order]=[other.order,a.order];}});};
for(const key of ['bold','italic','underline'])$('#rich-'+key).onclick=()=>{const input=$('#text'),start=input.selectionStart,end=input.selectionEnd;mutate(next=>{const e=next.elements.find(e=>e.id===selected[0]);if(!e||e.source||e.locked)return;const text=e.content.text,a=start===end?0:start,b=start===end?text.length:end;e.content.runs=[{text:text.slice(0,a)},{text:text.slice(a,b),[key]:true},{text:text.slice(b)}].filter(r=>r.text);});};
$('#public-preview').onclick=async()=>{if(!history||publishing)return;try{$('#public-preview').disabled=true;const result=await api('/builder/preview',{model:clone(model()),unlockIds:requiredUnlocks(base.model,model()).sort()});$('#output-frame').srcdoc=result.html;$('#output-dialog').showModal();}catch(error){notice(error.message);}finally{$('#public-preview').disabled=false;}};
$('#output-close').onclick=()=>{$('#output-dialog').close();$('#output-frame').srcdoc='';};
$('#guides').onchange=()=>drawSelection();
const context={api,insertBlock,setDevice,refreshInput:()=>canvasInput?.refresh(),isPreview:()=>preview,startGesture,moveGesture,endGesture,cancelGesture,drawSelection,keyboard,revealSelection:focus=>customerUI?.revealSelection(focus),selectAt:event=>{const hit=event.target.closest('[data-builder-id]')||event.target.closest('[data-builder-anchor]');if(hit)select(hit.dataset.builderId||hit.dataset.builderAnchor);},getModel:()=>history?.present,getSelected:()=>selected,getNode:nodeFor,getElement:element,getDocument:()=>doc,isReadOnly:()=>preview||locked||publishing||!draftWritable,getDevice:()=>device,getBase:()=>base,getPath:()=>currentPath,getSession:()=>sessionInfo,getUser:()=>user,mutate,select,notice,onUpdate:fn=>updateHooks.push(fn),dbRecord,save,loadPage,refreshLibrary,openPrepared:async prepared=>{const path=prepared.model.base.path;await dbRecord(`prepared:${user}:${path}`,prepared);await loadPage(path,'',true,prepared);await save();}};
const professional=installProfessionalControls(context);
$('#properties').after($('#professional-controls'));
installPagesUI(context);
customerUI=installCustomerUI(context,professional);
canvasInput=installCanvasInput(context);
installDirectEdit(context,customerUI);
installFontPreview(context);
if(innerWidth<=640)setDevice('mobile',Math.max(280,innerWidth-24));
boot().catch(error => { $("#gate-message").textContent = error.message; });
