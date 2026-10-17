import { parseHTML } from "linkedom";
import { describePage, pagePath, CMSFailure, SITE } from "./content.js";
import { validModel, clone } from "../public/admin/builder/model.js";
import { layoutCSS, isFree } from "../public/admin/builder/layout.js";
import { digest } from "./auth.js";
import { prepareImages } from "./builder-images.js";

// IDs depend on the original DOM location, never on editable text. Drafts are
// pinned to a base revision; a new base requires an explicit future migration.
function stableID(selector) {
  let value = 2166136261;
  for (const char of selector) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return `base-${(value >>> 0).toString(36)}`;
}

export function builderPage(html, revision, path = "public/index.html", editing = true) {
  pagePath(path);
  const { document } = parseHTML(html);
  const fields = describePage(html, path, revision).fields;
  let stored = {};
  const stateNode = document.querySelector("#builder-state");
  try { stored = stateNode ? JSON.parse(stateNode.textContent) : {}; } catch { throw new CMSFailure("داده چیدمان این صفحه نیاز به بررسی دارد."); }
  const elements = [];
  const anchors = [];
  if (!document.querySelector("main")) throw new CMSFailure("ساختار این صفحه با ویرایشگر سازگار نیست.",422);
  for (const [index, node] of [...document.querySelectorAll("header.site-header, main > section, main > article, main > header, main > div, footer")].entries()) {
    const id = node.getAttribute("data-builder-anchor") || `section-${node.id || index}`;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || anchors.some(a => a.id === id)) throw new CMSFailure("شناسه بخش تکراری یا نامعتبر است.",422);
    node.setAttribute("data-builder-anchor", id);
    anchors.push({ id, label: node.querySelector("h1,h2,h3")?.textContent || node.getAttribute("aria-label") || (node.localName === "header" ? "سربرگ" : node.localName === "footer" ? "پاورقی" : `بخش ${index}`) });
  }
  const groups = new Map();
  for (const field of fields.filter(f => ["text", "image"].includes(f.kind))) {
    if (!groups.has(field.selector)) groups.set(field.selector, []);
    groups.get(field.selector).push(field);
  }
  for (const [selector, entries] of groups) {
    const node = document.querySelector(selector);
    const anchor = node?.closest("[data-builder-anchor]");
    if (!node || !anchor || node.closest("svg, .skip-link")) continue;
    const id = node.getAttribute("data-builder-id") || stableID(selector);
    if (!/^(base-[a-z0-9]+|new-[a-zA-Z0-9-]+)$/.test(id)) throw new CMSFailure("شناسه عنصر معتبر نیست.",422);
    if (elements.some(el => el.id === id)) throw new Error("Duplicate builder ID");
    const image = entries.find(f => f.kind === "image");
    const type = image ? "image" : /^h[1-6]$/.test(node.localName) ? "heading" : node.localName === "a" ? "button" : "text";
    node.setAttribute("data-builder-id", id);
    if (image && node.closest("picture")) node.closest("picture").setAttribute("data-builder-unit",id);
    elements.push({
      id, type, tag: node.localName, anchor: anchor.getAttribute("data-builder-anchor"),
      source: { selector, textNodes: entries.filter(f => f.kind === "text").map(f => f.childIndex) },
      content: image ? { src: image.value, alt: image.alt } : {
        text: entries.map(f => f.value).join(" "), ...(node.localName === "a" ? { href: node.getAttribute("href") } : {}),
      },
      layouts: stored[id]?.layouts || { desktop: {}, mobile: {} }, style: stored[id]?.style || {}, z: stored[id]?.z ?? null, deleted: false,
      ...(stored[id]?.free != null ? {free:stored[id].free} : {}), ...(stored[id]?.order != null ? {order:stored[id].order} : {}),
    });
  }
  for (const e of elements) {
    const node = document.querySelector(`[data-builder-id="${e.id}"]`);
    e.movable = !node.querySelector("[data-builder-id]") && !node.matches("li,dt,dd,summary,td,th") && !node.closest(".product-card,.model-index,details,table");
  }
  const model = {schemaVersion:1,base:{path,revision,title:document.title,idVersion:1},elements};
  if (!anchors.length || !elements.length || !validModel(model,model,anchors)) throw new CMSFailure("ساختار این صفحه برای ویرایش ایمن پشتیبانی نمی‌شود.",422);
  if (!editing) return { document, anchors, model };
  document.querySelector("#builder-layout")?.remove();
  // The original HTML and stylesheet are retained. Executable content and remote
  // requests are removed from this editing copy only. The iframe also forbids scripts.
  for (const node of [...document.querySelectorAll("script, iframe, object, embed, noscript, base, form, meta[http-equiv], link[rel=preload], link[rel=manifest]")]) node.remove();
  for (const node of document.querySelectorAll("*")) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || ["srcdoc", "formaction"].includes(attr.name)) node.removeAttribute(attr.name);
      if (["src", "srcset", "href"].includes(attr.name) && /^(?:https?:)?\/\//i.test(attr.value) && node.localName !== "a") node.removeAttribute(attr.name);
    }
  }
  const base = document.createElement("base");
  base.setAttribute("href", "/");
  document.head.prepend(base);
  const style = document.createElement("style");
  style.textContent = `html{scroll-behavior:auto!important}body{overflow-x:clip}.reveal{opacity:1!important;transform:none!important}[data-builder-id]{touch-action:none}[data-builder-added]{margin:0;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere}[data-builder-added][data-builder-type=button]{display:flex;align-items:center;justify-content:center;background:#ba9555;color:white;padding:12px;border-radius:6px;text-decoration:none}[data-builder-added][data-builder-type=image]{object-fit:cover}*{animation:none!important;transition:none!important}body:has([data-builder-editing]){user-select:none}[data-builder-editing]{outline:2px solid #3b82f6!important;outline-offset:3px}[data-builder-drop]{outline:3px dashed #22a65b!important;outline-offset:-4px} [data-builder-preview] [data-builder-id]{touch-action:auto}`;
  document.head.append(style);
  return { html: document.toString(), anchors, model, receipt:{requestId:document.querySelector('meta[name="builder-request"]')?.getAttribute("content") || null} };
}

