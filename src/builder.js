import { parseHTML } from "linkedom";
import { describePage, pagePath, CMSFailure, SITE } from "./content.js";
import { validModel, clone, migrateModel, stablePageID, emptyLayout } from "../public/admin/builder/model.js";
import { layoutCSS, isFree } from "../public/admin/builder/layout.js";
import { renderBlockNode } from "../public/admin/builder/blocks.js";
import { readPageMetadata, applyPageSEO, newPageSource, publicationChanges } from "./pages.js";
import { digest } from "./auth.js";
import { prepareImages } from "./builder-images.js";
import { requiredUnlocks } from "../public/admin/builder/locks.js";
import {stableElementID,isElementID} from '../public/admin/builder/identity.js';
import {enforceContentPermission,assertPageAccess,assertPageCreation} from './cms-permissions.js';
import {publishedIdentity} from './html-identity.js';

// IDs depend on the original DOM location, never on editable text. Drafts are
// pinned to a base revision; a new base requires an explicit future migration.
const stableID = stableElementID;

export function builderPage(html, revision, path = "public/index.html", editing = true) {
  pagePath(path);
  const { document } = parseHTML(html);
  const identity=publishedIdentity(document);
  const fields = describePage(html, path, revision).fields;
  let stored = {};
  const stateNode = document.querySelector("#builder-state");
  try { stored = stateNode ? JSON.parse(stateNode.textContent) : {}; } catch { throw new CMSFailure("داده چیدمان این صفحه نیاز به بررسی دارد."); }
  const storedNodes = new Map((stored.schemaVersion === 2 ? stored.elements || [] : []).map(e=>[e.id,e]));
  const settings = id => storedNodes.get(id) || stored[id] || {};
  const elements = [];
  // Navigation updates may insert a new node at a selector previously occupied
  // by another persisted element. Preserve all existing IDs before assigning a
  // deterministic fresh ID to such new original nodes.
  const reservedIDs=new Set(identity.reserved),reservedAnchors=new Set(identity.anchors.keys());
  const anchors = [];
  if (!document.querySelector("main")) throw new CMSFailure("ساختار این صفحه با ویرایشگر سازگار نیست.",422);
  for (const [index, node] of [...document.querySelectorAll("header.site-header, main > section, main > article, main > header, main > div, footer")].entries()) {
    let id = node.getAttribute("data-builder-anchor");
    if(!id){const preferred=`section-${node.id || index}`;id=preferred;let attempt=0;while(reservedAnchors.has(id)||reservedIDs.has(id))id=`${preferred}-${++attempt}`;reservedAnchors.add(id);}
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || anchors.some(a => a.id === id)) throw new CMSFailure("شناسه بخش تکراری یا نامعتبر است.",422);
    node.setAttribute("data-builder-anchor", id);
    anchors.push({ id, label: node.querySelector("h1,h2,h3")?.textContent || node.getAttribute("aria-label") || (node.localName === "header" ? "سربرگ" : node.localName === "footer" ? "پاورقی" : `بخش ${index}`), generated:storedNodes.get(id)?.source === null, protected:node.matches('header.site-header,footer') });
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
    let id = node.getAttribute("data-builder-id");
    if(!id){let attempt=0;id=stableID(selector);while(reservedIDs.has(id))id=stableID(`${selector}#${++attempt}`);reservedIDs.add(id);}
    if(storedNodes.has(id) && !storedNodes.get(id).source)continue;
    if (!isElementID(id)) throw new CMSFailure("شناسه عنصر معتبر نیست.",422);
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
      layouts: settings(id).layouts || { desktop: {}, mobile: {} }, style: settings(id).style || {}, z: settings(id).z ?? null, deleted: false,
      ...(settings(id).free != null ? {free:settings(id).free} : {}), ...(settings(id).order != null ? {order:settings(id).order} : {}),
    });
  }
  for (const e of elements) {
    const node = document.querySelector(`[data-builder-id="${e.id}"]`);
    e.movable = !node.querySelector("[data-builder-id]") && !node.matches("li,dt,dd,summary,td,th") && !node.closest(".product-card,.model-index,details,table");
  }
  const model = migrateModel({schemaVersion:1,base:{path,revision,title:document.title,idVersion:1},elements},null,anchors.filter(a=>!a.generated));
  model.page = {...readPageMetadata(document,path),id:document.querySelector('meta[name="builder-page-id"]')?.getAttribute('content') || stored.page?.id || stablePageID(path)};
  model.sections = anchors.filter(a=>!a.generated).map((a,i)=>({id:a.id,label:a.label,type:'container',kind:'section',tag:'section',content:{text:a.label},parentId:'page',order:i,deleted:false,locked:false,layoutMode:'flow',layouts:emptyLayout(),style:{},responsiveStyles:{tablet:{},mobile:{}},...(stored.sections?.find(s=>s.id===a.id)||{}),source:{anchor:a.id},protected:a.protected}));
  for(const e of model.elements){const s=storedNodes.get(e.id);if(s)for(const key of ['parentId','layoutMode','responsiveStyles','responsiveInheritance','locked','freeLayouts'])if(s[key]!=null)e[key]=clone(s[key]);}
  for(const entry of storedNodes.values())if(!entry.source){
    if(!/^new-[a-zA-Z0-9-]+$/.test(entry.id))throw new CMSFailure('شناسه بلوک ذخیره‌شده معتبر نیست.');
    const node=document.querySelector(`[data-builder-id="${entry.id}"]`);if(!node)throw new CMSFailure('بلوک ذخیره‌شده در HTML پیدا نشد؛ داده حذف نشده است.',422);
    const e=clone(entry);e.deleted=false;e.source=null;
    if(['text','heading','button'].includes(e.type)&&node.textContent!==e.content.text){e.content.text=node.textContent;delete e.content.runs;}
    if(e.type==='image'){e.content.src=node.getAttribute('src');e.content.alt=node.getAttribute('alt')||'';}
    if(e.content.href!=null&&node.hasAttribute('href'))e.content.href=node.getAttribute('href');
    model.elements.push(e);
  }
  model.warningsDismissed=stored.warningsDismissed || [];
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
  style.textContent = `html{scroll-behavior:auto!important}body{overflow-x:clip}.reveal{opacity:1!important;transform:none!important}[data-builder-id]{touch-action:auto}[data-builder-created][data-builder-type=spacer]{pointer-events:auto!important}[data-builder-added]{margin:0;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere}[data-builder-added][data-builder-type=button]{display:flex;align-items:center;justify-content:center;background:#ba9555;color:white;padding:12px;border-radius:6px;text-decoration:none}[data-builder-added][data-builder-type=image]{object-fit:cover}*{animation:none!important;transition:none!important}body:has([data-builder-editing]){user-select:none}[data-builder-editing]{outline:2px solid #3b82f6!important;outline-offset:3px}[data-builder-drop]{outline:3px dashed #22a65b!important;outline-offset:-4px} [data-builder-preview] [data-builder-id]{touch-action:auto}`;
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
function changePicture(document, node, e, original, preferredLCP=false) {
  node.setAttribute("alt",e.content.alt);
  if (original && original.content.src === e.content.src) return;
  const src = e.content.src, width = e.content.width, height = e.content.height;
  node.setAttribute("src",src); node.setAttribute("width",width); node.setAttribute("height",height);
  const variants = [...(e.content.variants || []),{src,width,height}].sort((a,b) => a.width-b.width);
  const srcset = [...new Map(variants.map(v => [v.width,v])).values()].map(v => `${v.src} ${v.width}w`).join(", ");
  const old = original?.content.src;
  const lcp = node.getAttribute("fetchpriority") === "high" || node.classList.contains("hero-media") || preferredLCP;
  const sizes = node.getAttribute("sizes") || (lcp ? "100vw" : "(max-width:640px) 100vw, 50vw");
  node.setAttribute("srcset",srcset); node.setAttribute("sizes",sizes);
  if (lcp) { node.setAttribute("fetchpriority","high"); node.setAttribute("loading","eager"); }
  else { node.setAttribute("loading","lazy"); node.setAttribute("decoding","async"); }
  for (const source of node.closest("picture")?.querySelectorAll("source") || []) { source.removeAttribute("type"); source.setAttribute("srcset",srcset); source.setAttribute("sizes",sizes); }
  for (const preload of document.querySelectorAll('link[rel="preload"][as="image"]')) if (old && preload.getAttribute("href") === old) { preload.setAttribute("href",src); preload.setAttribute("imagesrcset",srcset); preload.setAttribute("imagesizes",sizes); }
  for (const meta of document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) if (old && [old,SITE+old].includes(meta.getAttribute("content"))) meta.setAttribute("content",SITE+src);
  if (old) { replaceSchema(document,old,src); replaceSchema(document,SITE+old,SITE+src); }
}

