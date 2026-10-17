export const HISTORY_LIMIT = 120;
export const clone = value => JSON.parse(JSON.stringify(value));
export const emptyLayout = () => ({ desktop: {}, mobile: {} });
export function safeLink(value) {
  return typeof value === "string" && value.length <= 2000 && !/[\u0000-\u0020\\]/.test(value) && /^(?:\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(value);
}
export function safeImage(value) {
  return typeof value === "string" && value.length < 3_000_000 && (
    (/^\/assets(?:-v[23])?\/[a-zA-Z0-9_./-]+\.(webp|png|jpe?g)$/i.test(value) && !value.includes("..")) ||
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
export class History {
  constructor(model, saved) {
    this.present = clone(model);
    this.past = saved?.past?.slice(-HISTORY_LIMIT).map(clone) || [];
    this.future = saved?.future?.slice(-HISTORY_LIMIT).map(clone) || [];
  }
  commit(model) {
    if (JSON.stringify(model) === JSON.stringify(this.present)) return false;
    this.past.push(this.present);
    this.past = this.past.slice(-HISTORY_LIMIT);
    this.present = clone(model);
    this.future = [];
    return true;
  }
  undo() {
    if (!this.past.length) return false;
    this.future.push(this.present);
    this.present = this.past.pop();
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(this.present);
    this.present = this.future.pop();
    return true;
  }
  serialize() { return { present: this.present, past: this.past, future: this.future }; }
}

// Stored JSON is untrusted. Never interpret it as HTML, CSS or a selector.
export function validModel(model, baseModel, anchors) {
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  if (!model || model.schemaVersion !== 1 || JSON.stringify(model.base) !== JSON.stringify(baseModel.base) || !Array.isArray(model.elements) || model.elements.length > 2000) return false;
  const original = new Map(baseModel.elements.map(e => [e.id, e]));
  const ids = new Set();
  for (const e of model.elements) {
    if (!e || typeof e.id !== "string" || !/^(base-[a-z0-9]+|new-[a-zA-Z0-9-]+)$/.test(e.id) || ids.has(e.id)) return false;
    ids.add(e.id);
    if (!["text", "heading", "image", "button"].includes(e.type) || !anchors.some(a => a.id === e.anchor) || typeof e.deleted !== "boolean") return false;
    const orig = original.get(e.id);
    if (orig && (e.type !== orig.type || JSON.stringify(e.source) !== JSON.stringify(orig.source) || e.tag !== orig.tag)) return false;
    if (e.id.startsWith("base-") && !orig) return false;
    if (orig && e.anchor !== orig.anchor && (orig.movable === false || e.free !== true)) return false;
    if (orig?.movable === false && e.free === true && orig.free !== true) return false;
    if (!orig && e.source != null) return false;
    if (e.free != null && typeof e.free !== "boolean") return false;
    if (e.order != null && (!Number.isInteger(e.order) || e.order < 0 || e.order > 10000)) return false;
    if (!record(e.content) || (e.type === "image" ? !safeImage(e.content.src) || typeof e.content.alt !== "string" || e.content.alt.length > 2000 : typeof e.content.text !== "string" || e.content.text.length > 12000)) return false;
    if (e.content.variants != null && (!Array.isArray(e.content.variants) || e.content.variants.length > 3 || e.content.variants.some(v => !record(v) || !safeImage(v.src) || !Number.isInteger(v.width) || v.width < 1 || v.width > 8000 || !Number.isInteger(v.height) || v.height < 1 || v.height > 8000))) return false;
    for (const dimension of ["width", "height"]) if (e.content[dimension] != null && (!Number.isInteger(e.content[dimension]) || e.content[dimension] < 1 || e.content[dimension] > 8000)) return false;
    if (e.content.href != null && !safeLink(e.content.href)) return false;
    if (!record(e.layouts) || !record(e.style) || (e.z !== null && (!Number.isInteger(e.z) || Math.abs(e.z) > 10000))) return false;
    if (Object.keys(e.layouts).some(k => !["desktop", "mobile"].includes(k))) return false;
    for (const device of ["desktop", "mobile"]) {
      const layout = e.layouts[device];
      if (!record(layout) || Object.keys(layout).some(k => !["x", "y", "width", "height"].includes(k))) return false;
      for (const [key, val] of Object.entries(layout)) if (typeof val !== "number" || !Number.isFinite(val) || (key === "width" || key === "height" ? val < .1 || val > 300 : Math.abs(val) > 500)) return false;
    }
    for (const [key, val] of Object.entries(e.style)) {
      if (key === "fontSize") { if (!Number.isFinite(val) || val < 8 || val > 200) return false; }
      else if (key === "color") { if (!/^#[0-9a-f]{6}$/i.test(val)) return false; }
      else if (key === "textAlign") { if (!["start", "center", "end"].includes(val)) return false; }
      else return false;
    }
  }
  return [...original.keys()].every(id => ids.has(id));
}

export function decodeDraft(raw, base, anchors) {
  if (!raw || raw.length > 20_000_000) throw new Error("پیش‌نویس معتبر نیست یا بیش از حد بزرگ است.");
  const saved = JSON.parse(raw);
  if (saved.assets) {
    for (const model of [saved.history?.present, ...(saved.history?.past || []), ...(saved.history?.future || [])]) {
      for (const element of model?.elements || []) {
        const src = element.content?.src;
        if (typeof src === "string" && src.startsWith("asset:")) element.content.src = saved.assets[src.slice(6)];
        for (const variant of element.content?.variants || []) if (variant.src?.startsWith("asset:")) variant.src = saved.assets[variant.src.slice(6)];
      }
    }
  }
  if (saved.version !== 1 || !saved.history || !Array.isArray(saved.history.past) || !Array.isArray(saved.history.future) || saved.history.past.length > HISTORY_LIMIT || saved.history.future.length > HISTORY_LIMIT) throw new Error("ساختار پیش‌نویس پشتیبانی نمی‌شود.");
  if (![saved.history.present, ...saved.history.past, ...saved.history.future].every(m => validModel(m, base, anchors))) throw new Error("پیش‌نویس با نسخه فعلی صفحه سازگار نیست؛ فایل پشتیبان را نگه دارید.");
  return new History(saved.history.present, saved.history);
}

export function encodeDraft(history) {
  const data = { version: 1, savedAt: new Date().toISOString(), history: clone(history.serialize()), assets: {} };
  const assets = new Map();
  for (const model of [data.history.present, ...data.history.past, ...data.history.future]) {
    for (const element of model.elements) {
      for (const content of [element.content, ...(element.content.variants || [])]) {
        const src = content.src;
        if (!src?.startsWith("data:")) continue;
        if (!assets.has(src)) assets.set(src, `image-${assets.size}`);
        const id = assets.get(src);
        data.assets[id] = src;
        content.src = `asset:${id}`;
      }
    }
  }
  return JSON.stringify(data);
}
