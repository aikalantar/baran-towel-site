// Composable, data-only block definitions shared by the editor and publisher.
// Every rendered string is text or a validated attribute; user HTML is never parsed.
export const BLOCK_KINDS = Object.freeze(["section", "container", "columns", "hero", "cards", "gallery", "faq", "faq-item", "feature", "testimonial", "cta", "group", "card"]);
export const BLOCK_TYPES = Object.freeze(["text", "heading", "image", "button", "container", "divider", "spacer"]);
export const BLOCKS = Object.freeze([
  { id: "heading", label: "عنوان", category: "متن", description: "عنوان قابل ویرایش برای معرفی بخش", preview: "Aa" },
  { id: "richtext", label: "متن و پیوند", category: "متن", description: "پاراگراف با تأکید، حالت مورب و پیوند امن", preview: "¶" },
  { id: "image", label: "تصویر", category: "رسانه", description: "تصویر واکنش‌گرا با متن جایگزین", preview: "▧" },
  { id: "image-text", label: "تصویر و متن", category: "چیدمان", description: "تصویر و محتوای قابل ویرایش در دو ستون", preview: "▧ ≡" },
  { id: "button", label: "دکمه و پیوند", category: "متن", description: "دکمه‌ای با مقصد قابل ویرایش", preview: "[ ↗ ]" },
  { id: "section", label: "بخش", category: "چیدمان", description: "بخش مستقل با عنوان و توضیح", preview: "▤" },
  { id: "columns", label: "ستون‌ها", category: "چیدمان", description: "دو ستون منعطف؛ با تکثیر ستون، چیدمان چندستونی بسازید", preview: "▥" },
  { id: "hero", label: "معرفی اصلی", category: "بخش‌های آماده", description: "عنوان، توضیح، دکمه و تصویر معرفی", preview: "Aa ▧" },
  { id: "cards", label: "شبکه کارت‌ها", category: "بخش‌های آماده", description: "سه کارت مستقل با عنوان، توضیح و پیوند", preview: "▤ ▤ ▤" },
  { id: "gallery", label: "گالری تصاویر", category: "رسانه", description: "گالری با نمایش بزرگ، حرکت با صفحه‌کلید و بستن", preview: "▧ ▧ ▧" },
  { id: "faq", label: "پرسش‌های متداول", category: "بخش‌های آماده", description: "پرسش و پاسخ بازشونده با رفتار بومی مرورگر", preview: "⌄ ≡" },
  { id: "divider", label: "خط جداکننده", category: "چیدمان", description: "مرز دیداری و معنایی بین محتوا", preview: "━━━━" },
  { id: "spacer", label: "فاصله", category: "چیدمان", description: "فاصله قابل تنظیم میان عناصر", preview: "↕" },
  { id: "features", label: "ویژگی‌ها و خدمات", category: "بخش‌های آماده", description: "سه ویژگی قابل ویرایش در چیدمان منعطف", preview: "✓ ✓ ✓" },
  { id: "testimonials", label: "دیدگاه مشتریان", category: "بخش‌های آماده", description: "دیدگاه‌ها و نام مشتریان در کارت‌های مستقل", preview: "“ … ”" },
  { id: "cta", label: "دعوت به اقدام", category: "بخش‌های آماده", description: "عنوان، توضیح و دکمه اقدام در یک بخش", preview: "Aa →" },
].map(item => Object.freeze(item)));

const IMAGE = "/assets-v3/gallery/nilo-01.webp";
const GALLERY = [IMAGE, "/assets-v3/gallery/mahfa-01.webp", "/assets-v3/gallery/chekav-01.webp"];
const safeLink = value => typeof value === "string" && value.length <= 2000 && !/[\u0000-\u0020\\]/.test(value) && /^(?:\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(value);
const safeImage = value => typeof value === "string" && value.length < 3_000_000 && ((/^\/assets(?:-v[23])?\/[a-zA-Z0-9_./-]+\.(webp|png|jpe?g)$/i.test(value) && !value.includes("..")) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value));

export function blockTag(element) {
  if (element.type === "heading") return ["h1", "h2", "h3", "h4", "h5", "h6", "summary"].includes(element.tag) ? element.tag : "h2";
  if (element.type === "container") return element.kind === "section" ? "section" : element.kind === "faq-item" ? "details" : "div";
  return ({ text: "p", image: "img", button: "a", divider: "hr", spacer: "div" })[element.type] || null;
}

