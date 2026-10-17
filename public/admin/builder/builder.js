import { History, clone, emptyLayout, safeLink, safeImage, validModel, decodeDraft, encodeDraft } from "./model.js";
import { isFree } from "./layout.js";
import { optimizeImage } from "./images.js";

const $ = selector => document.querySelector(selector);
const frame = $("#page");
let base, history, library, db, storageKey, user, doc, selected = [], device = "desktop", preview = false;
let gesture = null, saveTimer, noticeTimer, locked = false, saveChain = Promise.resolve(), originals = new Map();
let sessionInfo, currentPath = "public/index.html", activeRef = "", sessionTimer, publishing = false, publishRequest = null, publication = null;
const model = () => history.present;
const element = id => model().elements.find(e => e.id === id);
const selectedElement = () => element(selected[0]);
const nodeFor = id => originals.get(id)?.node || doc?.querySelector(`[data-builder-id="${id}"]`);
const unitFor = id => { const node = nodeFor(id); return node?.closest("picture") || node; };
const anchorFor = id => doc.querySelector(`[data-builder-anchor="${id}"]`);
const layoutFor = e => ({ ...e.layouts[device] });
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
  if (!response.ok) throw new Error(data.error || "دریافت اطلاعات ممکن نشد.");
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
  if (locked || !history) return Promise.resolve();
  const raw = encodeDraft(history);
  const key = storageKey;
  $("#save-status").textContent = "در حال ذخیره…";
  saveChain = saveChain.catch(() => {}).then(() => new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put(raw, key);
    transaction.oncomplete = () => { $("#save-status").textContent = "پیش‌نویس در این مرورگر ذخیره شد"; resolve(); };
    transaction.onerror = transaction.onabort = () => reject(new Error("ذخیره انجام نشد؛ فضای مرورگر کافی نیست. پیش‌نویس را دانلود کنید."));
  }));
  return saveChain.catch(error => { $("#save-status").textContent = "ذخیره ناموفق — پیش‌نویس را دانلود کنید"; notice(error.message); });
}
function changed() {
  $("#save-status").textContent = "تغییرات در حال ذخیره…";
  // Queue a transaction immediately so a refresh after an operation retains it.
  save();
}
function commit(next, updateControls = true) {
  if (locked || preview || publishing || !validModel(next, base.model, base.anchors)) return false;
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
  if (locked || preview || publishing) return;
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
  // Restore original DOM relationships before reapplying structural operations.
  // Keep node references: replacing ancestor innerHTML would duplicate moved nodes.
  for (const original of [...originals.values()].reverse()) {
    if (original.unit.parentNode !== original.parent) original.parent.insertBefore(original.unit, original.next?.parentNode === original.parent ? original.next : null);
  }
  for (const node of doc.querySelectorAll("[data-builder-added]")) {
    if (!draft.elements.some(e => e.id === node.dataset.builderId && !e.deleted)) node.remove();
  }
  for (const e of draft.elements) {
    let node = nodeFor(e.id);
    if (!node && !e.source && !e.deleted) {
      node = doc.createElement(({ image: "img", heading: "h2", button: "a", text: "p" })[e.type]);
      node.dataset.builderId = e.id;
      node.dataset.builderAdded = "true";
      node.dataset.builderType = e.type;
      node.dataset.builderCreated = "";
      anchorFor(e.anchor).append(node);
    }
    if (!node) continue;
    const original = originals.get(e.id);
    const unit = unitFor(e.id);
    node.removeAttribute("data-builder-editing");
    if (original?.style) unit.setAttribute("style", original.style); else unit.removeAttribute("style");
    if (unit !== node) { if (original?.nodeStyle) node.setAttribute("style",original.nodeStyle); else node.removeAttribute("style"); }
    if (e.deleted) { unit.style.setProperty("display", "none", "important"); continue; }
    if (e.type === "image") {
      if (node.getAttribute("src") !== e.content.src) node.src = e.content.src;
      node.alt = e.content.alt;
      if (!e.source || e.content.src !== original.src) {
        node.removeAttribute("srcset");
        for (const source of original?.sources || []) source.node.removeAttribute("srcset");
        if (e.content.width) node.setAttribute("width",e.content.width);
        if (e.content.height) node.setAttribute("height",e.content.height);
        if (e.content.variants?.length) { node.srcset = [...e.content.variants,{src:e.content.src,width:e.content.width}].map(v => `${v.src} ${v.width}w`).join(", "); node.sizes = "100vw"; }
      } else {
        if (original.srcset) node.setAttribute("srcset", original.srcset);
        for (const name of ["width","height"]) { if (original[name]) node.setAttribute(name,original[name]); else node.removeAttribute(name); }
        for (const source of original.sources) if (source.srcset) source.node.setAttribute("srcset", source.srcset);
      }
    } else if (e.source) {
      const indices = e.source.textNodes;
      indices.forEach((index, i) => { if (node.childNodes[index]) node.childNodes[index].textContent = i ? "" : e.content.text; });
    } else node.textContent = e.content.text;
    if (e.content.href) node.setAttribute("href", e.content.href);
    const anchor = anchorFor(e.anchor);
    if (isFree(e)) anchor.append(unit);
    if (doc.defaultView.getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
    const bounds = anchor.getBoundingClientRect(), layout = layoutFor(e);
    if (isFree(e)) {
      unit.style.setProperty("position","absolute","important");
      unit.style.left = `${layout.x ?? 10}%`;
      unit.style.top = `${layout.y ?? 10}%`;
    } else if (layout.x != null || layout.y != null || e.z != null) {
      if (doc.defaultView.getComputedStyle(unit).position === "static") unit.style.position = "relative";
      unit.style.translate = `${(layout.x || 0) * bounds.width / 100}px ${(layout.y || 0) * bounds.height / 100}px`;
    }
    if ((layout.width != null || layout.height != null) && doc.defaultView.getComputedStyle(unit).display === "inline") unit.style.display = "inline-block";
    if (layout.width != null) { unit.style.setProperty("width", `${layout.width * bounds.width / 100}px`, "important"); unit.style.setProperty("max-width", "none", "important"); unit.style.setProperty("min-width", "0", "important"); }
    if (layout.height != null) { unit.style.setProperty("height", `${layout.height * bounds.height / 100}px`, "important"); unit.style.setProperty("min-height", "0", "important"); }
    if (unit !== node && isFree(e)) { node.style.setProperty("width","100%","important"); node.style.setProperty("height","100%","important"); node.style.objectFit = "cover"; }
    if (e.z != null) unit.style.zIndex = e.z;
    for (const [key, value] of Object.entries(e.style)) node.style[key] = key === "fontSize" ? `${value}px` : value;
  }
  for (const anchor of base.anchors) for (const e of draft.elements.filter(e => !e.deleted && isFree(e) && e.anchor === anchor.id).sort((a,b)=>(a.order||0)-(b.order||0))) anchorFor(anchor.id).append(unitFor(e.id));
  selected = selected.filter(id => draft.elements.some(e => e.id === id && !e.deleted));
  drawSelection();
  layers(draft);
}
function layers(draft = model()) {
  const holder = $("#layers");
  const scroll = holder.scrollTop;
  holder.replaceChildren();
  for (const e of draft.elements.filter(e => !e.deleted)) {
    const button = document.createElement("button");
    button.textContent = `${e.type === "image" ? "▧" : "T"} ${e.content.text || e.content.alt || "تصویر"}`;
    button.dataset.select = e.id;
    button.setAttribute("aria-pressed", selected.includes(e.id));
    button.title = e.content.text || e.content.alt || e.id;
    holder.append(button);
  }
  holder.scrollTop = scroll;
}
function drawSelection() {
  if (!doc) return;
  if (!gesture) doc.querySelectorAll("[data-builder-overlay]").forEach(n => n.remove());
  doc.querySelectorAll("[data-builder-editing]").forEach(n => n.removeAttribute("data-builder-editing"));
  if (preview) return;
  for (const id of selected) {
    const node = nodeFor(id);
    if (!node || !node.getClientRects().length) continue;
    node.setAttribute("data-builder-editing", "true");
    if (selected.length !== 1) continue;
    const rect = node.getBoundingClientRect();
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = (gesture && doc.querySelector(`[data-resize="${corner}"]`)) || doc.createElement("button");
      handle.dataset.builderOverlay = "handle";
      handle.dataset.resize = corner;
      handle.setAttribute("aria-label", `تغییر اندازه ${corner}`);
      handle.style.cssText = `position:fixed;left:${(corner.includes("w") ? rect.left : rect.right) - 6}px;top:${(corner.includes("n") ? rect.top : rect.bottom) - 6}px;width:13px;height:13px;padding:0;background:white;border:2px solid #2563eb;border-radius:2px;z-index:2147483647;cursor:${corner}-resize;touch-action:none;direction:ltr;`;
      if (!handle.isConnected) doc.body.append(handle);
    }
  }
}
function select(id, multiple = false) {
  if (preview || locked) return;
  selected = multiple ? selected.includes(id) ? selected.filter(i => i !== id) : [...selected, id] : [id];
  if (selectedElement()) $("#anchor").value = selectedElement().anchor;
  drawSelection(); layers(); properties();
}
function properties() {
  const e = selectedElement();
  $("#properties").hidden = !e;
  if (!e) return;
  $("#selection-label").textContent = selected.length > 1 ? `${selected.length} عنصر انتخاب شده` : ({ text: "متن", heading: "عنوان", image: "تصویر", button: "دکمه / پیوند" })[e.type];
  $("#element-id").textContent = e.id;
  $("#text-group").hidden = e.type === "image";
  $("#image-group").hidden = e.type !== "image";
  $("#typography").hidden = e.type === "image";
  $("#link-group").hidden = e.type !== "button";
  $("#text").value = e.content.text || "";
  $("#alt").value = e.content.alt || "";
  $("#href").value = e.content.href || "";
  $("#image-library").value = e.content.src || "";
  const node = nodeFor(e.id), rect = node.getBoundingClientRect(), anchor = anchorFor(e.anchor).getBoundingClientRect(), layout = layoutFor(e), computed = doc.defaultView.getComputedStyle(node);
  $("#x").value = round(layout.x ?? (isFree(e) ? 10 : 0));
  $("#y").value = round(layout.y ?? (isFree(e) ? 10 : 0));
  $("#width").value = round(layout.width ?? rect.width / anchor.width * 100);
  $("#height").value = round(layout.height ?? rect.height / anchor.height * 100);
  $("#z").value = e.z ?? (parseInt(computed.zIndex) || 0);
  $("#fontSize").value = round(parseFloat(computed.fontSize));
  const rgb = computed.color.match(/\d+/g);
  $("#color").value = e.style.color || (rgb ? `#${rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, "0")).join("")}` : "#263329");
  $("#textAlign").value = e.style.textAlign || "start";
  $("#move-anchor").value = e.anchor;
  $("#order").value = e.order || 0;
  $("#move-section").disabled = e.movable === false;
  $("#move-advice").textContent = e.movable === false ? "انتقال این عنصر به‌دلیل ساختار تو‌در‌تو یا رفتار صفحه مجاز نیست؛ متن و اندازه قابل ویرایش‌اند." : "پس از انتقال، چیدمان موبایل را بررسی کنید؛ طرح شما خودکار تغییر نمی‌کند.";
}