function metadata(document, name, value) {
  let node = document.querySelector(`meta[name="${name}"]`);
  if (!node) { node = document.createElement("meta"); node.setAttribute("name",name); document.head.append(node); }
  node.setAttribute("content",value);
}
function replaceSchema(document, before, after) {
  if (!before || before === after) return;
  const visit = v => typeof v === "string" ? v === before ? after : v : Array.isArray(v) ? v.map(visit) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,value]) => [k,visit(value)])) : v;
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { node.textContent = JSON.stringify(visit(JSON.parse(node.textContent))).replace(/</g,"\\u003c"); } catch { throw new CMSFailure("داده ساختاریافته صفحه معتبر نیست."); }
  }
}
function changePicture(document, node, e, original) {
  node.setAttribute("alt",e.content.alt);
  if (original && original.content.src === e.content.src) return;
  const src = e.content.src, width = e.content.width, height = e.content.height;
  node.setAttribute("src",src); node.setAttribute("width",width); node.setAttribute("height",height);
  const variants = [...(e.content.variants || []),{src,width,height}].sort((a,b) => a.width-b.width);
  const srcset = [...new Map(variants.map(v => [v.width,v])).values()].map(v => `${v.src} ${v.width}w`).join(", ");
  const old = original?.content.src;
  const lcp = node.getAttribute("fetchpriority") === "high" || node.classList.contains("hero-media") || e.anchor === "section-1" && !original;
  const sizes = node.getAttribute("sizes") || (lcp ? "100vw" : "(max-width:640px) 100vw, 50vw");
  node.setAttribute("srcset",srcset); node.setAttribute("sizes",sizes);
  if (lcp) { node.setAttribute("fetchpriority","high"); node.setAttribute("loading","eager"); }
  else { node.setAttribute("loading","lazy"); node.setAttribute("decoding","async"); }
  for (const source of node.closest("picture")?.querySelectorAll("source") || []) { source.removeAttribute("type"); source.setAttribute("srcset",srcset); source.setAttribute("sizes",sizes); }
  for (const preload of document.querySelectorAll('link[rel="preload"][as="image"]')) if (old && preload.getAttribute("href") === old) { preload.setAttribute("href",src); preload.setAttribute("imagesrcset",srcset); preload.setAttribute("imagesizes",sizes); }
  for (const meta of document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) if (old && [old,SITE+old].includes(meta.getAttribute("content"))) meta.setAttribute("content",SITE+src);
  if (old) { replaceSchema(document,old,src); replaceSchema(document,SITE+old,SITE+src); }
}

