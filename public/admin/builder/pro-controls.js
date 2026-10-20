import { safeImage, effectiveLayout as schemaLayout, effectiveStyle as schemaStyle } from "./model.js";
import {lockedBy} from './locks.js';
import {FONT_CATALOG} from './fonts.js';
import {allocateIdentityMap,remapElementIdentity,newElementID} from './identity.js';

const devices = ["desktop", "tablet", "mobile"];
const copy = value => JSON.parse(JSON.stringify(value));
const parentOf = element => element.parentId || element.anchor;
const free = element => (element.layoutMode || (!element.source || element.free ? "free" : "flow")) === "free";
const rounded = value => Math.round(value * 1000) / 1000;
const newId = newElementID;

export function inheritedStyle(element, device = "desktop") {
  return schemaStyle(element, device);
}

export function effectiveLayout(element, device = "desktop") {
  return schemaLayout(element, device);
}

export function selectedRoots(elements, ids) {
  const active = new Map(elements.filter(element => !element.deleted).map(element => [element.id, element]));
  const chosen = new Set(ids.filter(id => active.has(id)));
  return [...chosen].filter(id => {
    const visited = new Set([id]);
    let parent = parentOf(active.get(id));
    while (active.has(parent) && !visited.has(parent)) {
      if (chosen.has(parent)) return false;
      visited.add(parent); parent = parentOf(active.get(parent));
    }
    return true;
  });
}

export function subtreeIds(elements, ids) {
  const result = new Set(selectedRoots(elements, ids));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const element of elements) if (!element.deleted && result.has(parentOf(element)) && !result.has(element.id)) { result.add(element.id); expanded = true; }
  }
  return result;
}

/** Switching to flow restores the document's layout without discarding free geometry. */
export function switchLayoutMode(elements, ids, mode, { device = "desktop", boxes = new Map() } = {}) {
  if (!devices.includes(device) || !["flow", "free"].includes(mode)) throw new Error("روش یا اندازهٔ چیدمان معتبر نیست.");
  const next = copy(elements), selected = new Set(ids);
  for (const element of next.filter(element => selected.has(element.id) && !element.deleted)) {
    if (element.source || element.locked) throw new Error("تغییر روش چیدمان برای ساختار اصلی یا عنصر قفل‌شده مجاز نیست؛ ابتدا قفل را باز کنید یا از عنصر یک نسخهٔ تازه بسازید.");
    if ((free(element) ? "free" : "flow") === mode) continue;
    if (mode === "flow") {
      if (next.some(child => !child.deleted && parentOf(child) === element.id && free(child) && !selected.has(child.id))) throw new Error("ابتدا فرزندان آزاد این ظرف را به جریان عادی برگردانید؛ ظرف بدون ارتفاع نمی‌تواند جای آن‌ها را در صفحه حفظ کند.");
      element.freeLayouts = copy(element.layouts);
      element.layouts = Object.fromEntries(devices.map(name => [name, Object.hasOwn(element.layouts[name] || {}, "hidden") ? { hidden: element.layouts[name].hidden } : {}]));
    } else if (element.freeLayouts) {
      element.layouts = Object.fromEntries(devices.map(name => {
        const layout = { ...element.freeLayouts[name] };
        if (Object.hasOwn(element.layouts[name] || {}, "hidden")) layout.hidden = element.layouts[name].hidden; else delete layout.hidden;
        return [name, layout];
      }));
      delete element.freeLayouts;
    } else {
      const box = boxes.get(element.id);
      if (!box || !["x", "y", "width", "height"].every(key => Number.isFinite(box[key]))) throw new Error("اندازهٔ عنصر در پیش‌نمایش در دسترس نیست؛ صفحه را دوباره باز کنید.");
      const measured={x:box.x,y:box.y};
      for(const dimension of ['width','height']){
        if(box[dimension]>=.1&&box[dimension]<=300){measured[dimension]=box[dimension];measured[dimension+'Unit']='%';}
        else{const pixels=box[dimension==='width'?'pixelWidth':'pixelHeight'];if(!Number.isFinite(pixels)||pixels<.1||pixels>4000)throw new Error('اندازهٔ عنصر برای جای‌گذاری آزاد قابل اندازه‌گیری نیست؛ ابتدا ابعاد را تنظیم کنید.');measured[dimension]=pixels;measured[dimension+'Unit']='px';}
      }
      element.layouts[device] = { ...element.layouts[device], ...measured };
    }
    element.layoutMode = mode; element.free = mode === "free";
  }
  return next;
}

function geometry(element, device) {
  const layout = effectiveLayout(element, device);
  if (["widthUnit", "heightUnit"].some(key => layout[key] && layout[key] !== "%")) throw new Error("برای گروه‌بندی یا تراز دقیق، ابتدا واحد عرض و ارتفاع عناصر آزاد را روی درصد قرار دهید.");
  if (!["x", "y", "width", "height"].every(key => Number.isFinite(layout[key]))) throw new Error("ابتدا موقعیت و اندازهٔ این عناصر را تعیین کنید؛ گروه‌بندی به اندازهٔ مشخص نیاز دارد.");
  return layout;
}