/** Returns a flat subtree. The first item is the root; child order is local to its parent. */
export function createBlock(kind, { anchor, parentId = anchor, language = "fa", idFactory = () => `new-${crypto.randomUUID()}` } = {}) {
  if (!BLOCKS.some(block => block.id === kind)) throw new Error("نوع بلوک پشتیبانی نمی‌شود.");
  if (typeof anchor !== "string" || !anchor || typeof parentId !== "string" || !parentId) throw new Error("والد بلوک مشخص نیست.");
  const fa = language !== "en", nodes = [], choose = (persian, english) => fa ? persian : english;
  const add = (type, parent, content = { text: "" }, options = {}) => {
    const node = { id: idFactory(), type, tag: ({ text: "p", heading: "h2", image: "img", button: "a", container: "div", divider: "hr", spacer: "div" })[type], source: null, anchor, parentId: parent, order: nodes.filter(item => item.parentId === parent).length, layoutMode: "flow", layouts: { desktop: {}, tablet: {}, mobile: {} }, style: {}, responsiveStyles: { tablet: {}, mobile: {} }, content, deleted: false, z: null, locked: false, ...options };
    node.tag = blockTag(node);
    nodes.push(node);
    return node.id;
  };
  const container = (parent, containerKind) => add("container", parent, { text: "" }, { kind: containerKind });
  const heading = (parent, persian = "عنوان بخش", english = "Section heading", tag = "h2") => add("heading", parent, { text: choose(persian, english) }, { tag });
  const text = (parent, persian = "توضیح این بخش را با انتخاب متن ویرایش کنید.", english = "Select this text to describe your products or services.") => add("text", parent, { text: choose(persian, english) });
  const image = (parent, src = IMAGE, alt = choose("نمونه محصول حوله باران", "Baran towel product")) => add("image", parent, { src, alt });
  const button = (parent, label = choose("بیشتر بدانید", "Learn more")) => add("button", parent, { text: label, href: fa ? "/#partnership" : "/en/#partnership" });
  const copy = parent => { heading(parent); text(parent); };
  const card = (parent, index, containerKind = "card") => {
    const id = container(parent, containerKind);
    heading(id, `عنوان ${index}`, `Heading ${index}`, "h3");
    text(id);
    return id;
  };
  if (kind === "heading") heading(parentId);
  else if (kind === "richtext") {
    const id = text(parentId), node = nodes.find(item => item.id === id);
    node.content.runs = [{ text: choose("داستان شما؛ ", "Your story; ") }, { text: choose("با کیفیتی ماندگار", "lasting quality"), bold: true }];
    node.content.text = node.content.runs.map(run => run.text).join("");
  } else if (kind === "image") image(parentId);
  else if (kind === "button") button(parentId);
  else if (kind === "divider" || kind === "spacer") add(kind, parentId);
  else if (kind === "section") copy(container(parentId, "section"));
  else if (kind === "columns") {
    const root = container(parentId, "columns");
    copy(container(root, "container")); copy(container(root, "container"));
  } else if (kind === "image-text" || kind === "hero") {
    const root = container(parentId, kind === "hero" ? "hero" : "columns"), content = container(root, "container");
    heading(content, kind === "hero" ? "داستان تازه شما از اینجا آغاز می‌شود" : "کیفیتی که احساس می‌کنید", kind === "hero" ? "Your next story starts here" : "Quality you can feel");
    text(content); button(content); image(root);
  } else if (kind === "cards" || kind === "features") {
    const root = container(parentId, kind === "cards" ? "cards" : "feature");
    for (let i = 1; i <= 3; i++) { const id = card(root, i); if (kind === "cards") button(id); }
  } else if (kind === "gallery") {
    const root = container(parentId, "gallery");
    GALLERY.forEach((src, index) => image(root, src, choose(`نمونه محصول ${index + 1} باران`, `Baran product ${index + 1}`)));
  } else if (kind === "faq") {
    const root = container(parentId, "faq");
    heading(root, "پرسش‌های متداول", "Frequently asked questions");
    for (let i = 1; i <= 3; i++) {
      const item = container(root, "faq-item");
      heading(item, `پرسش ${i}: چگونه انتخاب کنم؟`, `Question ${i}: How do I choose?`, "summary");
      text(item, "پاسخ روشن و مفید خود را اینجا بنویسید.", "Write a clear, useful answer here.");
    }
  } else if (kind === "testimonials") {
    const root = container(parentId, "testimonial");
    for (let i = 1; i <= 2; i++) {
      const item = container(root, "card");
      text(item, "«تجربه واقعی مشتری را با اجازه او در این قسمت قرار دهید.»", "“Add a real customer's experience here with their permission.”");
      heading(item, `نام مشتری ${i}`, `Customer ${i}`, "h3");
    }
  } else if (kind === "cta") {
    const root = container(parentId, "cta");
    heading(root, "برای انتخاب بهتر همراه شما هستیم", "We are here to help you choose");
    text(root, "برای دریافت راهنمایی با ما در ارتباط باشید.", "Contact us for advice and product information.");
    button(root, choose("تماس با ما", "Contact us"));
  }
  if (new Set(nodes.map(node => node.id)).size !== nodes.length || nodes.some(node => !/^new-[a-zA-Z0-9-]+$/.test(node.id))) throw new Error("شناسه بلوک معتبر یا یکتا نیست.");
  return nodes;
}

