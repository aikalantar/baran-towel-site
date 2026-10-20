import {createDraftSafety,installDraftRecovery} from './draft-safety.js';
import { mountNavigation, closeNavigation } from './navigation.js';
import { mountInstall } from './pwa.js';
import { adminDestination } from './routes.js';
const $ = (selector, root = document) => root.querySelector(selector);
const draftSafety=createDraftSafety();
const draftRecovery=installDraftRecovery({retry:()=>saveDraft(),exportDraft:()=>exportDraft()});
let draftSaveChain=Promise.resolve();
const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (value) => Number(value).toLocaleString("fa-IR");
const icons = {
  home: "M3 10 12 3l9 7v10H3Z M9 20v-7h6v7",
  pages: "M6 3h9l4 4v14H6Z M14 3v5h5 M9 12h7 M9 16h7",
  catalog: "M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z",
  blog: "M4 3h16v18H4Z M8 8h8 M8 12h8 M8 16h5",
  image: "M3 4h18v16H3Z M3 16l5-5 5 5 3-3 5 5 M16 8h.01",
  history: "M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v6l4 2",
  help: "M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  external: "M13 3h8v8 M21 3l-12 12 M9 3H3v18h18v-6",
  arrow: "M15 5l-7 7 7 7",
  search: "M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16 M16 16l6 6",
  plus: "M12 4v16 M4 12h16",
  check: "M4 12l5 5L20 6",
  logout: "M10 3H3v18h7 M15 8l5 4-5 4 M8 12h12",
  contact: "M4 5h16v14H4Z M4 6l8 7 8-7",
  save: "M4 3h14l3 3v15H3V3Z M7 3v6h10V3 M7 21v-8h10v8",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
};
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name] || icons.pages}"/></svg>`;
const pageInfo = (p) => {
  const en = p.language === "en",
    route = p.route;
  if (route === "/" || route === "/en/")
    return {
      name: en ? "صفحه اصلی انگلیسی" : "صفحه اصلی",
      description: "معرفی برند، تصاویر و دعوت به همکاری",
      image: "/assets/images/home/baran-hero.webp",
    };
  if (route.includes("catalog"))
    return {
      name: en ? "کاتالوگ انگلیسی" : "کاتالوگ مدل‌ها",
      description: "تصاویر، ویژگی‌ها و اطلاعات مدل‌ها",
      image: "/assets/products/sanam.webp",
    };
  if (route.includes("bridal"))
    return {
      name: "حوله عروس و داماد",
      description: "راهنمای انتخاب و پرسش‌های متداول",
      image: "/assets/bridal/bridal-towels-hero.dbc3443700.webp",
    };
  if (/\/blog\/$/.test(route))
    return {
      name: en ? "مجله انگلیسی" : "مجله باران",
      description: "صفحه معرفی مقاله‌ها",
      image: "/assets/images/blog/luxury-towel-set.webp",
    };
  return {
    name: en
      ? "مقاله انگلیسی"
      : route.includes("rahnamaye")
        ? "راهنمای خرید حوله لوکس"
        : route.split("/").filter(Boolean).at(-1),
    description: "ویرایش متن و تصاویر مقاله",
    image: "/assets/images/blog/luxury-towel-buying-guide.webp",
  };
};
const state = {
  session: null,
  library: null,
  view: "home",
  language: "fa",
  tab: "text",
  page: null,
  original: null,
  operations: [],
  images: [],
  article: null,
  filter: "",
  busy: false,
  draftVersion: 0,
};
let noticeTimer,
  saveTimer,
  previewSequence = 0;