function validatePublishedLocks(previous,next,unlockIds) {
  // Locks are editing affordances, not role permissions. The server can enforce
  // persisted locks; a false flag explicitly unlocks a previously locked owner.
  // Draft-only locks remain editor affordances. An explicit intent permits the
  // legitimate unlock/edit/relock workflow without an intermediate publication.
  const owners=new Set([...previous.sections,...previous.elements].filter(e=>e.locked===true).map(e=>e.id));
  if(unlockIds.some(id=>!owners.has(id)))throw new CMSFailure('شناسه بازکردن قفل با نسخه پایه منتشرشده هماهنگ نیست.');
  if(requiredUnlocks(previous,next).some(id=>!unlockIds.includes(id)))throw new CMSFailure('عنصر یا ظرف والد در نسخه منتشرشده قفل است؛ بازکردن قفل را صریحاً تأیید کنید.');
}

export async function publishBuilder(repo, body, user, localMode) {
  const path = pagePath(body?.model?.base?.path);
  assertPageAccess(user,path);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || "")) throw new CMSFailure("شناسه درخواست انتشار معتبر نیست.");
  const unlockIds=body.unlockIds??[];
  if(user.role!=='admin'&&unlockIds.length)throw new CMSFailure('بازکردن قفل فقط برای مدیر مجاز است.',403);
  if(!Array.isArray(unlockIds)||unlockIds.length>2200||unlockIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))||new Set(unlockIds).size!==unlockIds.length)throw new CMSFailure('اطلاعات تأیید بازکردن قفل معتبر نیست.');
  const head = await repo.head();
  let file, creating=false;
  try { file=await repo.read(path,head); }
  catch(error){if(error.status!==404||!body.model.base.creation)throw error;assertPageCreation(user,path,body.model.base.creation);file=await newPageSource(repo,body.model,head);creating=true;}
  const fingerprint = await digest(JSON.stringify(unlockIds.length?{model:body.model,unlockIds:[...unlockIds].sort()}:body.model));
  // This receipt makes a lost-response retry idempotent without a second commit.
  const receipt = parseHTML(file.content).document;
  if (receipt.querySelector('meta[name="builder-request"]')?.getAttribute("content") === body.requestId) {
    if(user.role!=='admin'&&receipt.querySelector('meta[name="builder-author"]')?.getAttribute('content')!==await digest(`${user.username}:${user.role}`))throw new CMSFailure('رسید انتشار متعلق به این دسترسی نیست.',403);
    if (receipt.querySelector('meta[name="builder-fingerprint"]')?.getAttribute("content") !== fingerprint) throw new CMSFailure("شناسه درخواست برای محتوای دیگری استفاده شده است.",409);
    return {mode:localMode?"local":"github",sha:head,path,revision:file.sha,replayed:true,publication:{commit:localMode?"local":"committed",deployment:localMode?"not_applicable":"unknown"}};
  }
  // A creation descriptor can only authorize a vacant generated route. Accepting
  // one on an existing page would turn a protected original into a managed page.
  if(body.model.base.creation&&!creating)throw new CMSFailure('این مسیر هم‌اکنون وجود دارد؛ اطلاعات ساخت صفحه نمی‌تواند آن را بازنویسی کند.',409);
  if (file.sha !== body.model.base.revision) throw new CMSFailure("نسخه صفحه تغییر کرده است؛ پیش‌نویس محفوظ است. نسخه جدید را بررسی کنید.",409);
  const restore = body.model.base.restoreCommit;
  if (restore && !(localMode?/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/:/^[a-f0-9]{40}$/).test(restore)) throw new CMSFailure("نسخه بازگردانی معتبر نیست.");
  const source = restore ? await repo.read(path,restore) : file;
  const base = builderPage(source.content,file.sha,path,false);
  if (restore) base.model.base.restoreCommit = restore;
  if(body.model.base.creation){base.model.base.creation=clone(body.model.base.creation);base.model.page=clone(body.model.base.creation.page);}
  const model=migrateModel(body.model,base.model,base.anchors);
  if (!validModel(model,base.model,base.anchors)) throw new CMSFailure("مدل صفحه، سبک یا ساختار والدها معتبر نیست؛ پیش‌نویس محفوظ است.");
  enforceContentPermission(user,restore?builderPage(file.content,file.sha,path,false).model:base.model,model);
  validatePublishedLocks(base.model,model,unlockIds);
  const original = new Map(base.model.elements.map(e => [e.id,e]));
  for (const e of model.elements) e.imageChanged = e.type === "image" && ['src','width','height','variants'].some(key=>JSON.stringify(e.content[key])!==JSON.stringify(original.get(e.id)?.content[key]));
  const tree = await repo.tree(head);
  const available=new Set(tree.map(e=>e.path));
  for(const e of [...model.sections,...model.elements])for(const style of [e.style,...Object.values(e.responsiveStyles||{})])if(style.backgroundImage&&!available.has('public'+style.backgroundImage))throw new CMSFailure('تصویر پس‌زمینه در کتابخانه موجود نیست.');
  const imageChanges = await prepareImages(model,tree,repo,head);
  const document = base.document, nodes = new Map(base.model.elements.map(e => [e.id,document.querySelector(`[data-builder-id="${e.id}"]`)]));
  const all=new Map([...model.sections,...model.elements].map(e=>[e.id,e]));
  const alive=e=>{if(e.deleted)return false;let p=e.parentId;while(p&&p!=='page'){const parent=all.get(p);if(parent?.deleted)return false;p=parent?.parentId;}return true;};
  const mainImages=model.elements.filter(e=>e.type==='image'&&alive(e)&&!model.sections.some(s=>s.id===e.anchor&&s.protected));
  const existingLCP=mainImages.find(e=>{const n=nodes.get(e.id);return e.source&&(n?.getAttribute('fetchpriority')==='high'||n?.classList.contains('hero-media'));});
  const inHero=e=>{let p=e.parentId;while(p&&p!=='page'){const parent=all.get(p);if(parent?.kind==='hero')return true;p=parent?.parentId;}return false;};
  const preferredLCP=(existingLCP||mainImages.find(inHero)||mainImages[0])?.id;
  const parentFor=e=>e.parentId==='page'?document.querySelector('main'):nodes.get(e.parentId)||document.querySelector(`[data-builder-anchor="${e.parentId||e.anchor}"]`);
  // Protection comes from the trusted original DOM, never the imported model.
  const protectedSections=new Set(base.model.sections.filter(s=>s.protected).map(s=>s.id));
  for(const s of model.sections){if(protectedSections.has(s.id))continue;const n=document.querySelector(`[data-builder-anchor="${s.id}"]`);if(s.deleted)n?.remove();else if(n)document.querySelector('main').append(n);}
  for(const s of [...model.sections].filter(s=>!s.deleted&&!protectedSections.has(s.id)).sort((a,b)=>a.order-b.order)){const n=document.querySelector(`[data-builder-anchor="${s.id}"]`);if(n)document.querySelector('main').append(n);}
  for (const e of model.elements) {
    let node = nodes.get(e.id);
    if (!node && alive(e)) { node=renderBlockNode(document,e);nodes.set(e.id,node); }
    if (!node) continue;
    const unit = node.closest("picture") || node;
    if (!alive(e)) { unit.remove(); continue; }
    if (e.type === "image") {
      changePicture(document,node,e,original.get(e.id),e.id===preferredLCP);
      if(!e.source){node.setAttribute('loading',e.id===preferredLCP?'eager':'lazy');if(e.id===preferredLCP)node.setAttribute('fetchpriority','high');else node.removeAttribute('fetchpriority');}
    }
    else if (e.source) e.source.textNodes.forEach((index,i) => { const text = node.childNodes[index]; if (text?.nodeType === 3) text.textContent = i ? "" : e.content.text; });
    else if(['text','heading','button'].includes(e.type)){const replacement=renderBlockNode(document,e);node.replaceChildren(...replacement.childNodes);}
    if (e.content.href != null) node.setAttribute("href",e.content.href);
    unit.setAttribute('data-builder-parent',e.parentId||e.anchor);
    if(e.type==='container'&&e.parentId==='page')node.setAttribute('data-builder-anchor',e.id);
    if (e.type !== "image" && original.get(e.id)) replaceSchema(document,original.get(e.id).content.text,e.content.text);
    if (e.z != null || Object.values(e.layouts).some(l => Object.keys(l).length)) unit.setAttribute("data-builder-geometry","");
  }
  for(const e of model.elements.filter(alive).sort((a,b)=>(a.order||0)-(b.order||0))){
    const node=nodes.get(e.id),orig=original.get(e.id);
    if(!e.source||isFree(e)||e.parentId!==orig?.parentId)parentFor(e).append(node.closest('picture')||node);
  }
  if (document.querySelectorAll("main h1").length !== 1) throw new CMSFailure("صفحه باید دقیقاً یک عنوان اصلی H1 داشته باشد.");
  document.querySelector("#builder-layout")?.remove(); document.querySelector("#builder-state")?.remove();
  if(JSON.stringify(model.page)!==JSON.stringify(base.model.page)||model.base.creation)applyPageSEO(document,model);
  const style = document.createElement("style"); style.id = "builder-layout"; style.textContent = layoutCSS([...model.sections,...model.elements]); document.head.append(style);
  const state = document.createElement("script"); state.id = "builder-state"; state.type = "application/json";
  state.textContent = JSON.stringify({schemaVersion:2,page:model.page,sections:model.sections.filter(e=>!e.deleted),elements:model.elements.filter(alive).map(e=>({...e,source:e.source||null})),warningsDismissed:model.warningsDismissed}).replace(/</g,"\\u003c"); document.head.append(state);
  if (!document.querySelector('script[src="/builder-layout.js"]')) { const runtime = document.createElement("script"); runtime.src = "/builder-layout.js"; runtime.setAttribute("defer",""); document.head.append(runtime); }
  if(model.elements.some(e=>alive(e)&&e.kind==='gallery')&&!document.querySelector('script[src="/builder-blocks.js"]')){const script=document.createElement('script');script.src='/builder-blocks.js';script.setAttribute('defer','');document.head.append(script);}
  metadata(document,"builder-request",body.requestId); metadata(document,"builder-fingerprint",fingerprint);
  metadata(document,'builder-author',await digest(`${user.username}:${user.role}`));
  const html = document.toString();
  const managedChanges=await publicationChanges(repo,head,model,html);
  const changes = [{path,content:managedChanges.pageHTML||html},...imageChanges,...managedChanges];
  if (!managedChanges.some(c=>c.path==='public/sitemap.xml')&&tree.some(entry => entry.path === "public/sitemap.xml")) {
    const sitemap = await repo.read("public/sitemap.xml",head), route = "/"+path.slice(7).replace(/index\.html$/,"");
    const location = (SITE+route).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const updated = sitemap.content.replace(new RegExp(`(<loc>${location}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`),`$1${new Date().toISOString().slice(0,10)}$2`);
    if (updated !== sitemap.content) changes.push({path:"public/sitemap.xml",content:updated});
  }
  const result = await repo.commit(head,changes,`content: visual builder ${path.slice(7)} (${user.username})`);
  // Never fetch the branch again here: another writer may already have advanced it.
  return {...result,path,publication:{commit:localMode?"local":"committed",deployment:localMode?"not_applicable":"unknown"}};
}

// The same validator/renderer produces a public preview, with commit intercepted.
// No repository ref, static page, registry or asset is written by this endpoint.
export async function previewBuilder(repo,model,user,unlockIds){
 let captured=[];
 const previewRepo=Object.create(repo);
 previewRepo.commit=async(head,changes)=>{captured=changes;return {sha:head,mode:'preview'};};
 await publishBuilder(previewRepo,{model,requestId:crypto.randomUUID(),unlockIds},user,true);
 let html=captured.find(c=>c.path===model.base.path)?.content;
 if(typeof html!=='string')throw new CMSFailure('ساخت پیش‌نمایش ممکن نشد.');
 for(const file of captured.filter(c=>c.encoding==='base64')){const url='/'+file.path.slice(7),mime=file.path.endsWith('.png')?'image/png':file.path.endsWith('.jpg')?'image/jpeg':'image/webp';html=html.split(url).join(`data:${mime};base64,${file.content}`);}
 return {html,path:model.base.path,draft:true};
}