function appendRichText(document, node, content) {
  if (!Array.isArray(content.runs) || !content.runs.length) { node.textContent = typeof content.text === "string" ? content.text : ""; return; }
  for (const run of content.runs) {
    if (!run || typeof run.text !== "string") continue;
    let child = document.createTextNode(run.text);
    for (const [key, tag] of [["bold", "strong"], ["italic", "em"], ["underline", "u"]]) if (run[key] === true) { const wrapper = document.createElement(tag); wrapper.append(child); child = wrapper; }
    if (safeLink(run.href)) { const link = document.createElement("a"); link.href = run.href; link.append(child); child = link; }
    node.append(child);
  }
}

/** Create ONE node; the caller attaches children using validated parentId/order. */
export function renderBlockNode(document, element) {
  const tag = blockTag(element);
  if (!BLOCK_TYPES.includes(element.type) || !tag || !/^new-[a-zA-Z0-9-]+$/.test(element.id) || (element.type === "container" && !BLOCK_KINDS.includes(element.kind))) throw new Error("ساختار بلوک معتبر نیست.");
  const node = document.createElement(tag), content = element.content || {};
  node.setAttribute("data-builder-id", element.id);
  node.setAttribute("data-builder-created", "");
  node.setAttribute("data-builder-type", element.type);
  node.setAttribute("data-builder-kind", element.kind || element.type);
  if (element.type === "image") {
    if (safeImage(content.src)) node.setAttribute("src", content.src);
    node.setAttribute("alt", typeof content.alt === "string" ? content.alt : "");
    node.setAttribute("loading", content.loading === "eager" ? "eager" : "lazy");
    node.setAttribute("decoding", "async");
    for (const key of ["width", "height"]) if (Number.isInteger(content[key]) && content[key] > 0 && content[key] <= 8000) node.setAttribute(key, String(content[key]));
    const variants = Array.isArray(content.variants) ? content.variants.filter(v => safeImage(v?.src) && Number.isInteger(v.width) && v.width > 0 && v.width <= 8000).slice(0, 3) : [];
    if (variants.length) { node.setAttribute("srcset", variants.map(v => `${v.src} ${v.width}w`).join(", ")); node.setAttribute("sizes", "(max-width:640px) 100vw, (max-width:960px) 50vw, 33vw"); }
  } else if (element.type === "button") {
    node.textContent = typeof content.text === "string" ? content.text : "";
    node.setAttribute("href", safeLink(content.href) ? content.href : "#");
  } else if (element.type === "text" || element.type === "heading") appendRichText(document, node, content);
  else if (element.type === "spacer") node.setAttribute("aria-hidden", "true");
  return node;
}