function compatible(elements, ids, minimum = 2, allowOriginal = false) {
  const roots = selectedRoots(elements, ids).map(id => elements.find(element => element.id === id));
  if (roots.length < minimum) throw new Error(`دست‌کم ${minimum} عنصر مستقل را با Shift انتخاب کنید.`);
  if (!allowOriginal && roots.some(element => element.source)) throw new Error("گروه‌بندی ساختار اصلی سایت ممکن است وابستگی‌های آن را تغییر دهد؛ ابتدا عناصر را تکثیر کنید و نسخه‌های تازه را گروه‌بندی کنید.");
  if (roots.some(element => element.locked)) throw new Error("ابتدا قفل عناصر انتخاب‌شده را باز کنید.");
  if (roots.some(element => !free(element))) throw new Error("این عملیات برای عناصر آزاد است؛ ابتدا چیدمان عناصر را روی «آزاد» قرار دهید.");
  if (roots.some(element => parentOf(element) !== parentOf(roots[0]))) throw new Error("عناصر باید داخل یک والد باشند؛ ابتدا آن‌ها را به یک بخش یا ظرف منتقل کنید.");
  return roots;
}

/** Returns a new array; grouping never mutates callers or loses breakpoint geometry. */
export function groupElements(elements, ids, id = newId()) {
  const roots = compatible(elements, ids);
  if (elements.some(element => element.id === id)) throw new Error("شناسهٔ گروه تکراری است.");
  const next = copy(elements), rootIds = new Set(roots.map(element => element.id));
  const initialBoxes = new Map(roots.map(element => [element.id, Object.fromEntries(devices.map(device => [device, geometry(element, device)]))]));
  const group = { id, type: "container", kind: "group", tag: "div", source: null, parentId: parentOf(roots[0]), anchor: roots[0].anchor, layoutMode: "free", free: true, content: { text: "گروه عناصر" }, layouts: {}, style: {}, responsiveStyles: { tablet: {}, mobile: {} }, z: Math.min(...roots.map(element => element.z || 0)), order: Math.min(...roots.map(element => element.order || 0)), locked: false, deleted: false };
  for (const device of devices) {
    const boxes = roots.map(element => geometry(element, device));
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
    const width = Math.max(...boxes.map(box => box.x + box.width)) - x, height = Math.max(...boxes.map(box => box.y + box.height)) - y;
    if (width < .1 || height < .1 || width > 300 || height > 300) throw new Error("محدودهٔ گروه از اندازهٔ مجاز ظرف بزرگ‌تر است؛ عناصر را نزدیک‌تر کنید یا داخل یک ظرف بزرگ‌تر قرار دهید.");
    group.layouts[device] = { x: rounded(x), y: rounded(y), width: rounded(width), height: rounded(height) };
    for (const element of next.filter(element => rootIds.has(element.id))) {
      const box = initialBoxes.get(element.id)[device];
      element.layouts[device] = { ...element.layouts[device], x: rounded((box.x - x) / width * 100), y: rounded((box.y - y) / height * 100), width: rounded(box.width / width * 100), height: rounded(box.height / height * 100) };
    }
  }
  for (const element of next.filter(element => rootIds.has(element.id))) element.parentId = id;
  next.push(group);
  return { elements: next, id };
}

export function ungroupElements(elements, ids) {
  const next = copy(elements), selected = [];
  const roots = selectedRoots(next, ids).map(id => next.find(element => element.id === id));
  if (!roots.length || roots.some(element => element.source || element.type !== "container" || element.kind !== "group" || !free(element) || element.locked)) throw new Error("یک گروه آزاد و بدون قفل را انتخاب کنید؛ بخش‌های محتوایی را نمی‌توان به‌عنوان گروه باز کرد.");
  for (const group of roots) {
    const children = next.filter(element => !element.deleted && parentOf(element) === group.id);
    if (children.some(element => !free(element))) throw new Error("فرزندان این گروه در جریان عادی هستند؛ پیش از بازکردن گروه، آن‌ها را آزاد کنید.");
    for (const child of children) {
      const innerBoxes = Object.fromEntries(devices.map(device => [device, geometry(child, device)]));
      for (const device of devices) {
        const outer = geometry(group, device), inner = innerBoxes[device];
        child.layouts[device] = { ...child.layouts[device], x: rounded(outer.x + inner.x * outer.width / 100), y: rounded(outer.y + inner.y * outer.height / 100), width: rounded(inner.width * outer.width / 100), height: rounded(inner.height * outer.height / 100) };
      }
      child.parentId = parentOf(group); child.anchor = group.anchor; selected.push(child.id);
    }
    group.deleted = true;
  }
  return { elements: next, ids: selected };
}

