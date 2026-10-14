import { parseHTML } from "linkedom";

export const SITE = "https://luxtowelco.com";
export class CMSFailure extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function pagePath(path) {
  if (
    typeof path !== "string" ||
    !/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(path) ||
    path.startsWith("public/admin/")
  ) {
    throw new CMSFailure("صفحه انتخاب‌شده معتبر نیست.");
  }
  return path;
}
export const routeFor = (path) =>
  "/" +
  pagePath(path)
    .slice(7)
    .replace(/index\.html$/, "");
const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const short = (value, max = 65) => clean(value).slice(0, max);
const limit = (value, max = 12000) => {
  if (typeof value !== "string" || value.length > max)
    throw new CMSFailure("طول یا نوع محتوا مجاز نیست.");
  return value;
};
export function safeURL(value, image = false) {
  limit(value, 2000);
  if (/[\u0000-\u0020\\]/.test(value) || value.startsWith("//"))
    throw new CMSFailure("آدرس پیوند معتبر نیست.");
  if (image) {
    if (
      !/^\/assets(?:-v[23])?\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpg|jpeg)$/i.test(
        value,
      ) ||
      value.includes("..")
    ) {
      throw new CMSFailure("تصویر را از کتابخانه تصاویر انتخاب کنید.");
    }
  } else if (!/^(?:\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(value)) {
    throw new CMSFailure("آدرس باید پیوند سایت، https، ایمیل یا تلفن باشد.");
  }
  return value;
}
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function locator(element) {
  const parts = [];
  for (
    let node = element;
    node && node.nodeType === 1;
    node = node.parentElement
  ) {
    const tag = node.localName;
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter((el) => el.localName === tag)
      : [node];
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
  }
  return parts.join(" > ");
}
function sectionName(el) {
  if (el.closest(".site-header, aside")) return "منو و نشان برند";
  if (el.closest("footer")) return "پاورقی و اطلاعات تماس";
  const section = el.closest("article, section");
  return short(
    section?.querySelector("h1, h2, h3")?.textContent ||
      section?.getAttribute("aria-label") ||
      "محتوای صفحه",
  );
}
function textLabel(el) {
  const tag = el.localName;
  if (tag === "dd")
    return (
      "مشخصه: " +
      short(el.parentElement.querySelector("dt")?.textContent || "مقدار")
    );
  if (el.closest(".price")) return "قیمت و توضیح قیمت";
  if (/^h[1-6]$/.test(tag)) return tag === "h1" ? "عنوان اصلی" : "عنوان بخش";
  if (tag === "summary") return "پرسش متداول";
  if (tag === "a" || el.closest("a")) return "متن پیوند";
  if (tag === "li") return "مورد فهرست";
  if (tag === "dt") return "نام مشخصه";
  if (tag === "figcaption") return "زیرنویس تصویر";
  return "متن";
}
function collect(document) {
  const fields = [];
  const add = (element, kind, label, value, extra = {}) =>
    fields.push({
      id: `${kind}-${fields.length}`,
      kind,
      label,
      value,
      group: sectionName(element),
      selector: locator(element),
      model: element.closest(".product-card")?.id,
      ...extra,
    });
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("script, style, noscript, svg, dialog, [hidden]")) continue;
    if (el.matches("img") && el.getAttribute("src")) {
      add(
        el,
        "image",
        short(el.getAttribute("alt")) || "تصویر",
        el.getAttribute("src"),
        {
          alt: el.getAttribute("alt") || "",
          width: Number(el.getAttribute("width")) || 640,
          height: Number(el.getAttribute("height")) || 640,
        },
      );
    }
    if (el.matches("a[href]") && !el.classList.contains("skip-link"))
      add(
        el,
        "link",
        short(el.textContent || el.getAttribute("aria-label")) || "پیوند",
        el.getAttribute("href"),
      );
    [...el.childNodes].forEach((node, childIndex) => {
      if (
        node.nodeType !== 3 ||
        !clean(node.textContent) ||
        !el.closest("main,header,footer,aside") ||
        el.matches("button,option")
      )
        return;
      add(el, "text", textLabel(el), clean(node.textContent), { childIndex });
    });
  }
  const seo = [
    ["title", "عنوان در Google"],
    ['meta[name="description"]', "توضیح کوتاه در Google"],
    ['meta[property="og:image"]', "تصویر اشتراک‌گذاری"],
  ];
  for (const [selector, label] of seo) {
    const el = document.querySelector(selector);
    if (el)
      fields.push({
        id: `seo-${selector === "title" ? "title" : selector.includes("description") ? "description" : "image"}`,
        kind: "seo",
        group: "تنظیمات SEO",
        label,
        value:
          selector === "title"
            ? el.textContent
            : el.getAttribute("content") || "",
        selector,
      });
  }
  return fields;
}
function modelList(document) {
  return [...document.querySelectorAll(".product-card[id]")].map((el) => ({
    id: el.id,
    name: clean(el.querySelector("h2")?.textContent),
    image: el.querySelector("img")?.getAttribute("src"),
  }));
}
export function describePage(html, path, revision, extra = {}) {
  const { document } = parseHTML(html);
  return {
    path: pagePath(path),
    route: routeFor(path),
    title: document.title,
    language: document.documentElement.lang || "fa",
    revision,
    fields: collect(document),
    models: modelList(document),
    ...extra,
  };
}
function replaceSchema(document, oldValue, newValue) {
  if (!oldValue || oldValue === newValue) return;
  const transform = (value) => {
    if (typeof value === "string")
      return clean(value) === clean(oldValue) ? newValue : value;
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, transform(val)]),
      );
    return value;
  };
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      script.textContent = JSON.stringify(
        transform(JSON.parse(script.textContent)),
      ).replace(/</g, "\\u003c");
    } catch {
      throw new CMSFailure("ساختار SEO صفحه نیاز به بررسی دارد.");
    }
  }
}
function setSEO(document, kind, value) {
  const selectors =
    kind === "title"
      ? ["title", 'meta[property="og:title"]', 'meta[name="twitter:title"]']
      : kind === "description"
        ? [
            'meta[name="description"]',
            'meta[property="og:description"]',
            'meta[name="twitter:description"]',
          ]
        : ['meta[property="og:image"]', 'meta[name="twitter:image"]'];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el)
      selector === "title"
        ? (el.textContent = value)
        : el.setAttribute("content", value);
  }
}
function changeImage(document, el, update) {
  const old = el.getAttribute("src");
  const src = safeURL(update.value, true);
  el.setAttribute("src", src);
  el.setAttribute(
    "alt",
    limit(update.alt ?? el.getAttribute("alt") ?? "", 500),
  );
  if (old === src) return;
  const width = Number(update.width),
    height = Number(update.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8000 ||
    height > 8000
  )
    throw new CMSFailure("ابعاد تصویر معتبر نیست.");
  el.setAttribute("width", width);
  el.setAttribute("height", height);
  el.removeAttribute("srcset");
  el.removeAttribute("sizes");
  for (const source of el.closest("picture")?.querySelectorAll("source") || [])
    source.remove();
  for (const preload of document.querySelectorAll(
    'link[rel="preload"][as="image"]',
  )) {
    if (preload.getAttribute("href") !== old) continue;
    preload.setAttribute("href", src);
    preload.removeAttribute("imagesrcset");
    preload.removeAttribute("imagesizes");
  }
  for (const meta of document.querySelectorAll(
    'meta[property="og:image"], meta[name="twitter:image"]',
  )) {
    if (
      meta.getAttribute("content") === SITE + old ||
      meta.getAttribute("content") === old
    )
      meta.setAttribute("content", SITE + src);
  }
  for (const dimension of document.querySelectorAll(
    'meta[property="og:image:width"],meta[property="og:image:height"]',
  )) {
    dimension.setAttribute(
      "content",
      dimension.getAttribute("property").endsWith("width")
        ? String(width)
        : String(height),
    );
  }
  replaceSchema(document, SITE + old, SITE + src);
}
function syncModels(document) {
  const models = modelList(document);
  const index = document.querySelector(".model-index");
  if (index)
    index.innerHTML = models
      .map((m) => `<a href="#${esc(m.id)}">${esc(m.name)}</a>`)
      .join("");
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    const data = JSON.parse(script.textContent);
    for (const graph of data["@graph"] || []) {
      if (graph.mainEntity?.["@type"] === "ItemList") {
        graph.mainEntity.numberOfItems = models.length;
        graph.mainEntity.itemListElement = models.map((m, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: m.name,
          url: SITE + "/catalog/#" + m.id,
        }));
      }
    }
    script.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
  }
}
export function applyChanges(html, updates = [], operations = []) {
  if (
    !Array.isArray(updates) ||
    updates.length > 1500 ||
    !Array.isArray(operations) ||
    operations.length > 40
  )
    throw new CMSFailure("حجم تغییرات مجاز نیست.");
  const { document } = parseHTML(html);
  const known = new Map(collect(document).map((f) => [f.id, f]));
  const modelLocators = new Map(
    [...document.querySelectorAll(".product-card[id]")].map((model) => [
      model.id,
      locator(model),
    ]),
  );
  for (const update of updates) {
    const field = known.get(update.id);
    if (!field)
      throw new CMSFailure(
        "ساختار صفحه تغییر کرده است؛ نسخه جدید را بارگذاری کنید.",
        409,
      );
    const el = document.querySelector(field.selector);
    const value = limit(update.value);
    if (field.kind === "text") {
      if (!value.trim()) throw new CMSFailure("متن را خالی نگذارید.");
      const node = el.childNodes[field.childIndex];
      node.textContent = node.textContent.replace(
        node.textContent.trim(),
        value,
      );
      replaceSchema(document, field.value, value);
    } else if (field.kind === "link") el.setAttribute("href", safeURL(value));
    else if (field.kind === "image") changeImage(document, el, update);
    else {
      if (!value.trim()) throw new CMSFailure("تنظیم SEO نمی‌تواند خالی باشد.");
      const kind = field.id.slice(4);
      if (kind === "image") {
        const relative = value.startsWith(SITE)
          ? value.slice(SITE.length)
          : value;
        setSEO(document, kind, SITE + safeURL(relative, true));
      } else {
        limit(value, kind === "title" ? 200 : 500);
        setSEO(document, kind, value);
      }
      replaceSchema(document, field.value, value);
    }
  }
  for (const op of operations) {
    if (!/^[a-z0-9-]{1,80}$/.test(op.id))
      throw new CMSFailure("مدل انتخاب‌شده معتبر نیست.");
    const model = document.querySelector(`.product-card[id="${op.id}"]`);
    if (!model)
      throw new CMSFailure("مدل پیدا نشد؛ صفحه را دوباره باز کنید.", 409);
    if (op.type === "duplicate") {
      if (
        !/^[a-z0-9-]{1,80}$/.test(op.newId) ||
        document.getElementById(op.newId)
      )
        throw new CMSFailure("شناسه مدل جدید باید یکتا و انگلیسی باشد.");
      const copy = model.cloneNode(true);
      copy.id = op.newId;
      if (op.updates && (!Array.isArray(op.updates) || op.updates.length > 250))
        throw new CMSFailure("اطلاعات مدل تازه معتبر نیست.");
      const prefix = modelLocators.get(op.id) + " > ";
      for (const update of op.updates || []) {
        const field = known.get(update.id);
        if (!field || field.model !== op.id || field.kind !== "text")
          throw new CMSFailure("فیلد مدل تازه معتبر نیست.");
        const target = copy.querySelector(field.selector.slice(prefix.length));
        const node = target?.childNodes[field.childIndex];
        if (!node || node.nodeType !== 3)
          throw new CMSFailure("ساختار مدل تازه معتبر نیست.");
        const value = limit(update.value);
        if (!value.trim())
          throw new CMSFailure("مشخصات مدل تازه را خالی نگذارید.");
        node.textContent = node.textContent.replace(
          node.textContent.trim(),
          value,
        );
      }
      if (op.image) {
        const image = copy.querySelector("img");
        const src = safeURL(op.image.value, true);
        const width = Number(op.image.width),
          height = Number(op.image.height);
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width < 1 ||
          height < 1 ||
          width > 8000 ||
          height > 8000
        )
          throw new CMSFailure("ابعاد تصویر مدل تازه معتبر نیست.");
        image.setAttribute("src", src);
        image.setAttribute("alt", limit(op.image.alt || op.name, 500));
        image.setAttribute("width", width);
        image.setAttribute("height", height);
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");
      }
      copy.querySelector("h2").textContent = limit(op.name, 150);
      for (const link of copy.querySelectorAll("[data-product-name]")) {
        link.setAttribute("data-product-name", op.name);
        if (link.hasAttribute("data-inquiry-message"))
          link.setAttribute(
            "data-inquiry-message",
            `سلام، برای استعلام موجودی ${op.name} پیام می‌دهم.`,
          );
        link.textContent = `استعلام ${op.name} در ${link.getAttribute("data-channel") === "bale" ? "بله" : "واتساپ"}`;
      }
      model.after(copy);
    } else if (op.type === "remove") {
      if (modelList(document).length < 2)
        throw new CMSFailure("حداقل یک مدل باید باقی بماند.");
      model.remove();
    } else if (op.type === "up") {
      const previous = model.previousElementSibling;
      if (previous?.matches(".product-card")) previous.before(model);
    } else throw new CMSFailure("عملیات مدل معتبر نیست.");
  }
  if (document.querySelector(".product-card")) syncModels(document);
  return document.toString();
}
export function preview(html, images = []) {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script,iframe,noscript,form"))
    el.remove();
  for (const el of document.querySelectorAll("*")) {
    for (const attr of [...el.attributes])
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
  }
  for (const a of document.querySelectorAll("a")) {
    a.removeAttribute("target");
    a.removeAttribute("href");
  }
  for (const image of images)
    for (const el of document.querySelectorAll("img")) {
      if (el.getAttribute("src") === "/" + image.path.replace(/^public\//, ""))
        el.setAttribute("src", `data:${image.mime};base64,${image.data}`);
    }
  const style = document.createElement("style");
  style.textContent =
    ".reveal{opacity:1!important;transform:none!important}body{pointer-events:none}";
  document.head.append(style);
  return document.toString();
}
export function articleHTML(template, article) {
  const { document } = parseHTML(template);
  const { slug, locale = "fa" } = article;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    slug.length > 100 ||
    !["fa", "en"].includes(locale)
  )
    throw new CMSFailure("آدرس مقاله باید انگلیسی، کوتاه و با خط تیره باشد.");
  const title = limit(article.title, 180).trim(),
    description = limit(article.description, 500).trim();
  if (!title || !description || !article.body?.trim())
    throw new CMSFailure("عنوان، توضیح کوتاه و متن مقاله را وارد کنید.");
  const route = `${locale === "en" ? "/en" : ""}/blog/${slug}/`;
  const path = "public" + route + "index.html";
  const blocks = limit(article.body, 100000)
    .split(/\n\s*\n/)
    .map((block) => {
      if (block.startsWith("## ")) return `<h2>${esc(block.slice(3))}</h2>`;
      if (block.startsWith("- "))
        return (
          "<ul>" +
          block
            .split("\n")
            .map((line) => `<li>${esc(line.replace(/^- /, ""))}</li>`)
            .join("") +
          "</ul>"
        );
      return `<p>${esc(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  const image = safeURL(
    article.image || "/assets/images/blog/luxury-towel-set.webp",
    true,
  );
  document.querySelector("main").innerHTML =
    `<article class="article-shell"><nav class="breadcrumbs" aria-label="مسیر صفحه"><a href="${locale === "en" ? "/en/" : "/"}">${locale === "en" ? "Home" : "خانه"}</a> / <a href="${locale === "en" ? "/en/blog/" : "/blog/"}">${locale === "en" ? "Journal" : "مجله"}</a></nav><header class="article-header"><h1>${esc(title)}</h1><p class="lead">${esc(description)}</p></header><figure class="article-feature"><img src="${esc(image)}" width="${Number(article.width) || 900}" height="${Number(article.height) || 1200}" alt="${esc(article.alt || title)}" loading="lazy" decoding="async"></figure><div class="article-body">${blocks}</div></article>`;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  setSEO(document, "title", title);
  setSEO(document, "description", description);
  setSEO(document, "image", SITE + image);
  for (const el of document.querySelectorAll(
    'link[rel="alternate"],link[rel="preload"][as="image"],script[type="application/ld+json"]',
  ))
    el.remove();
  for (const el of document.querySelectorAll('link[rel="canonical"]'))
    el.setAttribute("href", SITE + route);
  for (const el of document.querySelectorAll('meta[property="og:url"]'))
    el.setAttribute("content", SITE + route);
  for (const el of document.querySelectorAll(".language-switcher"))
    el.setAttribute("href", locale === "fa" ? "/en/blog/" : "/blog/");
  const schema = document.createElement("script");
  schema.type = "application/ld+json";
  schema.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    inLanguage: locale,
    image: SITE + image,
    url: SITE + route,
    datePublished: new Date().toISOString().slice(0, 10),
    publisher: { "@type": "Organization", name: "Baran" },
  }).replace(/</g, "\\u003c");
  document.head.append(schema);
  return { path, html: document.toString(), route, title, description, image };
}
export function addArticleToIndex(html, article) {
  const { document } = parseHTML(html);
  const main = document.querySelector("main");
  if (!main?.querySelector(".blog-list"))
    throw new CMSFailure("ساختار فهرست مجله برای مقاله جدید آماده نیست.");
  const card = document.createElement("section");
  card.className = "section blog-list reveal";
  card.innerHTML = `<a class="blog-card-image" href="${esc(article.route)}"><img src="${esc(article.image)}" width="900" height="1200" alt="${esc(article.title)}" loading="lazy" decoding="async"></a><article class="blog-card"><h2><a href="${esc(article.route)}">${esc(article.title)}</a></h2><p>${esc(article.description)}</p><a class="button-link" href="${esc(article.route)}">${article.route.startsWith("/en/") ? "Read article" : "مطالعه مقاله"}</a></article>`;
  main.querySelector(".blog-list").before(card);
  return document.toString();
}

export function readContacts(html) {
  const { document } = parseHTML(html);
  const href = (selector) =>
    document.querySelector(selector)?.getAttribute("href") || "";
  return {
    phone: href('a[href^="tel:"]').slice(4),
    email: href('a[href^="mailto:"]').slice(7),
    whatsapp: href('a[href^="https://wa.me/"]').split("?")[0],
    instagram: href('a[href^="https://www.instagram.com/"]'),
    telegram: href('a[href^="https://t.me/"]'),
    bale:
      href('a[href^="https://ble.ir/"]') ||
      "https://ble.ir/baran_towel_bathrobe",
    address: clean(
      document.querySelector(
        '[aria-labelledby="footer-address"] address p:last-child span',
      )?.textContent,
    ),
  };
}
export function applyContacts(html, values) {
  if (
    !/^\+[0-9]{8,15}$/.test(values.phone) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)
  )
    throw new CMSFailure(
      "شماره تماس را با + و کد کشور و ایمیل را صحیح وارد کنید.",
    );
  const prefixes = {
    whatsapp: "https://wa.me/",
    instagram: "https://www.instagram.com/",
    telegram: "https://t.me/",
    bale: "https://ble.ir/",
  };
  for (const [key, prefix] of Object.entries(prefixes)) {
    if (!safeURL(values[key]).startsWith(prefix))
      throw new CMSFailure(
        "آدرس شبکه اجتماعی با سرویس انتخاب‌شده مطابقت ندارد.",
      );
  }
  const { document } = parseHTML(html);
  const before = readContacts(html);
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href.startsWith("tel:")) a.setAttribute("href", "tel:" + values.phone);
    else if (href.startsWith("mailto:")) {
      a.setAttribute("href", "mailto:" + values.email);
      a.textContent = values.email;
    } else
      for (const [key, prefix] of Object.entries(prefixes))
        if (href.startsWith(prefix)) {
          a.setAttribute(
            "href",
            key === "whatsapp"
              ? values[key].split("?")[0] +
                  (href.includes("?") ? "?" + href.split("?")[1] : "")
              : values[key],
          );
        }
  }
  const address = document.querySelector(
    '[aria-labelledby="footer-address"] address p:last-child span',
  );
  if (
    address &&
    values.address?.trim() &&
    document.documentElement.lang === "fa"
  )
    address.textContent = limit(values.address, 300);
  replaceSchema(document, before.phone, values.phone);
  for (const key of Object.keys(prefixes))
    replaceSchema(
      document,
      before[key].split("?")[0],
      values[key].split("?")[0],
    );
  return document.toString();
}