// Static, trusted styles. Customer overrides are generated separately by layout.js.
export const BLOCK_CSS = `
[data-builder-created]{box-sizing:border-box;max-width:100%;overflow-wrap:anywhere}
[data-builder-created][data-builder-type=container]{position:relative;min-width:0;white-space:normal}
[data-builder-created][data-builder-kind=section]{padding:clamp(24px,4vw,64px);display:grid;gap:20px}
[data-builder-created][data-builder-kind=container],[data-builder-created][data-builder-kind=group]{display:flex;flex-direction:column;gap:16px;min-width:0}
[data-builder-created]:is([data-builder-kind=columns],[data-builder-kind=hero]){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:clamp(20px,3vw,40px);align-items:center;padding:clamp(16px,3vw,40px)}
[data-builder-created]:is([data-builder-kind=cards],[data-builder-kind=feature],[data-builder-kind=gallery]){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:24px;padding:24px 0}
[data-builder-created][data-builder-kind=gallery]>[data-builder-type=image]{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px}
[data-builder-created][data-builder-kind=card]{display:flex;flex-direction:column;gap:16px;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;padding:24px}
[data-builder-created][data-builder-kind=testimonial]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:24px;padding:24px 0}
[data-builder-created][data-builder-kind=faq]{display:flex;flex-direction:column;gap:12px;padding:24px 0}
[data-builder-created][data-builder-kind=faq-item]{border-bottom:1px solid currentColor;padding:16px 0}
[data-builder-created][data-builder-kind=faq-item]>summary{cursor:pointer;font-weight:700;list-style-position:inside}
[data-builder-created][data-builder-kind=faq-item]>p{margin-block:16px 0}
[data-builder-created][data-builder-kind=cta]{display:flex;flex-direction:column;align-items:center;text-align:center;gap:20px;padding:clamp(32px,5vw,72px);border-radius:12px;background:color-mix(in srgb,currentColor 5%,transparent)}
[data-builder-created][data-builder-type=image]{display:block;height:auto;object-fit:cover}
[data-builder-created][data-builder-type=button]{display:inline-flex;align-items:center;justify-content:center;align-self:start;max-width:100%;padding:12px 24px;border:1px solid currentColor;border-radius:6px;background:var(--gold,#ba9555);color:var(--cream,#fff);text-decoration:none;min-height:44px}
[data-builder-created][data-builder-kind=cta]>[data-builder-type=button]{align-self:center}
[data-builder-created][data-builder-type=heading]{line-height:1.4;margin:0;font-family:inherit}
[data-builder-created][data-builder-type=text]{line-height:1.9;margin:0}
[data-builder-created][data-builder-type=divider]{width:100%;border:0;border-top:1px solid currentColor;opacity:.3;margin:16px 0}
[data-builder-created][data-builder-type=spacer]{height:32px;width:100%;pointer-events:none}
[data-builder-created][data-builder-kind=gallery] img[role=button]{cursor:zoom-in}
[data-builder-created][data-builder-kind=gallery] img[role=button]:focus-visible{outline:3px solid currentColor;outline-offset:4px}
.builder-gallery-dialog{box-sizing:border-box;width:min(960px,94vw);max-width:94vw;max-height:94svh;padding:16px;background:#171717;color:#fff;border:1px solid #777;border-radius:12px;overflow:auto}
.builder-gallery-dialog::backdrop{background:rgb(0 0 0 / .8)}
.builder-gallery-dialog[open]{display:flex;flex-direction:column;gap:12px}
.builder-gallery-dialog img{display:block;max-width:100%;width:100%;max-height:72svh;object-fit:contain;margin:auto}
.builder-gallery-dialog header,.builder-gallery-dialog nav{display:flex;justify-content:space-between;align-items:center;gap:12px}
.builder-gallery-dialog button{min-height:44px;min-width:44px;padding:8px 16px;border:1px solid #aaa;border-radius:6px;background:#292929;color:#fff;font:inherit;cursor:pointer}
.builder-gallery-dialog button:focus-visible{outline:3px solid #fff;outline-offset:3px}
@media(max-width:960px){[data-builder-created]:is([data-builder-kind=columns],[data-builder-kind=hero]){gap:20px}}
@media(max-width:640px){[data-builder-created]:is([data-builder-kind=columns],[data-builder-kind=hero],[data-builder-kind=cards],[data-builder-kind=feature],[data-builder-kind=gallery],[data-builder-kind=testimonial]){grid-template-columns:minmax(0,1fr)}[data-builder-created][data-builder-kind=section]{padding:24px 16px}}
`;