/** Copies the complete subtree with fresh IDs, preserving hierarchy and responsive overrides. */
export function cloneSubtrees(elements, ids, { idFactory = newId, offset = 2, targetParentId, targetAnchor } = {}) {
  const roots = selectedRoots(elements, ids), included = subtreeIds(elements, roots);
  if (!roots.length) throw new Error("ابتدا عنصری را انتخاب کنید.");
  const source = elements.filter(element => included.has(element.id) && !element.deleted);
  if (source.some(element => element.source && elements.some(child => !child.deleted && parentOf(child) === element.id))) throw new Error("تکثیر ظرف اصلیِ دارای ساختار وابسته امن نیست؛ از یک بخش تازه استفاده کنید.");
  const mapping=allocateIdentityMap(source.map(e=>e.id),{reserved:elements.map(e=>e.id),idFactory,validate:id=>/^new-[a-zA-Z0-9-]+$/.test(id)});
  const rootSet = new Set(roots);
  const copies = source.map(element => {
    const duplicate = remapElementIdentity(element,mapping);
    duplicate.id = mapping.get(element.id); duplicate.source = null; duplicate.locked = false; duplicate.deleted = false; duplicate.movable = true;
    duplicate.parentId = mapping.get(parentOf(element)) || targetParentId || parentOf(element);
    duplicate.anchor = targetAnchor || mapping.get(element.anchor) || element.anchor;
    duplicate.responsiveStyles ||= { tablet: {}, mobile: {} };
    if (element.source) { duplicate.layoutMode = "free"; duplicate.free = true; }
    duplicate.z = Math.min(10000, (duplicate.z || 0) + 1);
    if (rootSet.has(element.id)) {
      duplicate.order = Math.min(10000, (duplicate.order || 0) + 1);
      if (free(duplicate)) for (const device of devices) {
        const layout = effectiveLayout(element, device);
        duplicate.layouts[device] = { ...layout, x: Math.min(500, rounded((layout.x ?? 10) + offset)), y: Math.min(500, rounded((layout.y ?? 10) + offset)) };
      }
    }
    return duplicate;
  });
  return { elements: copies, ids: roots.map(id => mapping.get(id)) };
}

export function alignElements(elements, ids, device, operation) {
  if (!devices.includes(device) || !["left", "center", "right", "top", "middle", "bottom", "distribute-x", "distribute-y"].includes(operation)) throw new Error("نوع تراز یا اندازهٔ صفحه معتبر نیست.");
  const roots = compatible(elements, ids, 2, true), next = copy(elements), boxes = roots.map(element => geometry(element, device));
  const horizontal = ["left", "center", "right", "distribute-x"].includes(operation), axis = horizontal ? "x" : "y", size = horizontal ? "width" : "height";
  const min = Math.min(...boxes.map(box => box[axis])), max = Math.max(...boxes.map(box => box[axis] + box[size]));
  if (operation.startsWith("distribute")) {
    if (roots.length < 3) throw new Error("برای توزیع فاصله، دست‌کم سه عنصر آزاد را انتخاب کنید.");
    const ordered = roots.map((element, index) => ({ element, box: boxes[index] })).sort((a, b) => a.box[axis] - b.box[axis]);
    const gap = (max - min - boxes.reduce((sum, box) => sum + box[size], 0)) / (ordered.length - 1);
    let cursor = min;
    for (const { element, box } of ordered) { next.find(item => item.id === element.id).layouts[device] = { ...element.layouts[device], [axis]: rounded(cursor) }; cursor += box[size] + gap; }
  } else for (const [index, element] of roots.entries()) {
    const position = ["left", "top"].includes(operation) ? min : ["right", "bottom"].includes(operation) ? max - boxes[index][size] : (min + max - boxes[index][size]) / 2;
    next.find(item => item.id === element.id).layouts[device] = { ...element.layouts[device], [axis]: rounded(position) };
  }
  return next;
}

export function moveLayer(elements, ids, direction) {
  if (!["front", "back"].includes(direction)) throw new Error("جهت لایه معتبر نیست.");
  const next = copy(elements), chosen = selectedRoots(next, ids).map(id => next.find(element => element.id === id));
  if (chosen.some(element => element.locked)) throw new Error("ابتدا قفل عناصر انتخاب‌شده را باز کنید.");
  const selected = new Set(chosen.map(element => element.id));
  for (const parentId of new Set(chosen.map(parentOf))) {
    const siblings = next.filter(element => !element.deleted && parentOf(element) === parentId), moving = siblings.filter(element => selected.has(element.id)).sort((a, b) => (a.z || 0) - (b.z || 0));
    const others = siblings.filter(element => !selected.has(element.id));
    const low = Math.min(...moving.map(element => element.z || 0)), high = Math.max(...moving.map(element => element.z || 0));
    const nearest = direction === "front" ? others.filter(element => (element.z || 0) >= high).sort((a, b) => (a.z || 0) - (b.z || 0))[0] : others.filter(element => (element.z || 0) <= low).sort((a, b) => (b.z || 0) - (a.z || 0))[0];
    const start = direction === "front" ? (nearest?.z ?? high) + 1 : (nearest?.z ?? low) - moving.length;
    if (start < -10000 || start + moving.length - 1 > 10000) throw new Error("لایه‌ها به محدودهٔ مجاز رسیده‌اند؛ مقدار ترتیب لایه را از کنترل عددی اصلاح کنید.");
    moving.forEach((element, index) => element.z = start + index);
  }
  return next;
}