function notice(message, error = false) {
  const el = $("#notice");
  el.textContent = message;
  el.className = "notice" + (error ? " error" : "");
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el.hidden = true), error ? 14000 : 7000);
}
async function api(endpoint, body) {
  const response = await fetch("/api/cms" + endpoint, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CMS-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && endpoint !== "/login") {
      state.session.user = null;
      renderLogin();
    }
    throw new Error(result.error || "ارتباط با پنل برقرار نشد.");
  }
  return result;
}
let dbPromise;
function database() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("luxtowelco-cms", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
const editingContacts=()=>state.view==='contacts'&&!!$('#contacts-form');
const draftKey = () =>
  `${state.session?.user?.username || "unknown"}:${editingContacts()?'contacts':state.article ? "new-article" : state.page?.path || ""}`;
async function draftRead(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction("drafts").objectStore("drafts").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function draftWrite(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    value === null ? store.delete(key) : store.put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('ثبت پیش‌نویس متوقف شد.'));
  });
}
function draftSnapshot() {
  return {
    page: state.page,
    original: state.original,
    article: state.article,
    operations: state.operations,
    images: state.images,
    ...(editingContacts()?{contacts:{head:state.contacts.head,values:Object.fromEntries(new FormData($('#contacts-form')))}}:{}),
    savedAt: Date.now(),
  };
}
async function saveDraft(silent = false) {
  clearTimeout(saveTimer);
  saveTimer=null;
  if (!state.page && !state.article&&!editingContacts()) return true;
  try {
    const key=draftKey(),snapshot=structuredClone(draftSnapshot()),revision=draftSafety.revision;
    const write=draftSaveChain.catch(()=>{}).then(()=>draftWrite(key,snapshot));draftSaveChain=write;
    await write;draftSafety.saved(revision);if(!draftSafety.atRisk)draftRecovery.clear();
    const el = $("#draft-status");
    if (el) el.textContent = "پیش‌نویس در این مرورگر ذخیره شد";
    if (!silent)
      notice("پیش‌نویس ذخیره شد. هنوز تغییری روی سایت منتشر نشده است.");
    return true;
  } catch {
    notice("مرورگر نتوانست پیش‌نویس را ذخیره کند. یک نسخه دانلود کنید.", true);
    draftRecovery.show('ذخیره انجام نشد؛ تغییرات تازه فقط در این تب هستند. دوباره تلاش کنید یا پیش از خروج JSON را دانلود کنید.');
    return false;
  }
}
async function ensureDraftSaved(){let version;do{version=state.draftVersion;if(await saveDraft(true)===false)throw new Error('برای حفظ کارتان، ابتدا ذخیره را دوباره امتحان کنید یا JSON را دانلود کنید؛ صفحه عوض نشد.');}while(version!==state.draftVersion);}
function changed() {
  draftSafety.changed();
  state.draftVersion++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(true), 600);
  const el = $("#draft-status");
  if (el) el.textContent = "تغییرات ذخیره‌نشده";
}
const navItems = [
  ["home", "پیشخوان", "home"],
  ["builder", "صفحه‌ساز بصری", "pages"],
  ["pages", "صفحات سایت", "pages"],
  ["catalog", "کاتالوگ مدل‌ها", "catalog"],
  ["blog", "مجله و مقاله‌ها", "blog"],
  ["media", "کتابخانه تصاویر", "image"],
  ["contacts", "اطلاعات تماس", "contact"],
  ["history", "تاریخچه تغییرات", "history"],
  ["help", "راهنمای استفاده", "help"],
];
function shell(content) {
  const local = state.session.mode === "local";
  $("#app").innerHTML =
    `<div class="layout"><header class="cms-mobile-bar"><a href="/admin/">مدیریت باران</a><button id="cms-menu-toggle" type="button" aria-controls="cms-sidebar" aria-expanded="false">☰ منوی مدیریت</button></header><div class="cms-menu-backdrop" data-menu-close></div><aside class="sidebar" id="cms-sidebar" aria-label="منوی مدیریت"><button class="cms-menu-close" type="button" data-menu-close>بستن منو ×</button><a class="brand" href="/admin/"><img src="/assets/images/brand/baran-logo.c01f592bc1.png" alt="باران" width="52" height="52"><div><strong>مدیریت باران</strong><small>LUXTOWELCO</small></div></a><div class="sidebar-scroll"><div class="nav-label">فضای مدیریت شما</div><nav class="nav" aria-label="منوی مدیریت">${navItems.map(([id, label, ico]) => id === 'builder' ? `<a href="/admin/builder/">${icon(ico)}${label}</a>` : `<button data-nav="${id}" class="${state.view === id ? "active" : ""}" ${state.view === id ? 'aria-current="page"' : ""}>${icon(ico)}${label}</button>`).join("")}</nav><div class="sidebar-bottom"><a class="site-link" href="${local ? "/" : state.session.site}" target="_blank" rel="noopener">مشاهده سایت ${icon("external")}</a><div class="user"><div class="avatar">${esc(state.session.user.name.slice(0, 1))}</div><div><strong>${esc(state.session.user.name)}</strong><small>${local ? "نسخه محلی" : state.session.user.role === "admin" ? "مدیر سایت" : "ویرایشگر محتوا"}</small></div>${!local ? `<button class="logout" data-action="logout" aria-label="خروج">${icon("logout")}</button>` : ""}</div></div></div></aside><main id="content" class="main"><header class="topbar"><span>باران <span aria-hidden="true">/</span> ${navItems.find(([id]) => id === state.view)?.[1] || "ویرایش محتوا"}</span><span class="connection"><span class="dot"></span>${local ? "حالت محلی • ذخیره در پوشه پروژه" : "فضای خصوصی مدیریت"}</span></header>${content}</main></div>`;
  mountNavigation();
  mountInstall($('.sidebar-bottom'));
}
const heading = (title, subtitle, actions = "") =>
  `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
function pageCards(pages) {
  return `<div class="cards">${pages
    .map((p) => {
      const info = pageInfo(p);
      return `<button class="page-card" data-open="${esc(p.path)}"><div class="card-image"><img src="${info.image}" width="640" height="480" alt="" loading="lazy"><span class="tag">${p.language === "fa" ? "فارسی" : "English"}</span></div><div class="card-content"><h3>${esc(info.name)}</h3><p>${esc(info.description)}</p></div><div class="card-footer"><span>ویرایش محتوا</span>${icon("arrow")}</div></button>`;
    })
    .join("")}</div>`;
}
function renderHome() {
  const pages = state.library.pages;
  shell(
    heading(
      "اینجا، باران را به‌روز نگه دارید.",
      "متن‌ها، تصاویر و مدل‌ها؛ همه در یک فضای ساده و مرتب.",
      `<a class="btn primary dashboard-builder" href="/admin/builder/">${icon("pages")}باز کردن صفحه‌ساز بصری</a><a class="btn" href="/" target="_blank" rel="noopener">${icon("external")}مشاهده سایت</a>`,
    ) +
      `<div class="welcome"><div class="welcome-copy"><span class="eyebrow">هر تغییر کوچک، یک روایت تازه</span><h2>محتوای تازه،<br>با همان حس آشنای باران.</h2><p>صفحه موردنظر را انتخاب کنید، تغییر دهید و پیش از انتشار نتیجه را ببینید.</p><button class="btn primary" data-nav="pages">شروع ویرایش ${icon("arrow")}</button></div><img src="/assets/images/home/editorial-01.webp" width="640" height="640" alt="تن‌پوش باران با جزئیات ظریف"></div><div class="stats"><div class="stat"><div><strong>${number(pages.length)}</strong><span>صفحه قابل ویرایش</span></div><div class="stat-icon">${icon("pages")}</div></div><div class="stat"><div><strong>${number(state.library.images.length)}</strong><span>تصویر در کتابخانه</span></div><div class="stat-icon">${icon("image")}</div></div><div class="stat"><div><strong>۲</strong><span>زبان فارسی و انگلیسی</span></div><div class="stat-icon">${icon("blog")}</div></div></div><div class="section-heading"><h2>از کجا شروع می‌کنید؟</h2><button class="btn text small" data-nav="pages">همه صفحات ${icon("arrow")}</button></div>${pageCards(pages.filter((p) => ["/", "/catalog/", "/bridal-towels/"].includes(p.route)))}<div class="help-strip">${icon("help")}<p><strong>با خیال راحت ویرایش کنید.</strong>پیش‌نویس در همین مرورگر ذخیره می‌شود. تغییرات فقط با انتخاب «${state.session.mode === "local" ? "ذخیره در پروژه" : "انتشار تغییرات"}» ثبت می‌شوند.</p></div>`,
  );
}
function renderPages() {
  let pages = state.library.pages.filter((p) => p.language === state.language);
  if (state.view === "blog")
    pages = pages.filter((p) => p.route.includes("/blog/"));
  const title = state.view === "blog" ? "مجله و مقاله‌ها" : "صفحات سایت";
  shell(
    heading(
      title,
      "صفحه‌ای را برای ویرایش متن، تصویر یا تنظیمات نمایش انتخاب کنید.",
      state.view === "blog"
        ? `<button class="btn primary" data-action="new-article">${icon("plus")}مقاله جدید</button>`
        : "",
    ) +
      `<div class="tabs" role="group" aria-label="زبان صفحات"><button data-language="fa" class="${state.language === "fa" ? "active" : ""}">فارسی</button><button data-language="en" class="${state.language === "en" ? "active" : ""}">English</button></div>${pageCards(pages)}`,
  );
}
function updates() {
  if (!state.page || !state.original) return [];
  return state.page.fields
    .filter((field) => {
      const previous = state.original.fields.find((f) => f.id === field.id);
      return (
        !previous ||
        field.value !== previous.value ||
        field.alt !== previous.alt ||
        field.width !== previous.width ||
        field.height !== previous.height
      );
    })
    .map(({ id, value, alt, width, height }) => ({
      id,
      value,
      alt,
      width,
      height,
    }));
}
function payload() {
  return state.article
    ? { head: state.library.head, article: state.article, images: state.images }
    : {
        path: state.page.path,
        revision: state.page.revision,
        restoreCommit: state.page.restoreCommit,
        updates: updates(),
        operations: state.operations,
        images: state.images,
      };
}
function imageURL(url) {
  return (
    state.images.find((i) => "/" + i.path.slice(7) === url)?.preview || url
  );
}
function renderEditor() {
  const page = state.page;
  const kinds = [
    ["text", "محتوا"],
    ["image", "تصاویر"],
    ["link", "پیوندها"],
    ["seo", "SEO"],
    ...(page.models.length ? [["models", "مدیریت مدل‌ها"]] : []),
  ];
  const shared = (field) =>
    ["منو و نشان برند", "پاورقی و اطلاعات تماس"].includes(field.group);
  const filtered = page.fields
    .filter(
      (f) =>
        f.kind === state.tab &&
        (!state.filter ||
          `${f.label} ${f.value} ${f.group}`.includes(state.filter)),
    )
    .sort((a, b) => Number(shared(a)) - Number(shared(b)));
  let form = "";
  if (state.tab === "models") {
    form = `<div class="panel"><h2>مدل‌های کاتالوگ</h2><p class="subtle">برای افزودن مدل، از یک مدل مشابه نسخه بگیرید و مشخصات و تصویر آن را پیش از ثبت کامل کنید.</p>${page.models.map((m) => `<div class="model-row"><img src="${esc(imageURL(m.image))}" width="48" height="60" alt=""><div class="model-info"><strong>${esc(m.name)}</strong></div><div class="actions"><button class="btn small" data-model-up="${esc(m.id)}" aria-label="انتقال ${esc(m.name)} به بالا">↑</button><button class="btn small" data-model-copy="${esc(m.id)}">ساخت مدل مشابه</button><button class="btn small danger" data-model-remove="${esc(m.id)}">حذف</button></div></div>`).join("")}${state.operations.length ? `<div class="change-list"><strong>عملیات در انتظار ثبت</strong>${state.operations.map((op) => `<p>${esc(op.type === "duplicate" ? "مدل جدید: " + op.name : op.type === "remove" ? "حذف: " + op.id : "جابجایی: " + op.id)}</p>`).join("")}<button class="btn small" data-action="clear-operations">لغو این عملیات</button></div>` : ""}</div>`;
  } else if (state.tab === "image") {
    form = filtered
      .map(
        (f) =>
          `<section class="image-edit"><div class="image-edit-head"><img src="${esc(imageURL(f.value))}" width="94" height="108" alt="${esc(f.alt)}"><div><h3>${esc(f.label)}</h3><p class="subtle">${esc(f.group)}</p><button class="btn small" data-pick="${f.id}">${icon("image")}تغییر تصویر</button></div></div><div class="form-group"><label for="alt-${f.id}">توضیح تصویر برای دسترس‌پذیری</label><input id="alt-${f.id}" data-alt="${f.id}" value="${esc(f.alt)}" maxlength="500"><small>آنچه در تصویر دیده می‌شود را کوتاه توضیح دهید.</small></div></section>`,
      )
      .join("");
  } else {
    const groups = new Map();
    for (const field of filtered) {
      if (!groups.has(field.group)) groups.set(field.group, []);
      groups.get(field.group).push(field);
    }
    let mainGroup = 0;
    for (const [name, fields] of groups) {
      const open = state.filter || (!shared(fields[0]) && mainGroup++ === 0);
      form += `<details class="field-block" ${open ? "open" : ""}><summary>${esc(name)} <span class="tag gray">${number(fields.length)}</span></summary><div class="field-block-content">${fields
        .map((f) => {
          const input = `id="field-${f.id}" data-field="${f.id}" ${f.kind === "link" || f.id === "seo-image" ? 'dir="ltr"' : ""} maxlength="${f.kind === "seo" ? (f.id === "seo-title" ? 200 : f.id === "seo-image" ? 2000 : 500) : 12000}"`;
          const area =
            (f.kind === "text" && f.value.length > 80) ||
            f.id === "seo-description";
          return `<div class="form-group"><label for="field-${f.id}">${esc(f.label)}${f.kind === "seo" && f.id !== "seo-image" ? `<small data-counter="${f.id}">${number(f.value.length)} نویسه</small>` : ""}</label>${area ? `<textarea ${input} rows="${f.value.length > 250 ? 5 : 3}">${esc(f.value)}</textarea>` : `<input ${input} value="${esc(f.value)}">`}${f.id === "seo-title" ? "<small>عنوانی روشن و کوتاه انتخاب کنید؛ معمولاً نزدیک به ۶۰ نویسه.</small>" : f.id === "seo-description" ? "<small>توضیحی مفید درباره محتوای صفحه؛ معمولاً نزدیک به ۱۵۵ نویسه.</small>" : f.id === "seo-image" ? "<small>آدرس یک تصویر از کتابخانه، با https://luxtowelco.com یا /assets/.</small>" : ""}</div>`;
        })
        .join("")}</div></details>`;
    }
  }
  shell(
    heading(
      pageInfo(page).name,
      "ویرایش ساده محتوا؛ ساختار و ظاهر سایت حفظ می‌شود.",
      `<button class="btn" data-action="save-draft">${icon("save")}ذخیره پیش‌نویس</button><button class="btn primary" data-action="publish">${icon("check")}${state.session.mode === "local" ? "ذخیره در پروژه" : "انتشار تغییرات"}</button>`,
    ) +
      `${page.restoreCommit ? '<div class="banner">نسخه قبلی به‌صورت پیش‌نویس باز شده است. برای بازگرداندن آن، نتیجه را بررسی و ثبت کنید.</div>' : ""}<div class="editor-meta"><span class="mono">${esc(page.route)}</span><span id="draft-status">${updates().length ? "پیش‌نویس بازیابی شد" : "بدون تغییر جدید"}</span><button class="btn text small" data-action="export">دانلود پیش‌نویس</button><button class="btn text small" data-action="import">بارگذاری پیش‌نویس</button><button class="btn text small" data-action="discard">کنار گذاشتن پیش‌نویس</button></div><div class="tabs">${kinds.map(([id, label]) => `<button class="${state.tab === id ? "active" : ""}" data-tab="${id}">${label}${id === "models" ? "" : ` <span class="subtle">${number(page.fields.filter((f) => f.kind === id).length)}</span>`}</button>`).join("")}</div><div class="editor-grid"><div><div class="search" style="margin-bottom:18px">${icon("search")}<input class="control" id="field-search" placeholder="جست‌وجو در فیلدها…" aria-label="جست‌وجو در فیلدها" value="${esc(state.filter)}"></div>${form || '<div class="panel empty">موردی پیدا نشد.</div>'}</div><aside class="editor-preview"><div class="preview-bar"><span>${icon("eye")} پیش‌نمایش صفحه</span><button data-action="preview">به‌روزرسانی پیش‌نمایش</button></div><div class="preview-bar"><span>اندازه نمایش</span><div class="actions"><button data-size="desktop">دسکتاپ</button><button data-size="mobile">موبایل</button></div></div><div class="preview-window"><iframe id="preview" title="پیش‌نمایش تغییرات" sandbox="allow-same-origin" hidden></iframe><div class="preview-placeholder" id="preview-placeholder">${icon("eye")}پیش‌نمایش شامل تغییرات منتشرنشده شماست.<br><button class="btn soft small" data-action="preview">نمایش نتیجه</button></div></div></aside></div>`,
  );
}
async function openPage(path, ref) {
  await ensureDraftSaved();
  state.view = path.includes("/catalog/")
    ? "catalog"
    : path.includes("/blog/")
      ? "blog"
      : "pages";
  state.filter = "";
  state.tab = "text";
  const page = await api(
    `/page?path=${encodeURIComponent(path)}${ref ? "&ref=" + ref : ""}`,
  );
  const draft=ref?null:await draftRead(`${state.session.user.username}:${path}`);
  state.page = page;
  state.original = structuredClone(page);
  state.operations = [];
  state.images = [];
  state.article = null;
  if (!ref) {
    if (draft?.page?.path === path) {
      state.page = draft.page;
      state.original = draft.original;
      state.operations = draft.operations || [];
      state.images = draft.images || [];
      if (draft.page.revision !== page.revision)
        notice(
          "نسخه سایت جدیدتر از پیش‌نویس است. پیش‌نویس را دانلود کنید؛ سپس نسخه تازه را باز کنید.",
          true,
        );
      else notice("پیش‌نویس قبلی شما بازیابی شد.");
    }
  }
  draftSafety.reset();draftRecovery.clear();
  renderEditor();
  if(ref)changed();
  window.scrollTo(0, 0);
}
async function showPreview() {
  const sequence = ++previewSequence;
  const result = await api("/preview", payload());
  if (sequence !== previewSequence) return;
  const frame = $("#preview");
  if (!frame) return;
  frame.srcdoc = result.html;
  frame.hidden = false;
  $("#preview-placeholder").hidden = true;
  sizePreview(frame.dataset.device || "desktop");
}
function sizePreview(device) {
  const frame = $("#preview");
  if (!frame) return;
  frame.dataset.device = device;
  const width = device === "mobile" ? 375 : 1280;
  const available = frame.parentElement.getBoundingClientRect().width;
  const scale = Math.min(1, available / width);
  frame.style.width = width + "px";
  frame.style.maxWidth = "none";
  frame.style.height = 620 / scale + "px";
  frame.style.zoom = scale;
}
function confirmation(title, message, accept = "تأیید", danger = false) {
  const dialog = $("#confirm-dialog");
  dialog.className = "dialog-small";
  dialog.innerHTML = `<h2 id="confirm-title">${esc(title)}</h2><p>${esc(message)}</p><div class="dialog-actions"><button class="btn" data-dialog-no>انصراف</button><button class="btn ${danger ? "danger" : "primary"}" data-dialog-yes>${esc(accept)}</button></div>`;
  return new Promise((resolve) => {
    dialog.showModal();
    dialog.oncancel = (event) => {
      event.preventDefault();
      dialog.close();
      resolve(false);
    };
    $("[data-dialog-no]", dialog).onclick = () => {
      dialog.close();
      resolve(false);
    };
    $("[data-dialog-yes]", dialog).onclick = () => {
      dialog.close();
      resolve(true);
    };
  });
}
async function publish() {
  if (state.session.user.role !== "admin")
    throw new Error(
      "برای انتشار، پیش‌نویس را دانلود و به مدیر بدهید. دسترسی شما ویرایشگر است.",
    );
  const local = state.session.mode === "local";
  if (
    !(await confirmation(
      local ? "ذخیره تغییرات در پروژه؟" : "تغییرات روی سایت منتشر شوند؟",
      local
        ? "فایل‌های همین پروژه محلی به‌روزرسانی می‌شوند. انتشار روی دامنه بعد از commit و push انجام می‌شود."
        : "تغییرات در GitHub ثبت می‌شوند و Cloudflare انتشار را شروع می‌کند. نتیجه را ابتدا در پیش‌نمایش بررسی کنید.",
      local ? "ذخیره در پروژه" : "ثبت و انتشار",
    ))
  )
    return;
  $("#app").inert = true;
  const version = state.draftVersion,
    key = draftKey();
  const result = await api("/publish", payload());
  if (version === state.draftVersion) await draftWrite(key, null);
  state.images = [];
  state.operations = [];
  state.page = null;
  state.original = null;
  state.article = null;
  state.library = await api("/library");
  await openPage(result.path);
  notice(result.message);
  if (result.mode === "github") {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.textContent =
      "تغییرات ثبت شدند. آماده‌شدن نسخه زنده ممکن است چند دقیقه طول بکشد. ";
    const link = document.createElement("a");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "مشاهده ثبت تغییرات";
    banner.append(link);
    $("#content").prepend(banner);
  }
}
async function optimizeImage(file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error(
      "یک تصویر JPG، PNG یا WebP با حجم کمتر از ۲۰ مگابایت انتخاب کنید.",
    );
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.88),
  );
  if (!blob || blob.type !== "image/webp" || blob.size > 4 * 1024 * 1024)
    throw new Error(
      "تصویر برای بارگذاری آماده نشد؛ تصویر کوچک‌تری انتخاب کنید.",
    );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return {
    path: `public/assets/uploads/${hash}.webp`,
    mime: "image/webp",
    data,
    width: canvas.width,
    height: canvas.height,
    preview: `data:image/webp;base64,${data}`,
    name: file.name,
  };
}
function chooseUpload(onComplete) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.onchange = async () => {
    try {
      if (!input.files[0]) return;
      if (state.images.length >= 8)
        throw new Error("پیش از افزودن تصویر بیشتر، تغییرات فعلی را ثبت کنید.");
      notice("در حال آماده‌سازی تصویر…");
      const image = await optimizeImage(input.files[0]);
      if (!state.images.some((i) => i.path === image.path))
        state.images.push(image);
      changed();
      await onComplete(image);
      notice("تصویر آماده شد و همراه با تغییرات صفحه ثبت می‌شود.");
    } catch (error) {
      notice(error.message, true);
    }
  };
  input.click();
}
async function setImage(fieldId, image) {
  let width = image.width,
    height = image.height;
  if (!width || !height) {
    const img = new Image();
    img.src = image.url;
    await img.decode();
    width = img.naturalWidth;
    height = img.naturalHeight;
  }
  if (fieldId === "article") {
    state.article.image = image.url || "/" + image.path.slice(7);
    state.article.width = width;
    state.article.height = height;
  } else {
    const field = state.page.fields.find((f) => f.id === fieldId);
    field.value = image.url || "/" + image.path.slice(7);
    field.width = width;
    field.height = height;
  }
  changed();
  state.article ? renderArticle() : renderEditor();
}
function mediaItems() {
  return [
    ...state.images.map((i) => ({
      ...i,
      url: "/" + i.path.slice(7),
      pending: true,
    })),
    ...state.library.images,
  ];
}
function mediaTiles(items, picker = false) {
  return items
    .map(
      (image) =>
        `<button class="media-tile" ${picker ? "data-select-image" : "data-media-detail"}="${esc(image.path)}"><img src="${esc(image.preview || image.url)}" width="240" height="300" alt="${esc(image.name || image.path.split("/").at(-1))}" loading="lazy">${image.pending ? '<span class="tag gold">پیش‌نویس</span>' : ""}<p>${esc(image.name || image.path.split("/").at(-1))}</p></button>`,
    )
    .join("");
}
function openMedia(fieldId) {
  const dialog = $("#media-dialog");
  dialog.className = "media-picker";
  dialog.innerHTML = `<button class="dialog-close" data-close-media aria-label="بستن">×</button><h2 id="media-title">یک تصویر انتخاب کنید</h2><p>تصویر تازه به‌صورت خودکار برای وب بهینه می‌شود.</p><div class="toolbar"><div class="search">${icon("search")}<input class="control" id="media-filter" placeholder="جست‌وجوی نام تصویر…" aria-label="جست‌وجوی نام تصویر"></div><button class="btn primary" data-dialog-upload>${icon("plus")}تصویر جدید</button></div><div class="media-grid">${mediaTiles(mediaItems(), true)}</div>`;
  dialog.showModal();
  $("[data-close-media]", dialog).onclick = () => dialog.close();
  $("[data-dialog-upload]", dialog).onclick = () =>
    chooseUpload(async (image) => {
      dialog.close();
      await setImage(fieldId, image);
    });
  $("#media-filter", dialog).oninput = (event) =>
    ($(".media-grid", dialog).innerHTML = mediaTiles(
      mediaItems().filter((i) =>
        (i.name || i.path)
          .toLowerCase()
          .includes(event.target.value.toLowerCase()),
      ),
      true,
    ));
  dialog.onclick = async (event) => {
    const button = event.target.closest("[data-select-image]");
    if (button) {
      try {
        const image = mediaItems().find(
          (i) => i.path === button.dataset.selectImage,
        );
        dialog.close();
        await setImage(fieldId, image);
      } catch (error) {
        notice("تصویر بارگذاری نشد؛ دوباره انتخاب کنید.", true);
      }
    }
  };
}
function renderMedia() {
  shell(
    heading(
      "کتابخانه تصاویر",
      "تصاویر فعلی سایت را ببینید و برای استفاده در صفحه‌ها انتخاب کنید.",
    ) +
      `<div class="help-strip">${icon("image")}<p><strong>برای افزودن یا جایگزینی عکس</strong>صفحه موردنظر را باز کنید؛ در بخش «تصاویر»، روی «تغییر تصویر» بزنید و عکس تازه را بارگذاری کنید. عکس همراه با همان صفحه ثبت می‌شود.</p></div><div class="toolbar" style="margin-top:24px"><div class="search">${icon("search")}<input class="control" id="library-filter" placeholder="جست‌وجوی نام تصویر…" aria-label="جست‌وجوی تصویر"></div><span class="subtle">${number(state.library.images.length)} تصویر</span></div><div class="media-grid" id="library-grid">${mediaTiles(mediaItems())}</div>`,
  );
}
function mediaDetail(path) {
  const image = mediaItems().find((i) => i.path === path);
  const dialog = $("#media-dialog");
  dialog.className = "";
  dialog.innerHTML = `<button class="dialog-close" data-close-media aria-label="بستن">×</button><h2 id="media-title">مشخصات تصویر</h2><div class="media-detail"><img src="${esc(image.preview || image.url)}" alt="${esc(image.path.split("/").at(-1))}"><div><div class="form-group"><label for="image-path">آدرس استفاده در سایت</label><input id="image-path" dir="ltr" readonly value="${esc(image.url)}"></div><p>برای استفاده، تصویر را از بخش «تصاویر» صفحه انتخاب کنید.</p><a class="btn" href="${esc(image.preview || image.url)}" target="_blank" rel="noopener">مشاهده اندازه اصلی</a></div></div>`;
  dialog.showModal();
  $("[data-close-media]", dialog).onclick = () => dialog.close();
}
function renderArticle() {
  const article = state.article;
  const fields = [
    ["title", "عنوان مقاله", "text"],
    ["slug", "آدرس کوتاه انگلیسی", "text"],
    ["description", "توضیح کوتاه برای معرفی و Google", "textarea"],
    ["body", "متن مقاله", "textarea"],
    ["alt", "توضیح تصویر", "text"],
  ];
  shell(
    heading(
      "مقاله جدید",
      "مقاله، تصویر، صفحه مجله و نقشه سایت با هم به‌روزرسانی می‌شوند.",
      `<button class="btn" data-action="save-draft">ذخیره پیش‌نویس</button><button class="btn primary" data-action="publish">${state.session.mode === "local" ? "ذخیره در پروژه" : "انتشار مقاله"}</button>`,
    ) +
      `<div class="editor-meta"><span id="draft-status">پیش‌نویس مقاله</span><button class="btn text small" data-action="export">دانلود پیش‌نویس</button><button class="btn text small" data-action="import">بارگذاری پیش‌نویس</button></div><div class="editor-grid"><div class="panel"><div class="form-group"><label for="article-locale">زبان مقاله</label><select id="article-locale" data-article="locale"><option value="fa" ${article.locale === "fa" ? "selected" : ""}>فارسی</option><option value="en" ${article.locale === "en" ? "selected" : ""}>English</option></select></div>${fields.map(([id, label, type]) => `<div class="form-group"><label for="article-${id}">${label}</label>${type === "textarea" ? `<textarea id="article-${id}" data-article="${id}" rows="${id === "body" ? 15 : 3}" maxlength="${id === "body" ? 100000 : 500}">${esc(article[id])}</textarea>` : `<input id="article-${id}" data-article="${id}" ${id === "slug" ? 'dir="ltr" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"' : ""} maxlength="${id === "slug" ? 100 : 180}" value="${esc(article[id])}">`}${id === "body" ? "<small>بین بندها یک خط خالی بگذارید. برای تیتر بخش از ## و برای فهرست از - در ابتدای خط استفاده کنید.</small>" : id === "slug" ? "<small>نمونه: towel-care-guide</small>" : ""}</div>`).join("")}<div class="image-edit-head"><img src="${esc(imageURL(article.image))}" width="94" height="108" alt="${esc(article.alt)}"><button class="btn" data-pick="article">انتخاب تصویر مقاله</button></div></div><aside class="editor-preview"><div class="preview-bar"><span>پیش‌نمایش مقاله</span><button data-action="preview">نمایش نتیجه</button></div><div class="preview-window"><iframe id="preview" title="پیش‌نمایش مقاله" sandbox="allow-same-origin" hidden></iframe><div id="preview-placeholder" class="preview-placeholder">${icon("blog")}برای نمایش نتیجه، عنوان، آدرس و متن را وارد کنید.<br><button class="btn soft small" data-action="preview">نمایش نتیجه</button></div></div></aside></div>`,
  );
}
async function newArticle() {
  await ensureDraftSaved();
  const draft=await draftRead(`${state.session.user.username}:new-article`);
  state.page = null;
  state.original = null;
  state.operations = [];
  state.images = [];
  state.article = {
    locale: state.language,
    slug: "",
    title: "",
    description: "",
    body: "",
    image: "/assets/images/blog/luxury-towel-set.webp",
    alt: "",
    width: 900,
    height: 1200,
  };
  if (draft?.article) {
    state.article = draft.article;
    state.images = draft.images || [];
    notice("پیش‌نویس مقاله قبلی بازیابی شد.");
  }
  draftSafety.reset();draftRecovery.clear();
  renderArticle();
}
async function renderHistory(path) {
  const selected = path || state.page?.path || "public/index.html";
  const result = await api("/history?path=" + encodeURIComponent(selected));
  shell(
    heading(
      "تاریخچه تغییرات",
      "نسخه‌های قبلی محفوظ‌اند؛ می‌توانید یک نسخه را باز کنید و پس از بررسی بازگردانید.",
    ) +
      `<div class="panel"><div class="form-group"><label for="history-page">صفحه موردنظر</label><select id="history-page">${state.library.pages.map((p) => `<option value="${esc(p.path)}" ${p.path === selected ? "selected" : ""}>${esc(pageInfo(p).name)} — ${esc(p.route)}</option>`).join("")}</select></div>${result.entries.map((entry) => `<div class="history-row"><div><p dir="auto">${esc(entry.message)}</p><small>${new Date(entry.date).toLocaleString("fa-IR")} · <span class="mono">${entry.sha.slice(0, 7)}</span></small></div><button class="btn small" data-history-ref="${entry.sha}" data-history-path="${esc(selected)}">باز کردن این نسخه</button></div>`).join("") || '<div class="empty">هنوز تغییری ثبت نشده است.</div>'}</div>`,
  );
}
async function renderContacts() {
  const contacts=await api("/contacts"),draft=await draftRead(`${state.session.user.username}:contacts`);
  state.contacts=draft?.contacts||contacts;
  const labels = {
    phone: "شماره تماس با کد کشور",
    email: "ایمیل",
    whatsapp: "لینک واتساپ",
    instagram: "لینک Instagram",
    telegram: "لینک Telegram",
    bale: "لینک بله",
    address: "آدرس فارسی",
  };
  shell(
    heading(
      "اطلاعات تماس",
      "تغییرات این بخش به‌صورت یکجا روی همه صفحات اعمال می‌شوند.",
    ) +
      `<div class="panel help-content"><form id="contacts-form">${Object.entries(
        labels,
      )
        .map(
          ([key, label]) =>
            `<div class="form-group"><label for="contact-${key}">${label}</label><input id="contact-${key}" name="${key}" ${key !== "address" ? 'dir="ltr"' : ""} value="${esc(state.contacts.values[key])}" maxlength="${key === "address" ? 300 : 500}" required></div>`,
        )
        .join(
          "",
        )}<button class="btn primary" type="submit">${state.session.mode === "local" ? "ذخیره اطلاعات در پروژه" : "انتشار اطلاعات تماس"}</button></form></div>`,
  );
  draftSafety.reset();draftRecovery.clear();
  if(draft?.contacts&&draft.contacts.head!==contacts.head)notice('نسخه سایت جدیدتر از پیش‌نویس تماس است؛ مقادیر قبلی حفظ شدند. پیش از ثبت آن‌ها را بررسی کنید.',true);
}
function renderHelp() {
  shell(
    heading("راهنمای استفاده", "کارهای روزمره سایت، بدون نیاز به ویرایش کد.") +
      `<div class="panel help-content"><h2>ویرایش متن و تصویر</h2><ol><li>از «صفحات سایت» صفحه موردنظر و زبان آن را انتخاب کنید.</li><li>در بخش «محتوا» متن‌ها را تغییر دهید. در بخش «تصاویر» عکس را انتخاب یا بارگذاری کنید و توضیح تصویر را بنویسید.</li><li>«نمایش نتیجه» را بزنید. پیش‌نمایش روی سایت عمومی تأثیری ندارد.</li><li>برای ادامه در زمان دیگر، «ذخیره پیش‌نویس» را بزنید. پیش‌نویس در همین مرورگر و برای همین حساب ذخیره می‌شود؛ با پاک‌کردن داده‌های مرورگر حذف خواهد شد.</li><li>وقتی آماده بودید، «${state.session.mode === "local" ? "ذخیره در پروژه" : "انتشار تغییرات"}» را بزنید. ${state.session.mode === "local" ? "در حالت محلی، فایل‌های پوشه پروژه به‌روزرسانی می‌شوند. برای انتشار نهایی، توسعه‌دهنده باید commit و push کند." : "پس از ثبت، آماده‌شدن نسخه زنده در Cloudflare ممکن است چند دقیقه زمان ببرد."}</li></ol><h2>مدل‌ها و مقاله‌ها</h2><p>ویژگی‌ها، توضیحات، قیمت‌ها و تصاویر مدل‌ها در «کاتالوگ مدل‌ها» قابل ویرایش‌اند. در «مدیریت مدل‌ها» می‌توانید از مدل مشابه نسخه بگیرید، ترتیب را تغییر دهید یا مدل را حذف کنید. سپس صفحه را دوباره باز کنید و اطلاعات مدل جدید را تکمیل کنید.</p><p>برای افزودن مقاله از «مجله و مقاله‌ها» و «مقاله جدید» استفاده کنید. عنوان، آدرس انگلیسی، توضیح کوتاه، متن و تصویر را وارد کنید. صفحه مجله و نقشه سایت هنگام ثبت خودکار به‌روزرسانی می‌شوند.</p><h2>SEO و اطلاعات تماس</h2><p>در بخش SEO هر صفحه عنوان Google، توضیح کوتاه و تصویر اشتراک‌گذاری را تغییر دهید. لینک‌ها، شماره تماس و شبکه‌های اجتماعی را از «اطلاعات تماس» به‌صورت یکجا به‌روز کنید.</p><h2>پیش‌نویس مشترک و بازگردانی</h2><p>برای ارسال پیش‌نویس به مدیر یا جابه‌جایی بین دستگاه‌ها، آن را دانلود کنید. مدیر همان صفحه را باز می‌کند و «بارگذاری پیش‌نویس» را می‌زند. در صورت تغییر نسخه سایت، ابتدا نسخه تازه را بررسی کنید؛ پنل تغییرات هم‌زمان را روی هم بازنویسی نمی‌کند.</p><p>از «تاریخچه تغییرات» نسخه قبلی صفحه را باز کنید، بررسی کنید و دوباره ثبت کنید. این کار تاریخچه را نگه می‌دارد.</p><h2>حساب مدیر و ویرایشگر</h2><p>مدیر می‌تواند منتشر کند. ویرایشگر می‌تواند پیش‌نویس تهیه و برای مدیر ارسال کند. ساخت حساب و تغییر رمز توسط مسئول فنی و از تنظیمات امن سرور انجام می‌شود.</p></div>`,
  );
}
function renderLogin() {
  closeNavigation(false);
  const configured = state.session.configured;
  $("#app").innerHTML =
    `<main id="content" class="login-page"><section class="login-form"><div class="brand"><img src="/assets/images/brand/baran-logo.c01f592bc1.png" alt="باران" width="52" height="52"><div><strong>مدیریت باران</strong><small>LUXTOWELCO</small></div></div><h1>به فضای مدیریت خوش آمدید.</h1><p>برای ویرایش محتوا و تصاویر سایت وارد شوید.</p>${!configured ? '<div class="banner">ورود پنل هنوز فعال نشده است. مسئول فنی باید حساب‌های مدیر و دسترسی امن انتشار را روی سرور تنظیم کند.</div>' : ""}<form id="login-form"><div class="form-group"><label for="username">نام کاربری</label><input id="username" name="username" dir="ltr" autocomplete="username" maxlength="50" required></div><div class="form-group"><label for="password">رمز عبور</label><input id="password" name="password" type="password" dir="ltr" autocomplete="current-password" maxlength="200" required></div><p id="login-error" role="alert" class="subtle"></p><button class="btn primary" type="submit" ${!configured ? "disabled" : ""}>ورود به پنل ${icon("arrow")}</button></form><p class="login-note">این فضا خصوصی است. برای دریافت یا تغییر رمز با مدیر سایت تماس بگیرید.</p><a class="btn text" href="/">بازگشت به سایت</a></section><aside class="login-art"><img src="/assets/images/home/baran-hero.webp" width="896" height="1194" alt="تن‌پوش سبز باران"><div class="login-art-copy"><h2>روایت باران، در دست شما.</h2><p>هر تصویر تازه و هر کلمه، بخشی از تجربه‌ای است که می‌سازید.</p></div></aside></main>`;
}
async function navigate(view) {
  await ensureDraftSaved();
  state.view = view;
  state.filter = "";
  if (view === "catalog")
    return openPage(
      state.language === "en"
        ? "public/en/catalog/index.html"
        : "public/catalog/index.html",
    );
  if (view === "home") renderHome();
  else if (view === "pages" || view === "blog") renderPages();
  else if (view === "media") renderMedia();
  else if (view === "history") await renderHistory();
  else if (view === "contacts") await renderContacts();
  else renderHelp();
  window.scrollTo(0, 0);
}
function exportDraft() {
  const data = draftSnapshot();
  const blob = new Blob(
    [JSON.stringify({ format: "luxtowelco-draft-v1", ...data }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "baran-content-draft.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importDraft() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 16 * 1024 * 1024)
        throw new Error("فایل پیش‌نویس بسیار بزرگ است.");
      const draft = JSON.parse(await file.text());
      if (
        draft.format !== "luxtowelco-draft-v1" ||
        !Array.isArray(draft.images) ||
        !Array.isArray(draft.operations)
      )
        throw new Error("فایل پیش‌نویس معتبر نیست.");
      if (state.article) {
        if (!draft.article) throw new Error("پیش‌نویس باید مقاله جدید باشد.");
        state.article = draft.article;
      } else {
        if (
          draft.page?.path !== state.page.path ||
          draft.page.revision !== state.page.revision
        )
          throw new Error(
            "صفحه یا نسخه این پیش‌نویس با صفحه بازشده مطابقت ندارد.",
          );
        const allowed = new Map(state.page.fields.map((f) => [f.id, f]));
        for (const field of draft.page.fields) {
          const current = allowed.get(field.id);
          if (
            !current ||
            field.kind !== current.kind ||
            typeof field.value !== "string"
          )
            throw new Error("ساختار پیش‌نویس معتبر نیست.");
          current.value = field.value;
          if (current.kind === "image") {
            current.alt = field.alt;
            current.width = field.width;
            current.height = field.height;
          }
        }
        state.page.restoreCommit = draft.page.restoreCommit;
        state.operations = draft.operations;
      }
      state.images = draft.images;
      changed();
      await saveDraft(true);
      state.article ? renderArticle() : renderEditor();
      notice("پیش‌نویس بارگذاری شد. نتیجه را پیش از ثبت بررسی کنید.");
    } catch (error) {
      notice(error.message, true);
    }
  };
  input.click();
}
async function duplicateModel(id) {
  const dialog = $("#confirm-dialog");
  dialog.className = "";
  const fields = state.page.fields.filter(
    (f) =>
      f.model === id &&
      f.kind === "text" &&
      f.label !== "متن پیوند" &&
      !f.selector.endsWith("h2:nth-of-type(1)"),
  );
  const imageField = state.page.fields.find(
    (f) => f.model === id && f.kind === "image",
  );
  let chosenImage = null;
  dialog.innerHTML = `<h2 id="confirm-title">ساخت مدل مشابه</h2><p>اطلاعات مدل قبلی برای شروع کپی شده است؛ مشخصات، قیمت و تصویر را پیش از انتشار بررسی کنید.</p><form id="model-copy-form"><div class="form-group"><label for="model-name">نام مدل جدید</label><input id="model-name" name="name" maxlength="150" required></div><div class="form-group"><label for="model-id">شناسه کوتاه انگلیسی</label><input id="model-id" name="id" dir="ltr" pattern="[a-z0-9-]{1,80}" maxlength="80" required></div><div class="image-edit-head"><img id="model-picture" src="${esc(imageURL(imageField.value))}" width="94" height="108" alt="تصویر مدل جدید"><div><button class="btn small" type="button" data-copy-image>بارگذاری تصویر مدل جدید</button><p class="subtle">اگر عکس را تغییر ندهید، تصویر مدل مشابه استفاده می‌شود.</p></div></div>${fields.map((f) => `<div class="form-group"><label for="copy-${f.id}">${esc(f.label)}</label>${f.value.length > 100 ? `<textarea id="copy-${f.id}" data-copy-field="${f.id}" required maxlength="12000">${esc(f.value)}</textarea>` : `<input id="copy-${f.id}" data-copy-field="${f.id}" value="${esc(f.value)}" required maxlength="12000">`}</div>`).join("")}<div class="dialog-actions"><button type="button" class="btn" data-cancel-model>انصراف</button><button class="btn primary">افزودن به پیش‌نویس</button></div></form>`;
  dialog.showModal();
  $("[data-cancel-model]", dialog).onclick = () => dialog.close();
  $("[data-copy-image]", dialog).onclick = () =>
    chooseUpload(async (image) => {
      chosenImage = {
        value: "/" + image.path.slice(7),
        width: image.width,
        height: image.height,
      };
      $("#model-picture", dialog).src = image.preview;
    });
  $("#model-copy-form").onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (
      state.page.models.some((m) => m.id === data.get("id")) ||
      state.operations.some((op) => op.newId === data.get("id"))
    ) {
      notice("این شناسه قبلاً استفاده شده است.", true);
      return;
    }
    const overrides = [...dialog.querySelectorAll("[data-copy-field]")].map(
      (input) => ({ id: input.dataset.copyField, value: input.value }),
    );
    state.operations.push({
      type: "duplicate",
      id,
      newId: data.get("id"),
      name: data.get("name"),
      updates: overrides,
      image: chosenImage,
    });
    dialog.close();
    changed();
    renderEditor();
  };
}
document.addEventListener("input", (event) => {
  const target = event.target;
  if(target.closest('#contacts-form')){changed();return;}
  if (target.dataset.field) {
    const field = state.page.fields.find((f) => f.id === target.dataset.field);
    field.value = target.value;
    const counter = $(`[data-counter="${field.id}"]`);
    if (counter) counter.textContent = number(target.value.length) + " نویسه";
    changed();
  }
  if (target.dataset.alt) {
    state.page.fields.find((f) => f.id === target.dataset.alt).alt =
      target.value;
    changed();
  }
  if (target.dataset.article) {
    state.article[target.dataset.article] = target.value;
    changed();
  }
  if (target.id === "field-search") {
    state.filter = target.value;
    const position = target.selectionStart;
    renderEditor();
    const input = $("#field-search");
    input.focus();
    input.setSelectionRange(position, position);
  }
  if (target.id === "library-filter")
    $("#library-grid").innerHTML = mediaTiles(
      mediaItems().filter((i) =>
        i.path.toLowerCase().includes(target.value.toLowerCase()),
      ),
    );
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "history-page") {
    try {
      await renderHistory(event.target.value);
    } catch (error) {
      notice(error.message, true);
    }
  }
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  try {
    if (button.dataset.nav) {
      await navigate(button.dataset.nav);
      const title = $('#content h1');
      title?.setAttribute('tabindex', '-1');
      title?.focus({preventScroll:true});
      return;
    }
    if (button.dataset.open) return await openPage(button.dataset.open);
    if (button.dataset.language) {
      state.language = button.dataset.language;
      renderPages();
      return;
    }
    if (button.dataset.tab) {
      await ensureDraftSaved();
      state.tab = button.dataset.tab;
      state.filter = "";
      renderEditor();
      return;
    }
    if (button.dataset.pick) return openMedia(button.dataset.pick);
    if (button.dataset.size) {
      sizePreview(button.dataset.size);
      return;
    }
    if (button.dataset.mediaDetail)
      return mediaDetail(button.dataset.mediaDetail);
    if (button.dataset.historyRef)
      return await openPage(
        button.dataset.historyPath,
        button.dataset.historyRef,
      );
    if (button.dataset.modelCopy)
      return await duplicateModel(button.dataset.modelCopy);
    if (button.dataset.modelRemove) {
      if (
        await confirmation(
          "حذف مدل از کاتالوگ؟",
          "این مدل پس از ثبت تغییرات از کاتالوگ حذف می‌شود.",
          "افزودن حذف به پیش‌نویس",
          true,
        )
      ) {
        state.operations.push({
          type: "remove",
          id: button.dataset.modelRemove,
        });
        changed();
        renderEditor();
      }
      return;
    }
    if (button.dataset.modelUp) {
      state.operations.push({ type: "up", id: button.dataset.modelUp });
      changed();
      renderEditor();
      return;
    }
    const action = button.dataset.action;
    if (!action) return;
    if (action === "save-draft") await saveDraft();
    if (action === "preview") {
      button.disabled = true;
      try {
        await showPreview();
      } finally {
        button.disabled = false;
      }
    }
    if (action === "export") exportDraft();
    if (action === "import") importDraft();
    if (action === "new-article") await newArticle();
    if (action === "clear-operations") {
      state.operations = [];
      changed();
      renderEditor();
    }
    if (action === "publish") {
      if (state.busy) return;
      state.busy = true;
      button.disabled = true;
      try {
        await ensureDraftSaved();
        await publish();
      } finally {
        state.busy = false;
        $("#app").inert = false;
        button.disabled = false;
      }
    }
    if (
      action === "discard" &&
      (await confirmation(
        "پیش‌نویس کنار گذاشته شود؟",
        "نسخه فعلی سایت دوباره بارگذاری می‌شود.",
        "کنار گذاشتن",
        true,
      ))
    ) {
      const path = state.page.path;
      clearTimeout(saveTimer);
      await draftSaveChain.catch(()=>{});
      await draftWrite(draftKey(), null);
      draftSafety.reset();draftRecovery.clear();saveTimer=null;
      state.page = null;
      state.original = null;
      await openPage(path);
    }
    if (action === "logout") {
      await ensureDraftSaved();
      await api("/logout", {});
      state.session.user = null;
      renderLogin();
    }
  } catch (error) {
    notice(error.message, true);
  }
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "login-form") {
    event.preventDefault();
    const button = $('button[type="submit"]', event.target);
    button.disabled = true;
    try {
      const form = new FormData(event.target);
      await api("/login", {
        username: form.get("username"),
        password: form.get("password"),
      });
      event.target.reset();
      const next = adminDestination(new URL(location.href).searchParams.get('next'));
      if (next !== '/admin/') { location.replace(next); return; }
      history.replaceState(null, '', '/admin/');
      await boot();
    } catch (error) {
      $("#login-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
  if (event.target.id === "contacts-form") {
    event.preventDefault();
    if (
      !(await confirmation(
        "اطلاعات تماس همه صفحات تغییر کند؟",
        "شماره‌ها و پیوندهای تماس در همه صفحات سایت به‌روز می‌شوند.",
        "ثبت اطلاعات",
      ))
    )
      return;
    const button = $('button[type="submit"]', event.target);
    button.disabled = true;
    const app=$('#app');state.busy=true;app.inert=true;let committed=false;
    try {
      await ensureDraftSaved();
      const values = Object.fromEntries(new FormData(event.target));
      await api("/contacts", { head: state.contacts.head, values });
      committed=true;
      await draftWrite(`${state.session.user.username}:contacts`,null);
      state.library = await api("/library");
      await renderContacts();
      notice("اطلاعات تماس ثبت شد.");
    } catch (error) {
      notice(committed?'اطلاعات تماس ثبت شد؛ پاک‌سازی پیش‌نویس یا تازه‌سازی پنل انجام نشد. دوباره منتشر نکنید؛ نسخهٔ محلی را برای بررسی نگه دارید.':error.message, true);
    } finally {
      state.busy=false;app.inert=false;
      button.disabled = false;
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveDraft(true);
});
window.addEventListener("resize", () => {
  const frame = $("#preview");
  if (frame && !frame.hidden) sizePreview(frame.dataset.device || "desktop");
});
async function boot() {
  try {
    state.session = await api("/session");
    if (!state.session.user) {
      renderLogin();
      return;
    }
    const next = adminDestination(new URL(location.href).searchParams.get('next'));
    if (next !== '/admin/') { location.replace(next); return; }
    if (new URL(location.href).searchParams.has('next')) history.replaceState(null, '', '/admin/');
    state.library = await api("/library");
    renderHome();
  } catch (error) {
    $("#app").innerHTML =
      `<main class="boot" id="content"><h1>پنل آماده نشد</h1><p>${esc(error.message)}</p><button class="btn" data-retry>تلاش دوباره</button></main>`;
    $("[data-retry]").onclick = () => boot();
  }
}
await boot();
