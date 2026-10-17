import { CMSFailure } from "./content.js";
import { digest, from64, bytes64 } from "./auth.js";
import { imageInfo } from "../public/admin/builder/image-format.js";

export async function prepareImages(model, tree, repo, head) {
  const known = new Set(tree.map(f => f.path)), changes = new Map(), dimensions = new Map();
  const resolve = async source => {
    if (dimensions.has(source)) return dimensions.get(source);
    let bytes, path, mime;
    if (source.startsWith("data:")) {
      const match = source.match(/^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) throw new CMSFailure("داده تصویر معتبر نیست.");
      mime = match[1]; bytes = from64(match[2]);
    } else {
      path = "public" + source;
      if (!known.has(path)) throw new CMSFailure("یکی از تصاویر در مخزن موجود نیست؛ تصویر را دوباره انتخاب کنید.");
      // Only changed/explicit responsive images need binary inspection.
      bytes = await repo.readBytes(path, head);
    }
    if (bytes.length > 4 * 1024 * 1024) throw new CMSFailure("حجم تصویر بیشتر از حد امن ۴ مگابایت است.");
    let info;
    try { info = imageInfo(bytes); } catch { throw new CMSFailure("ساختار فایل تصویر معتبر نیست."); }
    if ((mime && mime !== info.mime) || !info.width || !info.height || info.width > 8000 || info.height > 8000 || info.width * info.height > 40_000_000) throw new CMSFailure("نوع یا ابعاد تصویر مجاز نیست.");
    if (!path) {
      const ext = {"image/webp":"webp","image/png":"png","image/jpeg":"jpg"}[info.mime];
      path = `public/assets/uploads/${await digest(bytes)}.${ext}`;
      if (!known.has(path)) changes.set(path,{path,content:bytes64(bytes),encoding:"base64"});
    }
    const result = {src:"/" + path.slice(7),width:info.width,height:info.height};
    dimensions.set(source,result); return result;
  };
  for (const e of model.elements.filter(e => e.type === "image" && !e.deleted)) {
    if (!e.content.src.startsWith("data:") && !known.has("public" + e.content.src)) throw new CMSFailure("تصویر انتخاب‌شده در مخزن موجود نیست.");
    if (!e.imageChanged && !e.content.src.startsWith("data:") && !e.content.variants?.length) continue;
    const image = await resolve(e.content.src);
    const sibling = image.src.replace(/\.(webp|png|jpe?g)$/i,"-640.$1");
    if (!e.content.variants?.length && image.width > 640 && known.has("public"+sibling)) e.content.variants = [{src:sibling}];
    e.content = {...e.content,...image,variants:await Promise.all((e.content.variants || []).map(async v => {
      const variant = await resolve(v.src);
      if (variant.width > image.width || Math.abs(variant.width/variant.height - image.width/image.height) > .02) throw new CMSFailure("ابعاد نسخه responsive با تصویر اصلی سازگار نیست.");
      return variant;
    }))};
  }
  if (changes.size > 16 || [...changes.values()].reduce((sum,f) => sum + f.content.length,0) > 14*1024*1024) throw new CMSFailure("تصاویر این انتشار زیاد هستند؛ در چند مرحله منتشر کنید.");
  return [...changes.values()];
}