const numeric = (key, label, min, max, step = 1) => ({ key, label, type: "number", min, max, step });
const choice = (key, label, options) => ({ key, label, type: "select", options });
const palette = (key, label) => ({ key, label, type: "color" });
const styleGroups = [
  { name: "نوشتار", text: true, fields: [choice("fontFamily", "خانوادهٔ قلم", [["Tahoma", "تاهوما"], ["Arial", "آریال"], ["Georgia", "جورجیا"], ["system-ui", "قلم دستگاه"], ...FONT_CATALOG.map(f=>[f.id,f.label])]), numeric("fontSize", "اندازهٔ قلم · px", 8, 200), numeric("fontWeight", "وزن قلم", 100, 900, 100), numeric("lineHeight", "فاصلهٔ خطوط", .7, 4, .1), numeric("letterSpacing", "فاصلهٔ حروف · px", -10, 30, .1), choice("textAlign", "تراز متن", [["start", "ابتدا"], ["center", "وسط"], ["end", "انتها"], ["justify", "هم‌تراز"]]), palette("color", "رنگ متن")] },
  { name: "رنگ و پس‌زمینه", fields: [palette("backgroundColor", "رنگ زمینه"), numeric("opacity", "شفافیت · ۰ تا ۱", 0, 1, .05), { key: "backgroundImage", label: "تصویر زمینه · آدرس کتابخانه", type: "text" }] },
  { name: "فاصله و اندازه", fields: [numeric("padding", "فاصلهٔ درونی · px", 0, 500), numeric("margin", "فاصلهٔ بیرونی · px", -200, 500), numeric("minWidth", "کمینهٔ عرض · px", 0, 4000), numeric("maxWidth", "بیشینهٔ عرض · px", 0, 4000), numeric("minHeight", "کمینهٔ ارتفاع · px", 0, 4000), numeric("maxHeight", "بیشینهٔ ارتفاع · px", 0, 4000)] },
  { name: "کادر و سایه", fields: [numeric("borderWidth", "ضخامت کادر · px", 0, 30), palette("borderColor", "رنگ کادر"), choice("borderStyle", "نوع کادر", [["none", "بدون کادر"], ["solid", "پیوسته"], ["dashed", "خط‌چین"], ["dotted", "نقطه‌چین"]]), numeric("borderRadius", "گردی گوشه · px", 0, 500), choice("boxShadow", "سایه", [["none", "بدون سایه"], ["soft", "ملایم"], ["medium", "متوسط"], ["strong", "پررنگ"]])] },
  { name: "چیدمان ظرف", container: true, fields: [choice("display", "ساختار ظرف", [["block", "عادی"], ["grid", "ستون‌بندی"], ["flex", "انعطاف‌پذیر"]]), numeric("gridColumns", "تعداد ستون‌ها", 1, 6), numeric("gap", "فاصلهٔ فرزندان · px", 0, 200), choice("flexDirection", "جهت فرزندان", [["row", "ردیفی"], ["column", "ستونی"]]), choice("alignItems", "تراز فرزندان", [["start", "ابتدا"], ["center", "وسط"], ["end", "انتها"], ["stretch", "کشیده"]]), choice("justifyContent", "پخش فرزندان", [["start", "ابتدا"], ["center", "وسط"], ["end", "انتها"], ["space-between", "فاصلهٔ برابر"]])] },
  { name: "نمایش تصویر", image: true, fields: [choice("objectFit", "جای‌گیری تصویر", [["cover", "پوشاندن کادر"], ["contain", "نمایش کامل"], ["fill", "پرکردن کادر"], ["scale-down", "کوچک‌کردن در صورت نیاز"]]), numeric("focalX", "نقطهٔ تمرکز افقی · %", 0, 100), numeric("focalY", "نقطهٔ تمرکز عمودی · %", 0, 100)] },
];

