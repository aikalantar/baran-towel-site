import { parseHTML } from "linkedom";
import { CMSFailure, SITE, pagePath, routeFor, safeURL } from "./content.js";
import { digest } from "./auth.js";

// This public registry contains published metadata and recovery *references*,
// never draft HTML. Removed content stays in Git history (private local snapshots
// in LocalRepository), rather than at a publicly accessible archive URL.
const REGISTRY = "public/builder-pages.json";
const RESERVED = new Set(["admin", "api", "assets", "assets-v2", "assets-v3", "en", "fa", "blog", "catalog", "bridal-towels", "index", "home", "_cms-archive"]);
const TEMPLATES = [
  { id:"blank", title:"صفحه ساده", description:"عنوان اصلی و متن با پوسته واقعی سایت" },
  { id:"hero", title:"معرفی و فراخوان", description:"عنوان، توضیح و دکمه با استایل سایت" },
  { id:"content", title:"صفحه محتوایی", description:"عنوان اصلی و دو بخش مستقل" },
];
const clean = (value, max, label, fallback = "") => {
  if (value === undefined) value = fallback;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new CMSFailure(`${label} معتبر نیست.`);
  return value.trim();
};
const plain = value => value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const clone = value => JSON.parse(JSON.stringify(value));
const validRef = value => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const canonical = (value, path) => {
  const text = clean(value, 2000, "آدرس canonical", SITE + routeFor(path));
  let url;
  try { url = new URL(text); } catch { throw new CMSFailure("آدرس canonical معتبر نیست."); }
  if (url.origin !== SITE || url.username || url.password || url.search || url.hash || /[\u0000-\u0020\\]/.test(text)) throw new CMSFailure("canonical باید آدرس معتبر همین سایت باشد.");
  return url.href;
};
export function generatedPagePath(slug, language = "fa") {
  if (!["fa","en"].includes(language) || typeof slug !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,77}[a-z0-9])?$/.test(slug) || RESERVED.has(slug)) throw new CMSFailure("نامک فقط حروف کوچک انگلیسی، عدد و خط تیره است؛ نام‌های سیستمی و مسیرهای فعلی رزرو هستند.");
  return `public/${language === "en" ? "en/" : ""}${slug}/index.html`;
}
function managedPath(path) {
  const match = /^public\/(en\/)?([a-z0-9-]+)\/index\.html$/.exec(path || "");
  return !!match && generatedPagePath(match[2], match[1] ? "en" : "fa") === path;
}
export function validatePageMetadata(value, path, fallback = {}) {
  pagePath(path);
  if (!plain(value)) throw new CMSFailure("تنظیمات صفحه معتبر نیست.");
  const language = value.language ?? fallback.language ?? (path.startsWith("public/en/") ? "en" : "fa");
  if (!["fa","en"].includes(language) || language !== (path.startsWith("public/en/") ? "en" : "fa")) throw new CMSFailure("زبان صفحه با مسیر آن هماهنگ نیست.");
  const direction = value.direction ?? fallback.direction ?? (language === "fa" ? "rtl" : "ltr");
  if (!["rtl","ltr"].includes(direction)) throw new CMSFailure("جهت صفحه معتبر نیست.");
  const robots = value.robots ?? fallback.robots ?? "index", visibility = value.visibility ?? fallback.visibility ?? "public";
  if (!["index","noindex"].includes(robots) || !["public","unlisted"].includes(visibility)) throw new CMSFailure("وضعیت نمایش صفحه معتبر نیست.");
  const title = clean(value.title, 180, "عنوان صفحه", fallback.title || "صفحه جدید"), description = clean(value.description, 600, "توضیح صفحه", fallback.description || "");
  if (!title) throw new CMSFailure("عنوان صفحه نمی‌تواند خالی باشد.");
  const id = value.id ?? fallback.id;
  if (id != null && !/^page-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new CMSFailure("شناسه صفحه معتبر نیست.");
  const menu = value.menu ?? fallback.menu ?? {included:false,label:title,order:0};
  if (!plain(menu) || typeof menu.included !== "boolean" || !Number.isInteger(menu.order ?? 0) || Math.abs(menu.order ?? 0) > 10000) throw new CMSFailure("ترتیب یا نمایش منو معتبر نیست.");
  let ogImage = clean(value.ogImage, 2000, "تصویر اشتراک‌گذاری", fallback.ogImage || "");
  if (ogImage) {
    if (ogImage.startsWith(SITE + "/")) ogImage = ogImage.slice(SITE.length);
    safeURL(ogImage, true);
  }
  return {
    ...(id ? {id} : {}), title, description, language, direction,
    canonical:canonical(value.canonical ?? fallback.canonical, path), robots, visibility,
    ogTitle:clean(value.ogTitle,180,"عنوان اشتراک‌گذاری",fallback.ogTitle || title),
    ogDescription:clean(value.ogDescription,600,"توضیح اشتراک‌گذاری",fallback.ogDescription || description), ogImage,
    menu:{included:menu.included,label:clean(menu.label,100,"عنوان منو",title) || title,order:menu.order ?? 0},
  };
}
export function readPageMetadata(document, path) {
  const meta = selector => document.querySelector(selector)?.getAttribute("content") || "";
  const menuLinks=[...document.querySelectorAll(".primary-nav a[href]")],ownLink=menuLinks.find(a=>hrefRoute(a.getAttribute("href"))===routeFor(path));
  return validatePageMetadata({
    title:document.title || document.querySelector("h1")?.textContent || "صفحه",
    description:meta('meta[name="description"]'),
    canonical:document.querySelector('link[rel="canonical"]')?.getAttribute("href") || SITE + routeFor(path),
    robots:/noindex/.test(meta('meta[name="robots"]')) ? "noindex" : "index",
    visibility:meta('meta[name="builder-page-visibility"]')==='unlisted'?'unlisted':'public',
    language:document.documentElement.lang || (path.startsWith("public/en/") ? "en" : "fa"),
    direction:document.documentElement.dir || (path.startsWith("public/en/") ? "ltr" : "rtl"),
    ogTitle:meta('meta[property="og:title"]'),ogDescription:meta('meta[property="og:description"]'),ogImage:meta('meta[property="og:image"]'),
    menu:{included:!!ownLink,label:ownLink?.textContent?.trim() || document.title || "صفحه",order:ownLink ? menuLinks.indexOf(ownLink) : 0},
    ...(meta('meta[name="builder-page-id"]') ? {id:meta('meta[name="builder-page-id"]')} : {}),
  },path);
}
function setMeta(document, attribute, name, content) {
  let node = document.querySelector(`meta[${attribute}="${name}"]`);
  if (!node) { node = document.createElement("meta"); node.setAttribute(attribute,name); document.head.append(node); }
  node.setAttribute("content",content);
}
export function applyPageSEO(document, modelOrPage, explicitPath) {
  const path = explicitPath || modelOrPage?.base?.path || modelOrPage?.path;
  const candidate = modelOrPage?.page || modelOrPage?.base?.creation?.page || modelOrPage;
  if (!path || !candidate || (modelOrPage?.base && !modelOrPage.page && !modelOrPage.base.creation?.page)) return;
  const data = validatePageMetadata(candidate,path,readPageMetadata(document,path));
  document.title = data.title;
  document.documentElement.lang = data.language; document.documentElement.dir = data.direction;
  setMeta(document,"name","description",data.description);
  setMeta(document,"name","robots",data.visibility === "unlisted" || data.robots === "noindex" ? "noindex, follow" : "index, follow");
  setMeta(document,'name','builder-page-visibility',data.visibility);
  if (data.id) setMeta(document,"name","builder-page-id",data.id);
  for (const [key,value] of Object.entries({title:data.ogTitle,description:data.ogDescription,url:data.canonical,locale:data.language === "fa" ? "fa_IR" : "en_US"})) setMeta(document,"property",`og:${key}`,value);
  if (data.ogImage) setMeta(document,"property","og:image",SITE + data.ogImage);
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.append(link); }
  link.setAttribute("href",data.canonical);
  return data;
}
async function registry(repo, head) {
  try {
    const data = JSON.parse((await repo.read(REGISTRY,head)).content);
    if (data.schemaVersion !== 1 || !Array.isArray(data.pages) || data.pages.length > 1000 || !Array.isArray(data.requests)) throw new Error();
    for (const entry of data.pages) {
      pagePath(entry.path); if (!["published","archived","deleted"].includes(entry.status) || typeof entry.managed !== "boolean" || (entry.managed && !managedPath(entry.path))) throw new Error();
      validatePageMetadata(entry.page,entry.path);
      if (entry.recovery && (!validRef(entry.recovery.revision) || !managedPath(entry.recovery.path))) throw new Error();
    }
    return data;
  } catch (error) {
    if (error instanceof CMSFailure && error.status === 404) return {schemaVersion:1,pages:[],requests:[]};
    throw new CMSFailure("فهرست مدیریت صفحات نیاز به بررسی دارد؛ هیچ تغییری ثبت نشد.",422);
  }
}
const isWebsitePage = path => /^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(path) && !path.startsWith("public/admin/");
export async function listPages(repo, inspectPath) {
  const head = await repo.head(), tree = await repo.tree(head), records = await registry(repo,head), pages = [];
  for (const entry of tree.filter(item => isWebsitePage(item.path))) {
    const saved = records.pages.find(p => p.path === entry.path), file = await repo.read(entry.path,head);
    const page = {...readPageMetadata(parseHTML(file.content).document,entry.path),...(saved?.page || {})};
    pages.push({path:entry.path,route:routeFor(entry.path),revision:file.sha,status:"published",managed:saved?.managed === true,title:page.title,page});
  }
  for (const entry of records.pages.filter(p => p.status !== "published")) pages.push({...entry,route:routeFor(entry.path),title:entry.page.title});
  const result = {head,pages,templates:TEMPLATES};
  if (inspectPath) {
    pagePath(inspectPath);
    result.impact = {path:inspectPath,links:await incomingLinks(repo,head,inspectPath),protected:!records.pages.some(p => p.path === inspectPath && p.managed)};
  }
  return result;
}
async function assertVacant(repo,head,path,records) {
  const tree = await repo.tree(head), route = routeFor(path).replace(/\/$/,"");
  if (tree.some(f => f.path === path || f.path.startsWith(path.slice(0,-10)) || f.path === `public${route}.html`) || records.pages.some(p => p.path === path)) throw new CMSFailure("این نامک قبلاً استفاده یا بایگانی شده است؛ نام دیگری انتخاب یا نسخه بایگانی را بازیابی کنید.",409);
  try { const redirects = (await repo.read("public/_redirects",head)).content; if (redirects.split(/\r?\n/).some(line => [route,route+"/"].includes(line.trim().split(/\s+/)[0]))) throw new CMSFailure("این مسیر در تغییرمسیرهای سایت رزرو شده است.",409); } catch (error) { if (!(error instanceof CMSFailure && error.status === 404)) throw error; }
}
function creationDescriptor(body,path,sourcePath,sourceRevision,sourceSha) {
  const kind = body.kind ?? (body.sourcePath ? "duplicate" : body.template && body.template !== "blank" ? "template" : "blank");
  const template = body.template || "blank";
  if (!["blank","duplicate","template"].includes(kind) || !TEMPLATES.some(t => t.id === template)) throw new CMSFailure("قالب صفحه معتبر نیست.");
  const language = path.startsWith("public/en/") ? "en" : "fa";
  const id = `page-${crypto.randomUUID()}`;
  const page = validatePageMetadata({...body.page,id,title:body.title || body.page?.title || (language === "fa" ? "صفحه جدید" : "New page"),description:body.description ?? body.page?.description ?? "",language,canonical:SITE+routeFor(path)},path);
  return {kind,template,sourcePath,sourceRevision,sourceSha,path,id,language,title:page.title,description:page.description,page};
}
function validateCreation(creation,path) {
  if (!plain(creation) || creation.path !== path || !managedPath(path) || !["blank","duplicate","template"].includes(creation.kind) || !TEMPLATES.some(t => t.id === creation.template) || !validRef(creation.sourceRevision) || !validRef(creation.sourceSha)) throw new CMSFailure("اطلاعات پایه صفحه تازه معتبر نیست.");
  pagePath(creation.sourcePath);
  if (creation.sourcePath.startsWith("public/admin/") || !/^page-[a-zA-Z0-9-]{8,80}$/.test(creation.id) || creation.page?.id !== creation.id) throw new CMSFailure("منبع یا شناسه صفحه تازه معتبر نیست.");
  validatePageMetadata(creation.page,path);
  return creation;
}
function trustedSource(content, creation) {
  const {document} = parseHTML(content), main = document.querySelector("main");
  if (!main) throw new CMSFailure("پوسته انتخابی بخش اصلی سازگار ندارد.");
  for (const node of document.querySelectorAll('meta[name="builder-request"],meta[name="builder-fingerprint"],meta[name="builder-page-id"],link[rel="alternate"],script[type="application/ld+json"]')) node.remove();
  if (creation.kind !== "duplicate") {
    for (const node of document.querySelectorAll('#builder-state,#builder-layout,link[rel="preload"][as="image"]')) node.remove();
    for (const node of document.querySelectorAll("[data-builder-id],[data-builder-anchor],[data-builder-unit],[data-builder-geometry],[data-builder-created]")) for (const attribute of [...node.attributes]) if (attribute.name.startsWith("data-builder-")) node.removeAttribute(attribute.name);
  }
  if (creation.kind !== "duplicate") {
    main.replaceChildren();
    const make = (tag,text,parent) => { const node = document.createElement(tag); if (text) node.textContent = text; parent.append(node); return node; };
    const section = make("section","",main); section.className="section"; section.setAttribute("data-builder-anchor","page-main");
    make("h1",creation.title,section); make("p",creation.description || (creation.language === "en" ? "Edit this page visually." : "محتوای صفحه را به‌صورت دیداری ویرایش کنید."),section);
    if (creation.template === "hero") { const button=make("a",creation.language === "en" ? "Explore our collection" : "مشاهده مجموعه",section); button.className="button-link"; button.setAttribute("href",creation.language === "en" ? "/en/catalog/" : "/catalog/"); }
    if (creation.template === "content") for (let i=1;i<=2;i++) { const next=make("section","",main); next.className="section"; next.setAttribute("data-builder-anchor",`page-content-${i}`); make("h2",creation.language === "en" ? `Section ${i}` : `بخش ${i}`,next); make("p",creation.language === "en" ? "Your page content." : "متن دلخواه این بخش.",next); }
  }
  // A new page has no genuine translation yet. Language switch points to the
  // existing language homepage rather than claiming a nonexistent counterpart.
  for (const link of document.querySelectorAll(".language-switcher")) link.setAttribute("href",creation.language === "fa" ? "/en/" : "/");
  applyPageSEO(document,creation.page,creation.path);
  return document.toString();
}
export async function preparePage(repo,body,head) {
  if (!plain(body)) throw new CMSFailure("درخواست صفحه معتبر نیست.");
  head ||= await repo.head();
  const path=generatedPagePath(body.slug,body.language || "fa"), records=await registry(repo,head);
  await assertVacant(repo,head,path,records);
  const sourcePath=pagePath(body.sourcePath || (body.language === "en" ? "public/en/index.html" : "public/index.html"));
  const source=await repo.read(sourcePath,head);
  if (repo.checkpoint) await repo.checkpoint(head,[sourcePath]);
  const creation=creationDescriptor(body,path,sourcePath,head,source.sha);
  return {path,content:trustedSource(source.content,creation),revision:"new",creation};
}
export async function newPageSource(repo,model,head) {
  const path=pagePath(model?.base?.path), creation=validateCreation(model?.base?.creation,path);
  if (model.base.revision !== "new") throw new CMSFailure("نسخه پایه صفحه تازه معتبر نیست.");
  const records=await registry(repo,head); await assertVacant(repo,head,path,records);
  const source=await repo.read(creation.sourcePath,creation.sourceRevision);
  if (source.sha !== creation.sourceSha) throw new CMSFailure("نسخه پوسته صفحه تازه تغییر کرده است؛ پیش‌نویس را خروجی بگیرید و صفحه تازه بسازید.",409);
  return {content:trustedSource(source.content,creation),sha:"new"};
}
function updateSitemap(content,records,remove=[]) {
  const {document}=parseHTML(content), root=document.querySelector("urlset");
  if (!root) throw new CMSFailure("نقشه سایت معتبر نیست.");
  const targets=new Map(records.pages.map(entry=>[SITE+routeFor(entry.path),entry]));
  const found=new Set();
  for (const node of [...root.children]) if (node.localName === "url") {
    const url=node.querySelector("loc")?.textContent;
    const entry=targets.get(url);
    if (remove.includes(url) || entry && (entry.status!=="published" || entry.page.visibility!=="public" || entry.page.robots!=="index")) node.remove();
    else if(entry) {
      found.add(url);
      let lastmod=node.querySelector("lastmod");
      if(!lastmod){lastmod=document.createElement("lastmod");node.append(lastmod);}
      lastmod.textContent=entry.updated?.slice(0,10) || new Date().toISOString().slice(0,10);
    }
  }
  for (const entry of records.pages.filter(p=>p.status === "published" && p.page.visibility === "public" && p.page.robots === "index")) {
    if(found.has(SITE+routeFor(entry.path)))continue;
    const node=document.createElement("url"),loc=document.createElement("loc"),lastmod=document.createElement("lastmod");
    loc.textContent=SITE+routeFor(entry.path); lastmod.textContent=entry.updated?.slice(0,10) || new Date().toISOString().slice(0,10); node.append(loc,lastmod);root.append(node);
  }
  // linkedom's HTML parser lowercases namespace attributes but keeps valid XML.
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+root.toString();
}
function navigationHTML(html,path,records) {
  const {document}=parseHTML(html), language=path.startsWith("public/en/") ? "en" : "fa";
  const entries=records.pages.filter(p=>(p.managed || p.menuExplicit) && p.status === "published" && p.page.language === language && p.page.visibility === "public" && p.page.menu.included).sort((a,b)=>a.page.menu.order-b.page.menu.order || a.path.localeCompare(b.path));
  const explicit=records.pages.filter(p=>p.menuExplicit);
  let changed=false;
  for (const nav of document.querySelectorAll(".primary-nav,.drawer-nav")) {
    const before=nav.innerHTML;
    for (const link of nav.querySelectorAll("[data-builder-menu]")) link.remove();
    for (const entry of explicit) for (const link of nav.querySelectorAll("a[href]")) if (hrefRoute(link.getAttribute("href")) === routeFor(entry.path)) link.remove();
    for (const entry of entries) {
      if ([...nav.querySelectorAll("a[href]")].some(link=>hrefRoute(link.getAttribute("href")) === routeFor(entry.path))) continue;
      const link=document.createElement("a"); link.setAttribute("href",routeFor(entry.path)); link.setAttribute("data-builder-menu",entry.page.id || entry.path); link.textContent=entry.page.menu.label; nav.insertBefore(link,nav.children[Math.max(0,entry.page.menu.order)] || null);
    }
    if (before!==nav.innerHTML) changed=true;
  }
  return changed ? document.toString() : html;
}
function hrefRoute(href) {
  try { const url=new URL(href,SITE); return url.origin === SITE ? url.pathname : null; } catch { return null; }
}
async function incomingLinks(repo,head,path) {
  const tree=await repo.tree(head), route=routeFor(path), links=[];
  for (const entry of tree.filter(item=>isWebsitePage(item.path) && item.path !== path)) {
    const {document}=parseHTML((await repo.read(entry.path,head)).content);
    for (const a of document.querySelectorAll("a[href]")) if (!a.hasAttribute("data-builder-menu") && [route,route+"index.html",route.replace(/\/$/,"")].includes(hrefRoute(a.getAttribute("href")))) links.push({path:entry.path,text:a.textContent.slice(0,100),href:a.getAttribute("href")});
  }
  return links;
}
const menuSignature = records => JSON.stringify(records.pages.filter(p=>p.menuExplicit || p.managed && p.page.menu.included).map(p=>[p.path,p.status,p.page.language,p.page.visibility,p.page.menu,p.menuExplicit]).sort((a,b)=>a[0].localeCompare(b[0])));
async function auxiliaryChanges(repo,head,records,targetHTML,targetPath,remove=[],updateNavigation=true) {
  const changes=[],tree=await repo.tree(head);
  for (const entry of updateNavigation ? tree.filter(f=>isWebsitePage(f.path) && f.path!==targetPath && !remove.includes(SITE+routeFor(f.path))) : []) {
    const old=(await repo.read(entry.path,head)).content, next=navigationHTML(old,entry.path,records);
    if(next!==old) changes.push({path:entry.path,content:next});
  }
  if(targetHTML!=null) changes.pageHTML=navigationHTML(targetHTML,targetPath,records);
  changes.push({path:REGISTRY,content:JSON.stringify(records,null,2)+"\n"});
  let sitemap;
  try { sitemap=(await repo.read("public/sitemap.xml",head)).content; } catch(error) { if (!(error instanceof CMSFailure && error.status===404)) throw error; sitemap='<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'; }
  const updated=updateSitemap(sitemap,records,remove);
  if(updated!==sitemap) changes.push({path:"public/sitemap.xml",content:updated});
  return changes;
}
export async function publicationChanges(repo,head,model,html) {
  const path=pagePath(model.base.path);
  if (!model.page && !model.base.creation) return [];
  const records=await registry(repo,head),beforeMenu=menuSignature(records),existing=records.pages.find(entry=>entry.path===path);
  const page=validatePageMetadata(model.page || model.base.creation.page,path,readPageMetadata(parseHTML(html).document,path));
  if (page.ogImage && !(await repo.tree(head)).some(entry=>entry.path === "public"+page.ogImage) && !model.elements?.some(e=>e.type === "image" && e.content.src === page.ogImage)) throw new CMSFailure("تصویر اشتراک‌گذاری در کتابخانه موجود نیست.");
  let originalPage=existing?.page;
  if(!originalPage && !model.base.creation)originalPage=readPageMetadata(parseHTML((await repo.read(path,head)).content).document,path);
  const managed=!!model.base.creation || existing?.managed===true;
  const menuExplicit=existing?.menuExplicit || !managed && originalPage && (JSON.stringify(originalPage.menu)!==JSON.stringify(page.menu) || originalPage.visibility!==page.visibility);
  const record={path,status:"published",managed,page,updated:new Date().toISOString(),menuExplicit:!!menuExplicit};
  if(existing) Object.assign(existing,record); else records.pages.push(record);
  return auxiliaryChanges(repo,head,records,html,path,[],beforeMenu!==menuSignature(records));
}
function confirm(body,path) {
  if (body.confirm !== path) throw new CMSFailure("برای تأیید عملیات، مسیر کامل صفحه را دقیقاً وارد کنید.");
}
export async function pageAction(repo,body,user,localMode=false) {
  if (!plain(body) || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || "")) throw new CMSFailure("درخواست مدیریت صفحه معتبر نیست.");
  const path=pagePath(body.path),head=await repo.head(),records=await registry(repo,head),beforeMenu=menuSignature(records),fingerprint=await digest(JSON.stringify(body));
  const replay=records.requests.find(entry=>entry.id===body.requestId);
  if(replay) { if(replay.fingerprint!==fingerprint) throw new CMSFailure("این شناسه برای درخواست دیگری استفاده شده است.",409); return {sha:head,path:replay.path,action:replay.action,replayed:true,mode:localMode?"local":"github"}; }
  if(body.head!==head) throw new CMSFailure("فهرست صفحات تغییر کرده است؛ ابتدا نسخه تازه را بارگذاری کنید.",409);
  let entry=records.pages.find(item=>item.path===path), targetPath=path,html,remove=[],changes=[];
  if (!entry) {
    const file=await repo.read(path,head);
    entry={path,status:"published",managed:false,page:readPageMetadata(parseHTML(file.content).document,path),menuExplicit:false};records.pages.push(entry);
  }
  if (["archive","delete","restore","slug"].includes(body.action) && !entry.managed) throw new CMSFailure("حذف، بایگانی یا تغییر مسیر صفحات اصلی، کاتالوگ و مجله در این بخش مجاز نیست؛ برای حفظ پیوندها از مدیریت فعلی CMS استفاده کنید.",409);
  if (["archive","delete","slug"].includes(body.action)) {
    confirm(body,path);
    if(entry.status!=="published") throw new CMSFailure("صفحه هم‌اکنون منتشر نیست.",409);
  }
  if(body.action==="archive" || body.action==="delete") {
    const links=await incomingLinks(repo,head,path);
    if(links.length) throw new CMSFailure(`این صفحه ${links.length} پیوند ورودی دارد (${[...new Set(links.map(l=>routeFor(l.path)))].slice(0,3).join("، ")}). ابتدا پیوندها را اصلاح کنید؛ مقصد خودکار ساخته نمی‌شود.`,409);
    const file=await repo.read(path,head); if(repo.checkpoint) await repo.checkpoint(head,[path]);
    entry.status=body.action==="archive" ? "archived" : "deleted"; entry.recovery={path,revision:head,fileSha:file.sha};
    changes.push({path,delete:true});remove.push(SITE+routeFor(path));
  } else if(body.action==="restore") {
    confirm(body,path);
    if(entry.status==="published" || !entry.recovery) throw new CMSFailure("نسخه قابل بازیابی برای این صفحه وجود ندارد.",409);
    if((await repo.tree(head)).some(item=>item.path===path)) throw new CMSFailure("مسیر صفحه اکنون استفاده می‌شود؛ بازیابی آن را بازنویسی نمی‌کند.",409);
    const file=await repo.read(entry.recovery.path,entry.recovery.revision);
    if(file.sha!==entry.recovery.fileSha) throw new CMSFailure("نسخه بازیابی تطبیق ندارد؛ هیچ فایلی تغییر نکرد.",409);
    html=file.content;entry.status="published";delete entry.recovery;
  } else if(body.action==="slug") {
    targetPath=generatedPagePath(body.slug,entry.page.language);await assertVacant(repo,head,targetPath,records);
    const links=await incomingLinks(repo,head,path);
    if(links.length && body.updateLinks!==true) throw new CMSFailure(`این تغییر ${links.length} پیوند ورودی دارد. پس از بررسی، گزینه اصلاح پیوندهای داخلی را صریحاً فعال کنید.`,409);
    html=(await repo.read(path,head)).content;
    if(body.updateLinks===true) {
      for(const item of (await repo.tree(head)).filter(f=>isWebsitePage(f.path))) {
        const source=item.path===path ? html : (await repo.read(item.path,head)).content,{document}=parseHTML(source);let changed=false;
        for(const a of document.querySelectorAll("a[href]")) if([routeFor(path),routeFor(path)+"index.html",routeFor(path).replace(/\/$/,"")].includes(hrefRoute(a.getAttribute("href")))) { const url=new URL(a.getAttribute("href"),SITE);a.setAttribute("href",routeFor(targetPath)+url.search+url.hash);changed=true; }
        if(changed) { if(item.path===path) html=document.toString();else changes.push({path:item.path,content:document.toString()}); }
      }
    }
    const {document}=parseHTML(html);entry.page.canonical=SITE+routeFor(targetPath);applyPageSEO(document,entry.page,targetPath);html=document.toString();
    // Exact known old -> new destination; preserve external/bookmarked links.
    let redirects="";try{redirects=(await repo.read("public/_redirects",head)).content;}catch(error){if(!(error instanceof CMSFailure&&error.status===404))throw error;}
    const from=routeFor(path),to=routeFor(targetPath),lines=redirects.split(/\r?\n/),sources=[from,from.replace(/\/$/,""),from+"index.html"];
    if(lines.some(line=>sources.includes(line.trim().split(/\s+/)[0])))throw new CMSFailure("مسیر قبلی تغییرمسیر موجود دارد؛ ابتدا آن را بررسی کنید.",409);
    changes.push({path:"public/_redirects",content:redirects.trimEnd()+"\n"+sources.map(source=>`${source} ${to} 301`).join("\n")+"\n"},{path,delete:true});
    remove.push(SITE+routeFor(path));entry.path=targetPath;
  } else if(["rename","metadata","menu"].includes(body.action)) {
    if(entry.status!=="published") throw new CMSFailure("ابتدا صفحه را بازیابی کنید.",409);
    const patch=body.action==="rename" ? {title:body.title} : body.action==="menu" ? {menu:body.menu} : body.page;
    if(!plain(patch))throw new CMSFailure("تنظیمات صفحه معتبر نیست.");
    const visibilityBefore=entry.page.visibility;
    entry.page=validatePageMetadata({...entry.page,...patch},path,entry.page);
    if(body.action==="menu" || !entry.managed && visibilityBefore!==entry.page.visibility)entry.menuExplicit=true;
    const {document}=parseHTML((await repo.read(path,head)).content);applyPageSEO(document,entry.page,path);html=document.toString();
  } else throw new CMSFailure("عملیات مدیریت صفحه پشتیبانی نمی‌شود.");
  entry.updated=new Date().toISOString();
  records.requests.push({id:body.requestId,fingerprint,path:targetPath,action:body.action});records.requests=records.requests.slice(-40);
  const auxiliary=await auxiliaryChanges(repo,head,records,html,targetPath,remove,beforeMenu!==menuSignature(records));
  // Merge link rewrites and menu updates on the same file before the atomic CAS.
  const merged=new Map(changes.map(c=>[c.path,c]));
  for(const change of auxiliary) {
    const previous=merged.get(change.path);
    merged.set(change.path,previous && previous.content && isWebsitePage(change.path) ? {...previous,content:navigationHTML(previous.content,change.path,records)} : change);
  }
  if(html!=null)merged.set(targetPath,{path:targetPath,content:auxiliary.pageHTML || html});
  const result=await repo.commit(head,[...merged.values()],`content: ${body.action} page ${path.slice(7)} (${user.username})`);
  return {...result,path:targetPath,route:routeFor(targetPath),action:body.action,publication:{commit:localMode?"local":"committed",deployment:localMode?"not_applicable":"unknown"}};
}