export async function publishBuilder(repo, body, user, localMode) {
  const path = pagePath(body?.model?.base?.path);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || "")) throw new CMSFailure("شناسه درخواست انتشار معتبر نیست.");
  const head = await repo.head(), file = await repo.read(path,head);
  const fingerprint = await digest(JSON.stringify(body.model));
  // This receipt makes a lost-response retry idempotent without a second commit.
  const receipt = parseHTML(file.content).document;
  if (receipt.querySelector('meta[name="builder-request"]')?.getAttribute("content") === body.requestId) {
    if (receipt.querySelector('meta[name="builder-fingerprint"]')?.getAttribute("content") !== fingerprint) throw new CMSFailure("شناسه درخواست برای محتوای دیگری استفاده شده است.",409);
    return {mode:localMode?"local":"github",sha:head,path,revision:file.sha,replayed:true,publication:{commit:localMode?"local":"committed",deployment:localMode?"not_applicable":"unknown"}};
  }
  if (file.sha !== body.model.base.revision) throw new CMSFailure("نسخه صفحه تغییر کرده است؛ پیش‌نویس محفوظ است. نسخه جدید را بررسی کنید.",409);
  const restore = body.model.base.restoreCommit;
  if (restore && !/^[a-f0-9]{40}$/.test(restore)) throw new CMSFailure("نسخه بازگردانی معتبر نیست.");
  const source = restore ? await repo.read(path,restore) : file;
  const base = builderPage(source.content,file.sha,path,false);
  if (restore) base.model.base.restoreCommit = restore;
  if (!validModel(body.model,base.model,base.anchors)) throw new CMSFailure("مدل صفحه یا جابه‌جایی عناصر معتبر نیست.");
  const model = clone(body.model), original = new Map(base.model.elements.map(e => [e.id,e]));
  for (const e of model.elements) e.imageChanged = e.type === "image" && e.content.src !== original.get(e.id)?.content.src;
  const tree = await repo.tree(head);
  const imageChanges = await prepareImages(model,tree,repo,head);
  const document = base.document, nodes = new Map(base.model.elements.map(e => [e.id,document.querySelector(`[data-builder-id="${e.id}"]`)]));
  for (const e of model.elements) {
    let node = nodes.get(e.id);
    if (!node && !e.deleted) { node = document.createElement(({text:"p",heading:"h2",button:"a",image:"img"})[e.type]); node.setAttribute("data-builder-id",e.id); node.setAttribute("data-builder-created",""); node.setAttribute("data-builder-type",e.type); nodes.set(e.id,node); }
    if (!node) continue;
    const unit = node.closest("picture") || node;
    if (e.deleted) { unit.remove(); continue; }
    if (e.type === "image") changePicture(document,node,e,original.get(e.id));
    else if (e.source) e.source.textNodes.forEach((index,i) => { const text = node.childNodes[index]; if (text?.nodeType === 3) text.textContent = i ? "" : e.content.text; });
    else node.textContent = e.content.text;
    if (e.content.href != null) node.setAttribute("href",e.content.href);
    if (isFree(e)) { const anchor = document.querySelector(`[data-builder-anchor="${e.anchor}"]`); anchor.append(unit); }
    if (e.type !== "image" && original.get(e.id)) replaceSchema(document,original.get(e.id).content.text,e.content.text);
    if (e.z != null || Object.values(e.layouts).some(l => Object.keys(l).length)) unit.setAttribute("data-builder-geometry","");
  }
  for (const anchor of base.anchors) for (const e of model.elements.filter(e => !e.deleted && isFree(e) && e.anchor === anchor.id).sort((a,b)=>(a.order||0)-(b.order||0))) {
    const node = nodes.get(e.id); document.querySelector(`[data-builder-anchor="${anchor.id}"]`).append(node.closest("picture") || node);
  }
  if (document.querySelectorAll("main h1").length !== 1) throw new CMSFailure("صفحه باید دقیقاً یک عنوان اصلی H1 داشته باشد.");
  document.querySelector("#builder-layout")?.remove(); document.querySelector("#builder-state")?.remove();
  const style = document.createElement("style"); style.id = "builder-layout"; style.textContent = layoutCSS(model.elements); document.head.append(style);
  const state = document.createElement("script"); state.id = "builder-state"; state.type = "application/json";
  state.textContent = JSON.stringify(Object.fromEntries(model.elements.filter(e => !e.deleted).map(e => [e.id,{layouts:e.layouts,style:e.style,z:e.z,free:isFree(e),order:e.order||0}]))).replace(/</g,"\\u003c"); document.head.append(state);
  if (!document.querySelector('script[src="/builder-layout.js"]')) { const runtime = document.createElement("script"); runtime.src = "/builder-layout.js"; runtime.setAttribute("defer",""); document.head.append(runtime); }
  metadata(document,"builder-request",body.requestId); metadata(document,"builder-fingerprint",fingerprint);
  const html = document.toString();
  const changes = [{path,content:html},...imageChanges];
  if (tree.some(entry => entry.path === "public/sitemap.xml")) {
    const sitemap = await repo.read("public/sitemap.xml",head), route = "/"+path.slice(7).replace(/index\.html$/,"");
    const location = (SITE+route).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const updated = sitemap.content.replace(new RegExp(`(<loc>${location}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`),`$1${new Date().toISOString().slice(0,10)}$2`);
    if (updated !== sitemap.content) changes.push({path:"public/sitemap.xml",content:updated});
  }
  const result = await repo.commit(head,changes,`content: visual builder ${path.slice(7)} (${user.username})`);
  // Never fetch the branch again here: another writer may already have advanced it.
  return {...result,path,publication:{commit:localMode?"local":"committed",deployment:localMode?"not_applicable":"unknown"}};
}
