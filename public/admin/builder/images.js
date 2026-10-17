import { imageInfo } from "./image-format.js";

export async function optimizeImage(file) {
  if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error("PNG، JPEG یا WebP حداکثر ۲۰ مگابایت مجاز است.");
  const info = imageInfo(new Uint8Array(await file.arrayBuffer()));
  if (info.mime !== file.type || !info.width || !info.height || info.width > 8000 || info.height > 8000 || info.width * info.height > 40_000_000) throw new Error("نوع یا ابعاد تصویر مجاز نیست (حداکثر ۸۰۰۰ پیکسل و ۴۰ مگاپیکسل).");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const make = async w => {
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = Math.max(1, Math.round(height * w / width));
      canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,"image/webp",.86));
      if (!blob || blob.type !== "image/webp" || blob.size > 2 * 1024 * 1024) throw new Error("خروجی به حد امن ۲ مگابایت نرسید؛ تصویر کوچک‌تری انتخاب کنید.");
      const src = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { src, width:canvas.width, height:canvas.height, bytes:blob.size };
    };
    const large = await make(width), small = width > 640 ? await make(640) : null;
    return { src:large.src, width, height, variants:small ? [{src:small.src,width:small.width,height:small.height}] : [], warning: file.size > 2*1024*1024 || large.bytes > 500*1024 ? "تصویر فشرده شد؛ برای سرعت بهتر تصویر ساده‌تر یا کوچک‌تر پیشنهاد می‌شود. ادامه در همین کیفیت در محدوده امن مجاز است." : "" };
  } finally { bitmap.close(); }
}