function elementNode(document, tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

export function installProfessionalControls(ctx) {
  const document = globalThis.document;
  if (!document || document.querySelector("#professional-controls")) return;
  const inspector = document.querySelector(".inspector");
  if (!inspector) return;
  const panel = elementNode(document, "section", { id: "professional-controls", class: "pro-panel", hidden: "" });
  const heading = elementNode(document, "h2", {}, "ظاهر و چیدمان");
  const deviceLabel = elementNode(document, "p", { class: "pro-device-note", "aria-live": "polite" });
  const selectionNote = elementNode(document, "p", { class: "muted pro-selection-note" });
  const layoutLabel = elementNode(document, "label", {}, "روش چیدمان");
  const mode = elementNode(document, "select", { id: "pro-layout-mode" });
  mode.append(elementNode(document, "option", { value: "free" }, "آزاد · جابه‌جایی دقیق"), elementNode(document, "option", { value: "flow" }, "جریان عادی · واکنش‌گرا")); layoutLabel.append(mode);
  const modeAdvice = elementNode(document, "p", { class: "muted" });
  const actions = elementNode(document, "div", { class: "pro-action-grid" });
  const buttons = {};
  for (const [name, label, title] of [["lock", "قفل عنصر", "عنصر قفل‌شده انتخاب می‌شود ولی جابه‌جا نمی‌شود."], ["hide", "پنهان در این اندازه", "نمایش فقط برای اندازهٔ فعلی تغییر می‌کند."], ["front", "یک لایه جلو", "ترتیب روی‌هم‌قرارگیری"], ["back", "یک لایه عقب", "ترتیب روی‌هم‌قرارگیری"], ["group", "گروه‌کردن", "عناصر آزادِ تازه و داخل یک والد"], ["ungroup", "بازکردن گروه", "بازگردانی فرزندان گروه به والد آن"], ["copy", "کپی عناصر", "Ctrl+C / ⌘C خارج از ورودی متن"], ["paste", "چسباندن عناصر", "Ctrl+V / ⌘V داخل همین ویرایشگر"]]) {
    const button = elementNode(document, "button", { type: "button", "data-pro-action": name, title }, label); actions.append(button); buttons[name] = button;
  }
  panel.append(heading, deviceLabel, selectionNote, layoutLabel, modeAdvice, actions);
  const alignDetails = elementNode(document, "details", { class: "pro-details" }); alignDetails.append(elementNode(document, "summary", {}, "تراز و توزیع چند عنصر"));
  const alignGrid = elementNode(document, "div", { class: "pro-align-grid" });
  for (const [operation, label] of [["left", "لبهٔ چپ"], ["center", "مرکز افقی"], ["right", "لبهٔ راست"], ["top", "لبهٔ بالا"], ["middle", "مرکز عمودی"], ["bottom", "لبهٔ پایین"], ["distribute-x", "فاصلهٔ افقی"], ["distribute-y", "فاصلهٔ عمودی"]]) alignGrid.append(elementNode(document, "button", { type: "button", "data-pro-align": operation }, label));
  alignDetails.append(alignGrid); panel.append(alignDetails);
  const fields = [], groups = [];
  for (const group of styleGroups) {
    const details = elementNode(document, "details", { class: "pro-details" }); details.append(elementNode(document, "summary", {}, group.name));
    const grid = elementNode(document, "div", { class: "pro-field-grid" });
    for (const spec of group.fields) {
      const field = elementNode(document, "div", { class: "pro-field" });
      const label = elementNode(document, "label", { for: `pro-${spec.key}` }, spec.label);
      const badge = elementNode(document, "span", { class: "pro-inherit" }); label.append(badge);
      const row = elementNode(document, "div", { class: "pro-input-row" });
      const input = elementNode(document, spec.type === "select" ? "select" : "input", { id: `pro-${spec.key}`, "data-pro-style": spec.key, ...(spec.type !== "select" ? { type: spec.type } : {}) });
      if (spec.type === "select") { input.append(elementNode(document, "option", { value: "" }, "پیش‌فرض / ارث‌بری")); for (const [value, text] of spec.options) input.append(elementNode(document, "option", { value }, text)); }
      if (spec.type === "number") for (const key of ["min", "max", "step"]) input.setAttribute(key, spec[key]);
      if (spec.type === "text") { input.dir = "ltr"; input.maxLength = 3000000; input.placeholder = "/assets/…/image.webp"; }
      const reset = elementNode(document, "button", { type: "button", class: "pro-reset-one", "data-pro-reset": spec.key, title: `بازنشانی ${spec.label}`, "aria-label": `بازنشانی ${spec.label}` }, "↺");
      row.append(input, reset); field.append(label, row); grid.append(field); fields.push({ spec, input, badge, reset });
    }
    details.append(grid); panel.append(details); groups.push({ group, details });
  }
  const ratioLabel = elementNode(document, "label", {}, "نسبت کادر تصویر — اندازهٔ فعلی");
  const ratio = elementNode(document, "select", { id: "pro-image-ratio" });
  for (const [value, label] of [["", "انتخاب نسبت"], ["0", "بدون نسبت ثابت"], ["1", "مربع · ۱:۱"], ["1.333333", "افقی · ۴:۳"], ["1.5", "افقی · ۳:۲"], ["1.777778", "افقی · ۱۶:۹"], ["0.5625", "عمودی · ۹:۱۶"]]) ratio.append(elementNode(document, "option", { value }, label));
  ratioLabel.append(ratio); panel.append(ratioLabel);
  const resetAll = elementNode(document, "button", { type: "button", id: "pro-reset-style", class: "pro-full-button" }, "بازنشانی ظاهر این اندازه");
  const warning = elementNode(document, "p", { class: "pro-warning", role: "status" });
  panel.append(resetAll, warning);
  const properties = document.querySelector("#properties");
  if (properties) properties.after(panel); else inspector.append(panel);
  let clipboard = null, boundFrame;

  const allElements = model => [...(model?.sections || []), ...(model?.elements || [])];
  const chosen = () => allElements(ctx.getModel()).filter(element => !element.deleted && ctx.getSelected().includes(element.id));
  const device = () => devices.includes(ctx.getDevice()) ? ctx.getDevice() : "desktop";
  function changeElements(fn, unlocking = false) {
    if (document.body.classList.contains("preview")) return;
    if(chosen().some(element => lockedBy(ctx.getModel(),element.id,!unlocking))){ctx.notice('عنصر یا ظرف والد قفل است؛ ابتدا قفل آن را باز کنید.');refresh();return false;}
    const ids = new Set(ctx.getSelected());
    const result = ctx.mutate(next => allElements(next).filter(element => ids.has(element.id) && !element.deleted).forEach(element => fn(element, next)));
    if (result === false) refresh();
    return result;
  }
  function selectMany(ids) { ids.forEach((id, index) => ctx.select(id, index > 0)); }
  function safely(fn) { try { fn(); } catch (error) { ctx.notice(error.message); refresh(); } }
  function store(element) { if (device() === "desktop") return element.style ||= {}; element.responsiveStyles ||= { tablet: {}, mobile: {} }; return element.responsiveStyles[device()] ||= {}; }
  function writeStyle(key, value) { return changeElements(element => { if (value === undefined) delete store(element)[key]; else store(element)[key] = value; }); }
  function copySelection() {
    const model = ctx.getModel(), ids = selectedRoots(model.elements, ctx.getSelected());
    if (chosen().some(element => (model.sections || []).some(section => section.id === element.id))) return ctx.notice("برای بخش اصلی، عناصر محتوای آن را انتخاب و کپی کنید یا یک بخش تازه از کتابخانه بیفزایید؛ ساختار وابستهٔ بخش اصلی حفظ می‌شود.");
    if (!ids.length) return ctx.notice("ابتدا عنصری را انتخاب کنید.");
    const included = subtreeIds(model.elements, ids);
    clipboard = { elements: copy(model.elements.filter(element => included.has(element.id))), ids, page: JSON.stringify(model.base || {}) };
    buttons.paste.disabled = false; ctx.notice("عناصر و فرزندان آن‌ها در حافظهٔ همین ویرایشگر کپی شدند.");
  }
  function pasteSelection() {
    if (!clipboard) return ctx.notice("ابتدا عناصر را در همین ویرایشگر کپی کنید.");
    const model = ctx.getModel();
    if (clipboard.page !== JSON.stringify(model.base || {})) return ctx.notice("برای حفظ ارتباط عناصر با صفحه، پس از عوض‌کردن صفحه دوباره کپی کنید.");
    const result = cloneSubtrees(clipboard.elements, clipboard.ids);
    if (model.elements.length + result.elements.length > 2000) throw new Error("تعداد عناصر این صفحه به سقف مجاز می‌رسد.");
    if (ctx.mutate(next => next.elements.push(...result.elements))) selectMany(result.ids);
    else ctx.notice("چسباندن با ساختار این صفحه سازگار نیست؛ تعداد عناصر، والد مقصد و عمق تو‌در‌تویی را بررسی کنید.");
  }
  buttons.copy.onclick = () => safely(copySelection); buttons.paste.onclick = () => safely(pasteSelection);
  buttons.lock.onclick = () => { const lock = !chosen().every(element => element.locked); changeElements(element => element.locked = lock, !lock); };
  buttons.hide.onclick = () => { const hide = !chosen().every(element => effectiveLayout(element, device()).hidden === true); changeElements(element => { element.layouts[device()] ||= {}; element.layouts[device()].hidden = hide; }); };
  for (const direction of ["front", "back"]) buttons[direction].onclick = () => safely(() => {
    const moved = new Map(moveLayer(allElements(ctx.getModel()), ctx.getSelected(), direction).map(element => [element.id, element.z]));
    ctx.mutate(next => { for (const element of allElements(next)) if (moved.has(element.id)) element.z = moved.get(element.id); });
  });
  buttons.group.onclick = () => safely(() => { const result = groupElements(ctx.getModel().elements, ctx.getSelected()); if (ctx.mutate(next => next.elements = result.elements)) ctx.select(result.id); else ctx.notice("این گروه با ساختار صفحه سازگار نیست؛ عمق تو‌در‌تویی و والد عناصر را بررسی کنید."); });
  buttons.ungroup.onclick = () => safely(() => { const result = ungroupElements(ctx.getModel().elements, ctx.getSelected()); if (ctx.mutate(next => next.elements = result.elements)) selectMany(result.ids); });
  mode.onchange = () => safely(() => {
    const elements = chosen();
    if (elements.some(element => element.source || element.locked)) throw new Error("تغییر روش چیدمان برای ساختار اصلی یا عنصر قفل‌شده مجاز نیست؛ ابتدا قفل را باز کنید یا از عنصر یک نسخهٔ تازه بسازید.");
    if (elements.some(element => lockedBy(ctx.getModel(), element.id))) throw new Error("عنصر یا ظرف والد قفل است؛ ابتدا قفل آن را باز کنید.");
    const boxes = new Map();
    for (const element of elements) {
      const node = ctx.getNode(element.id), unit = node?.closest("picture") || node;
      const bounds = unit?.getBoundingClientRect(), parent = unit?.parentElement?.getBoundingClientRect();
      if (bounds && parent?.width && parent.height) boxes.set(element.id, { x: rounded((bounds.left - parent.left) / parent.width * 100), y: rounded((bounds.top - parent.top) / parent.height * 100), width: rounded(bounds.width / parent.width * 100), height: rounded(bounds.height / parent.height * 100),pixelWidth:rounded(bounds.width),pixelHeight:rounded(bounds.height) });
    }
    const moved = switchLayoutMode(ctx.getModel().elements, ctx.getSelected(), mode.value, { device: device(), boxes });
    ctx.mutate(next => next.elements = moved);
  });
  alignGrid.addEventListener("click", event => { const button = event.target.closest("[data-pro-align]"); if (button) safely(() => { const elements = alignElements(ctx.getModel().elements, ctx.getSelected(), device(), button.dataset.proAlign); ctx.mutate(next => next.elements = elements); }); });
  panel.addEventListener("change", event => {
    const field = fields.find(field => field.input === event.target);
    if (!field) return;
    const { spec, input } = field;
    if (!input.checkValidity()) { input.reportValidity(); refresh(); return; }
    let value = input.value;
    if (value === "") value = undefined;
    else if (spec.type === "number") value = Number(value);
    else if (spec.key === "backgroundImage" && (!safeImage(value) || value.startsWith("data:"))) { ctx.notice("برای تصویر زمینه، آدرس یک تصویر معتبر PNG، JPEG یا WebP از کتابخانه را وارد کنید؛ برای بارگذاری دستگاه از عنصر تصویر استفاده کنید."); refresh(); return; }
    writeStyle(spec.key, value);
  });
  panel.addEventListener("click", event => { const button = event.target.closest("[data-pro-reset]"); if (button) writeStyle(button.dataset.proReset, undefined); });
  resetAll.onclick = () => changeElements(element => { if (device() === "desktop") element.style = {}; else { element.responsiveStyles ||= { tablet: {}, mobile: {} }; element.responsiveStyles[device()] = {}; } });
  ratio.onchange = () => safely(() => {
    if(ratio.value==='')return;
    const value=Number(ratio.value);
    changeElements(element=>{if(element.type==='image')store(element).aspectRatio=value;});ratio.value='';
  });
  function keyboard(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable || document.body.classList.contains("preview")) return;
    const key = event.key.toLowerCase();
    if (key === "c" && chosen().length) { event.preventDefault(); safely(copySelection); }
    if (key === "v" && clipboard) { event.preventDefault(); safely(pasteSelection); }
  }
  document.addEventListener("keydown", keyboard);

  const library = document.querySelector("#image-library");
  if (library && !document.querySelector("#pro-image-search")) {
    const search = elementNode(document, "input", { type: "search", id: "pro-image-search", placeholder: "جست‌وجوی تصویر در کتابخانه", "aria-label": "جست‌وجوی تصویر در کتابخانه" });
    library.before(search); search.oninput = () => { const query = search.value.trim().toLocaleLowerCase("fa"); for (const option of library.options) option.hidden = !!query && !`${option.textContent} ${option.value}`.toLocaleLowerCase("fa").includes(query); };
  }
  function computedValue(element, spec) {
    const node = ctx.getNode(element.id); if (!node?.ownerDocument?.defaultView) return "";
    const computed = node.ownerDocument.defaultView.getComputedStyle(node), raw = computed[spec.key];
    if (spec.type === "number") {
      if (spec.key === "focalX" || spec.key === "focalY") return 50;
      if (spec.key === "gridColumns") return "";
      if (spec.key === "lineHeight") { const size = parseFloat(computed.fontSize), height = parseFloat(raw); return size && height ? rounded(height / size) : ""; }
      const number = parseFloat(raw); return Number.isFinite(number) ? rounded(number) : "";
    }
    if (spec.type === "color") { if (/^#[0-9a-f]{6}$/i.test(raw)) return raw; const rgb = raw?.match(/[\d.]+/g); return rgb?.length >= 3 ? `#${rgb.slice(0, 3).map(value => Math.max(0, Math.min(255, Math.round(Number(value)))).toString(16).padStart(2, "0")).join("")}` : "#263329"; }
    return spec.type === "select" && spec.options.some(([value]) => value === raw) ? raw : "";
  }
  function refresh() {
    const model = ctx.getModel(); if (!model) return;
    const elements = chosen(), first = elements[0]; panel.hidden = !first;
    const frame = document.querySelector("#page");
    if (frame?.contentDocument && frame.contentDocument !== boundFrame) { boundFrame = frame.contentDocument; boundFrame.addEventListener("keydown", keyboard); }
    if (!first) return;
    const label = { desktop: "دسکتاپ", tablet: "تبلت", mobile: "موبایل" }[device()];
    deviceLabel.textContent = device() === "desktop" ? "دسکتاپ · ظاهر پایهٔ همهٔ اندازه‌ها" : `${label} · تنظیم‌های اختصاصی؛ ظاهر بدون تغییر از اندازهٔ بزرگ‌تر ارث می‌برد`;
    selectionNote.textContent = elements.length > 1 ? `تنظیم‌های ظاهر روی ${elements.length} عنصر انتخاب‌شده اعمال می‌شود.` : "هر تغییر قابل واگرد است. بازنشانی ↺ مقدار ارث‌برده‌شده را برمی‌گرداند.";
    mode.value = free(first) ? "free" : "flow";
    mode.disabled = elements.some(element => element.source || element.locked);
    modeAdvice.textContent = elements.some(element => element.source) ? "روش چیدمان ساختار اصلی حفظ می‌شود. برای ساخت آزادانه، عنصر را تکثیر کنید یا یک ظرف تازه بیفزایید." : "در حالت جریان، Grid/Flex جای عنصر را تعیین می‌کند؛ موقعیت و اندازهٔ آزاد برای بازگشت محفوظ می‌مانند. ابتدا فرزندان آزاد ظرف را به جریان برگردانید.";
    buttons.lock.textContent = elements.every(element => element.locked) ? "بازکردن قفل" : "قفل عنصر";
    buttons.lock.setAttribute("aria-pressed", elements.every(element => element.locked));
    const allHidden = elements.every(element => effectiveLayout(element, device()).hidden === true);
    buttons.hide.textContent = allHidden ? "نمایش در این اندازه" : "پنهان در این اندازه"; buttons.hide.setAttribute("aria-pressed", allHidden);
    buttons.paste.disabled = !clipboard;
    const style = inheritedStyle(first, device()), override = device() === "desktop" ? first.style || {} : first.responsiveStyles?.[device()] || {};
    for (const { spec, input, badge, reset } of fields) {
      input.disabled=elements.some(element=>lockedBy(model,element.id));
      const explicit = Object.hasOwn(override, spec.key), tablet = device() === "mobile" && Object.hasOwn(first.responsiveStyles?.tablet || {}, spec.key), inherited = device() !== "desktop" && Object.hasOwn(first.style || {}, spec.key);
      badge.textContent = explicit ? "اختصاصی" : tablet ? "از تبلت" : inherited ? "از دسکتاپ" : "پیش‌فرض سایت";
      badge.dataset.state = explicit ? "override" : "inherited";
      reset.disabled = input.disabled || !elements.some(element => Object.hasOwn(device() === "desktop" ? element.style || {} : element.responsiveStyles?.[device()] || {}, spec.key));
      if (document.activeElement !== input) input.value = style[spec.key] ?? computedValue(first, spec);
      input.classList.toggle("pro-value-inherited", !explicit);
    }
    for (const { group, details } of groups) details.hidden = group.image ? !elements.some(element => element.type === "image") : group.container ? !elements.some(element => element.type === "container" || element.type === "section") : group.text ? elements.every(element => element.type === "image" || element.type === "divider" || element.type === "spacer") : false;
    ratioLabel.hidden = !elements.every(element => element.type === "image");
    const warnings = [];
    if (style.fontSize != null && style.fontSize < 14) warnings.push("قلم کوچک ممکن است خوانایی موبایل را کاهش دهد.");
    if (style.opacity != null && style.opacity < .35) warnings.push("شفافیت کم ممکن است متن یا کنترل‌ها را ناخوانا کند.");
    if (style.minWidth && style.maxWidth && style.minWidth > style.maxWidth) warnings.push("کمینهٔ عرض از بیشینهٔ عرض بیشتر است؛ مرورگر کمینه را ترجیح می‌دهد.");
    if (style.letterSpacing && first.content?.text && /[\u0600-\u06ff]/.test(first.content.text)) warnings.push("فاصلهٔ حروف ممکن است پیوستگی نوشتار فارسی را تغییر دهد.");
    const selectedNode=ctx.getNode(first.id),unit=selectedNode?.closest('picture')||selectedNode;
    if(unit?.getClientRects().length){
      const bounds=unit.getBoundingClientRect(),parent=unit.parentElement?.getBoundingClientRect();
      if(parent&&((free(first)&&(bounds.left<parent.left-2||bounds.right>parent.right+2||bounds.top<parent.top-2||bounds.bottom>parent.bottom+2))||unit.scrollWidth>unit.clientWidth+2))warnings.push('محتوا از کادر بیرون زده است؛ موقعیت، عرض یا اندازهٔ قلم را در همین اندازه تنظیم کنید. حفظ طرح فعلی مجاز است.');
      if(free(first)){
        const overlapping=model.elements.find(other=>other.id!==first.id&&!other.deleted&&free(other)&&parentOf(other)===parentOf(first)&&(()=>{const node=ctx.getNode(other.id);if(!node?.getClientRects().length)return false;const r=node.getBoundingClientRect();return Math.min(bounds.right,r.right)-Math.max(bounds.left,r.left)>4&&Math.min(bounds.bottom,r.bottom)-Math.max(bounds.top,r.top)>4;})());
        if(overlapping)warnings.push('این عنصر با یک عنصر هم‌سطح هم‌پوشانی دارد؛ در صورت ناخواسته‌بودن، جابه‌جا یا تراز کنید. طرح شما خودکار تغییر نمی‌کند.');
      }
    }
    warning.textContent = warnings.join(" "); warning.hidden = !warnings.length;
  }
  ctx.onUpdate(refresh); refresh();
  return { refresh, copySelection, pasteSelection };
}