function startGesture(event) {
  if (preview || locked || publishing || event.button !== 0) return;
  const resize = event.target.closest("[data-resize]")?.dataset.resize;
  const hit = event.target.closest("[data-builder-id]") || doc.elementsFromPoint(event.clientX, event.clientY).map(n => n.closest("[data-builder-id]")).find(Boolean);
  if (!resize && !hit) { selected = []; drawSelection(); properties(); layers(); return; }
  event.preventDefault();
  if (!resize) {
    if (event.shiftKey) { select(hit.dataset.builderId, true); return; }
    if (!selected.includes(hit.dataset.builderId)) select(hit.dataset.builderId);
  }
  const items = selected.map(id => {
    const e = element(id), rect = nodeFor(id).getBoundingClientRect(), anchor = anchorFor(e.anchor).getBoundingClientRect();
    return { id, rect, anchor, layout: layoutFor(e) };
  });
  gesture = { before: clone(model()), x: event.clientX, y: event.clientY, scrollY:doc.defaultView.scrollY, resize, items, moved: false, target: event.target, pointerId: event.pointerId };
  event.target.setPointerCapture?.(event.pointerId);
}
function moveGesture(event) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y + doc.defaultView.scrollY - gesture.scrollY;
  if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
  gesture.moved = true;
  const next = clone(gesture.before);
  for (const item of gesture.items) {
    const e = next.elements.find(e => e.id === item.id), l = { ...item.layout };
    const xDelta = dx / item.anchor.width * 100, yDelta = dy / item.anchor.height * 100;
    const snap = n => $("#snap").checked ? Math.round(n) : round(n);
    if (gesture.resize) {
      const w = item.rect.width / item.anchor.width * 100, h = item.rect.height / item.anchor.height * 100;
      const west = gesture.resize.includes("w"), north = gesture.resize.includes("n");
      l.width = Math.max(.1, Math.min(300, snap(w + (west ? -xDelta : xDelta))));
      l.height = Math.max(.1, Math.min(300, snap(h + (north ? -yDelta : yDelta))));
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
  if (!gesture.resize && gesture.items.every(item => element(item.id).movable !== false)) {
    const target = base.anchors.find(a => { const r = anchorFor(a.id).getBoundingClientRect(); return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom && gesture.items.some(item => element(item.id).anchor !== a.id); });
    if (target) { gesture.drop = {id:target.id,x:event.clientX,y:event.clientY}; anchorFor(target.id).setAttribute("data-builder-drop",""); }
  }
  if (!gesture.resize && event.clientY > doc.defaultView.innerHeight - 25) doc.defaultView.scrollBy(0,18);
  if (!gesture.resize && event.clientY < 25) doc.defaultView.scrollBy(0,-18);
  render(next);
}
function endGesture(event) {
  if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
  const next = gesture.next;
  const drop = gesture.drop;
  gesture = null;
  doc.querySelectorAll("[data-builder-drop]").forEach(n => n.removeAttribute("data-builder-drop"));
  if (next && drop) {
    const bounds = anchorFor(drop.id).getBoundingClientRect();
    next.elements.filter(e => selected.includes(e.id)).forEach((e,i) => { e.anchor = drop.id; e.free = true; e.order = i; e.layouts[device] = {...e.layouts[device],x:round((drop.x-bounds.left)/bounds.width*100),y:round((drop.y-bounds.top)/bounds.height*100)}; });
    notice("عنصر به بخش جدید منتقل شد. چیدمان موبایل را بررسی کنید؛ تنظیمات اندازه دیگر حفظ شدند.");
  }
  if (next) commit(next); else drawSelection();
}
function cancelGesture() {
  if (gesture) { gesture = null; render(); properties(); }
}
function add(type) {
  if (preview || locked) return;
  const id = `new-${crypto.randomUUID()}`, anchor = $("#anchor").value;
  const e = {
    id, type, anchor, source: null, tag: ({ text: "p", heading: "h2", image: "img", button: "a" })[type],
    content: type === "image" ? { src: library.images[0]?.url || "/assets/images/home/baran-hero.webp", alt: "تصویر جدید" } : { text: ({ text: "متن تازه خود را اینجا بنویسید", heading: "عنوان تازه", button: "مشاهده مجموعه" })[type], ...(type === "button" ? { href: "/catalog/" } : {}) },
    layouts: { desktop: { x: 10, y: 15, width: type === "image" ? 25 : 35, height: type === "image" ? 35 : 12 }, mobile: { x: 5, y: 15, width: type === "image" ? 60 : 85, height: type === "image" ? 35 : 15 } },
    style: type === "image" ? {} : { fontSize: type === "heading" ? 32 : 18, color: "#ffffff" }, z: 10, deleted: false,
  };
  if (mutate(next => next.elements.push(e))) { select(id); nodeFor(id).scrollIntoView({ block: "center" }); }
}
function duplicate() {
  const copies = selected.map(id => {
    const e = clone(element(id)), node = nodeFor(id), rect = node.getBoundingClientRect(), bounds = anchorFor(e.anchor).getBoundingClientRect();
    e.id = `new-${crypto.randomUUID()}`;
    e.source = null;
    e.layouts = emptyLayout();
    e.layouts[device] = { x: round((rect.left - bounds.left) / bounds.width * 100 + 2), y: round((rect.top - bounds.top) / bounds.height * 100 + 2), width: round(rect.width / bounds.width * 100), height: round(rect.height / bounds.height * 100) };
    // Keep a usable fallback on the other viewport too.
    e.layouts[device === "mobile" ? "desktop" : "mobile"] = { ...e.layouts[device], width: device === "desktop" ? Math.min(90, e.layouts[device].width * 2) : e.layouts[device].width };
    const computed = doc.defaultView.getComputedStyle(node);
    if (e.type !== "image") { e.style.fontSize ||= parseFloat(computed.fontSize); const rgb = computed.color.match(/\d+/g); if (rgb) e.style.color ||= `#${rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, "0")).join("")}`; }
    e.z = (e.z || 0) + 1;
    return e;
  });
  if (mutate(next => next.elements.push(...copies))) { selected = copies.map(e => e.id); render(); properties(); }
}
function remove() { mutate(next => next.elements.filter(e => selected.includes(e.id)).forEach(e => e.deleted = true)); }

function bindFrame() {
  doc = frame.contentDocument;
  rememberOriginals();
  doc.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); }, true);
  doc.addEventListener("submit", event => event.preventDefault(), true);
  doc.addEventListener("dragstart", event => event.preventDefault());
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
  new frame.contentWindow.ResizeObserver(() => { drawSelection(); }).observe(doc.body);
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
  if (typing || !selected.length) return;
  if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); remove(); }
  if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (direction) {
    event.preventDefault();
    mutate(next => next.elements.filter(e => selected.includes(e.id)).forEach(e => {
      const l = layoutFor(e), bounds = anchorFor(e.anchor).getBoundingClientRect(), step = event.shiftKey ? 10 : 1;
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
  mutate(next => next.elements.filter(e => selected.includes(e.id)).forEach((e,i) => { e.anchor = destination; e.free = true; e.order = i; e.layouts[device] = {...e.layouts[device],x:10,y:10}; }));
  notice("انتقال ساختاری انجام شد. برای موبایل چیدمان را بررسی کنید.");
};
$("#order").onchange = event => {
  const e = selectedElement();
  if (!e || !event.target.checkValidity()) return;
  if (e.movable === false) { properties(); return notice("ساختار این عنصر اجازه تغییر والد/ترتیب را نمی‌دهد."); }
  const rect = unitFor(e.id).getBoundingClientRect(), anchor = anchorFor(e.anchor).getBoundingClientRect();
  mutate(next => { const item = next.elements.find(item => item.id === e.id); item.order = Number(event.target.value); if (!isFree(item)) { item.free = true; item.layouts[device] = {x:round((rect.left-anchor.left)/anchor.width*100),y:round((rect.top-anchor.top)/anchor.height*100),width:round(rect.width/anchor.width*100),height:round(rect.height/anchor.height*100)}; } });
  notice("ترتیب ساختاری اعمال شد؛ چیدمان موبایل را هم بررسی کنید.");
};
document.querySelectorAll("[data-add]").forEach(button => button.onclick = () => add(button.dataset.add));
$("#layers").onclick = event => {
  const id = event.target.closest("[data-select]")?.dataset.select;
  if (id) { select(id, event.shiftKey); nodeFor(id).scrollIntoView({ block: "center" }); drawSelection(); }
};
document.querySelectorAll("[data-device]").forEach(button => button.onclick = () => {
  cancelGesture(); device = button.dataset.device;
  document.querySelectorAll("[data-device]").forEach(b => b.setAttribute("aria-pressed", b === button));
  $("#frame-wrap").style.width = device === "mobile" ? "390px" : "1280px";
  $("#device-label").textContent = device === "mobile" ? "موبایل · ۳۹۰ × ۸۰۰" : "دسکتاپ · ۱۲۸۰ × ۸۰۰";
  requestAnimationFrame(() => { render(); properties(); });
});
$("#preview").onclick = () => {
  if (publication?.result) return notice("برای ویرایش بعدی، نسخه ثبت‌شده را با دکمه شروع ویرایش باز کنید؛ پیش‌نویس قبلی محفوظ است.");
  cancelGesture(); preview = !preview;
  document.body.classList.toggle("preview", preview);
  doc.documentElement.toggleAttribute("data-builder-preview", preview);
  $("#preview").setAttribute("aria-pressed", preview);
  $("#preview").textContent = preview ? "بازگشت به ویرایش" : "پیش‌نمایش";
  drawSelection(); updateHistory();
};
for (const key of ["text", "alt", "href"]) $("#" + key).addEventListener("input", event => {
  if (!selectedElement()) return;
  const value = event.target.value;
  if (key === "href" && !safeLink(value)) { event.target.setCustomValidity("آدرس معتبر سایت یا https وارد کنید."); event.target.reportValidity(); return; }
  event.target.setCustomValidity("");
  mutate(next => next.elements.find(e => e.id === selected[0]).content[key] = value, false);
});
for (const key of ["x", "y", "width", "height"]) $("#" + key).addEventListener("change", event => {
  if (!selectedElement() || !event.target.checkValidity() || event.target.value === "") { properties(); return; }
  mutate(next => { const e = next.elements.find(e => e.id === selected[0]); e.layouts[device][key] = Number(event.target.value); });
});
for (const key of ["fontSize", "color", "textAlign", "z"]) $("#" + key).addEventListener("change", event => {
  if (!selectedElement() || !event.target.checkValidity()) return;
  mutate(next => { const e = next.elements.find(e => e.id === selected[0]); if (key === "z") e.z = Number(event.target.value); else e.style[key] = key === "fontSize" ? Number(event.target.value) : event.target.value; });
});
$("#reset-layout").onclick = () => mutate(next => { const e = next.elements.find(e => e.id === selected[0]); if (e) e.layouts[device] = {}; });
$("#image-library").onchange = event => { if (safeImage(event.target.value)) mutate(next => { const content = next.elements.find(e => e.id === selected[0]).content; content.src = event.target.value; delete content.variants; delete content.width; delete content.height; }); };
$("#upload").onchange = event => { upload(event.target.files[0]).catch(error => notice(error.message)); event.target.value = ""; };
$("#export").onclick = () => download(encodeDraft(history));
$("#import").onchange = async event => {
  try {
    const file = event.target.files[0];
    if (!file || file.size > 20_000_000) throw new Error("فایل پیش‌نویس باید حداکثر ۲۰ مگابایت باشد.");
    const imported = decodeDraft(await file.text(), base.model, base.anchors);
    // Import is itself one undoable operation, preserving current local work.
    commit(imported.present);
    notice("پیش‌نویس بازیابی شد؛ واگرد برای بازگشت به قبل در دسترس است.");
  } catch (error) { notice(error.message); }
  event.target.value = "";
};
window.addEventListener("pagehide", () => { if (history) save(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && history) save(); else if (history) checkSession(); });

function lock(message) {
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
function launch() {
  $("#gate").hidden = true; $("#builder").hidden = false;
  frame.addEventListener("load", bindFrame, { once: true });
  frame.srcdoc = base.html;
  clearInterval(sessionTimer); sessionTimer = setInterval(checkSession, 45_000);
}
async function loadPage(path, ref = "", fresh = false) {
  if (publishing) return;
  if (history && storageKey) await save();
  const next = await api(`/builder?path=${encodeURIComponent(path)}${ref ? `&ref=${ref}` : ""}`);
  base = next; currentPath = path; activeRef = ref;
  const address = new URL(location.href); address.searchParams.set("path",path);
  if (ref) address.searchParams.set("ref",ref); else address.searchParams.delete("ref");
  window.history.replaceState(null,"",address);
  storageKey = `${user}:${path}${ref ? `:restore:${ref}` : ""}`;
  selected = []; originals.clear(); doc = null; preview = false; publication = null; publishRequest = null;
  document.body.classList.remove("preview"); $("#preview").setAttribute("aria-pressed","false"); $("#preview").textContent = "پیش‌نمایش";
  $("#publication-status").textContent = ""; $("#check-publication").hidden = true; $("#continue-editing").hidden = true;
  $("#publish").disabled = sessionInfo.user.role !== "admin";
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
    try { history = decodeDraft(saved, base.model, base.anchors); $("#save-status").textContent = "پیش‌نویس و تاریخچه قبلی بازیابی شدند"; }
    catch {
      $("#gate-message").textContent = "نسخه پایه صفحه تغییر کرده یا پیش‌نویس ناسازگار است. ابتدا نسخه قبلی را دانلود کنید. شروع تازه فقط پیش‌نویس این مرورگر را جایگزین می‌کند.";
      const prior = await dbRecord(`request:${storageKey}`);
      const recovered = prior?.requestId && prior.requestId === base.receipt?.requestId;
      if (recovered) {
        await dbRecord(`archive:${storageKey}:${Date.now()}`,saved);
        $("#gate-message").textContent = "ثبت درخواست قبلی در نسخه جاری صفحه تأیید شد. پیش‌نویس و تاریخچه قبلی محفوظ‌اند؛ نسخه ثبت‌شده را باز کنید. وضعیت استقرار آنلاین هنوز تأیید نشده است.";
      }
      const backup = document.createElement("button"); backup.textContent = "دانلود پیش‌نویس قبلی"; backup.onclick = () => download(saved, "baran-previous-draft.json");
      const fresh = document.createElement("button"); fresh.textContent = recovered ? "باز کردن نسخه ثبت‌شده" : "شروع پیش‌نویس تازه از صفحه فعلی";
      fresh.onclick = async () => {
        try { await dbRecord(`archive:${storageKey}:${Date.now()}`,saved); backup.remove(); fresh.remove(); await loadPage(currentPath,activeRef,true); await save(); }
        catch (error) { notice(error.message); }
      };
      $("#gate").append(backup, fresh);
      $("#gate").hidden = false; $("#builder").hidden = true;
      return;
    }
  }
  const revisions = await api(`/history?path=${encodeURIComponent(path)}`);
  $("#revisions").replaceChildren();
  for (const entry of revisions.entries) { const option = document.createElement("option"); option.value = entry.sha; option.textContent = `${entry.date?.slice(0,10) || ""} ${entry.message || "نسخه قبلی"}`; $("#revisions").append(option); }
  $("#load-revision").disabled = !revisions.entries.length;
  await refreshArchives();
  launch();
}
async function boot() {
  sessionInfo = await api("/session");
  if (!sessionInfo.user || !["admin", "editor"].includes(sessionInfo.user.role)) { $("#gate-message").textContent = "برای ویرایش صفحه، با حساب مدیر یا ویرایشگر وارد پنل مدیریت شوید و سپس به این آدرس برگردید."; return; }
  user = sessionInfo.user.username;
  [library,db] = await Promise.all([api("/library"),openDB()]);
  for (const page of library.pages) { const option = document.createElement("option"); option.value = page.path; option.textContent = `${page.language.toUpperCase()} · ${page.route}`; $("#page-selector").append(option); }
  for (const image of library.images) { const option = document.createElement("option"); option.value = image.url; option.textContent = image.path.split("/").slice(-2).join("/"); $("#image-library").append(option); }
  const requested = new URL(location.href).searchParams.get("path");
  const ref = new URL(location.href).searchParams.get("ref") || "";
  await loadPage(library.pages.some(p => p.path === requested) ? requested : "public/index.html", /^[a-f0-9]{40}$/.test(ref) ? ref : "");
}

function dbRecord(key, value) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction("drafts",value === undefined ? "readonly" : "readwrite");
    const request = value === undefined ? tx.objectStore("drafts").get(key) : tx.objectStore("drafts").put(value,key);
    let result; request.onsuccess = () => result = request.result;
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(new Error("ثبت اطلاعات بازیابی درخواست ممکن نشد؛ پیش‌نویس را دانلود کنید."));
  });
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
  const result = await api(`/builder/status?sha=${encodeURIComponent(publication.result.sha)}`);
  const labels = {success:"گزارش موفق استقرار production از Cloudflare در GitHub تأیید شد.",failure:"استقرار شکست خورده است؛ ثبت GitHub محفوظ است.",error:"خطای استقرار گزارش شده است.",pending:"استقرار در انتظار است.",queued:"استقرار در صف است.",in_progress:"استقرار در حال اجراست.",inactive:"این استقرار دیگر فعال نیست.",superseded:"نسخه جدیدتری در شاخه ثبت شده است؛ این وضعیت نسخه جاری سایت را تأیید نمی‌کند.",unknown:"استقرار قابل تأیید نیست؛ وضعیت Cloudflare را بررسی کنید."};
  $("#publication-status").textContent = `${result.commit === "committed" ? "ثبت GitHub تأیید شد." : "تأیید دوباره commit در دسترس نیست."} ${labels[result.deployment] || labels.unknown}`;
}
$("#page-selector").onchange = event => loadPage(event.target.value).catch(error => { $("#page-selector").value = currentPath; notice(error.message); });
$("#load-revision").onclick = () => loadPage(currentPath,$("#revisions").value).catch(error => notice(error.message));
$("#load-current").onclick = () => loadPage(currentPath).catch(error => notice(error.message));
$("#continue-editing").onclick = async () => {
  // Archive the old history before explicitly advancing to the committed base.
  await dbRecord(`archive:${storageKey}:${Date.now()}`,encodeDraft(history));
  await loadPage(currentPath,"",true); await save();
};
$("#check-publication").onclick = () => status().catch(error => notice(error.message));
$("#publish").onclick = () => {
  if (sessionInfo.user.role !== "admin" || publishing) return;
  $("#publish-description").textContent = sessionInfo.mode === "local" ? "صفحه و تصاویر در پروژه محلی ذخیره می‌شوند. هیچ Push یا Deploy انجام نمی‌شود." : "صفحه و تصاویر در GitHub ثبت می‌شوند؛ روند استقرار تنظیم‌شده ممکن است آغاز شود.";
  $("#publish-dialog").showModal();
};
$("#publish-cancel").onclick = () => $("#publish-dialog").close();
$("#publish-confirm").onclick = async () => {
  if (publishing || sessionInfo.user.role !== "admin") return;
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
    if (history.commit(normalized)) { render(); updateHistory(); }
    await save();
    const payload = clone(model()), digest = await fingerprint(payload), key = `request:${storageKey}`, prior = await dbRecord(key);
    publishRequest = prior?.fingerprint === digest ? prior : {requestId:crypto.randomUUID(),fingerprint:digest};
    await dbRecord(key,publishRequest);
    const result = await api("/builder/publish",{requestId:publishRequest.requestId,model:payload});
    publication = {...publishRequest,result}; await dbRecord(key,publication);
    await dbRecord(`archive:${storageKey}:${Date.now()}`,encodeDraft(history));
    preview = true; document.body.classList.add("preview"); $("#preview").setAttribute("aria-pressed","true");
    $("#continue-editing").hidden = false; $("#check-publication").hidden = result.mode === "local";
    $("#publication-status").textContent = result.mode === "local" ? "در فایل‌های محلی ثبت شد؛ هیچ استقرار آنلاینی انجام نشده است." : "ثبت GitHub موفق بود؛ وضعیت استقرار هنوز تأیید نشده است.";
    drawSelection(); updateHistory();
  } catch (error) { $("#publication-status").textContent = `${error.message} پیش‌نویس و تاریخچه حفظ شدند.`; notice(error.message); }
  finally { publishing = false; $(".workspace").inert = false; $("#publish").disabled = !!publication?.result || sessionInfo.user.role !== "admin"; updateHistory(); properties(); }
};
boot().catch(error => { $("#gate-message").textContent = error.message; });
