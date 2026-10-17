export function imageInfo(bytes) {
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) && ascii(12,4) === "IHDR") return { mime:"image/png", width:view.getUint32(16), height:view.getUint32(20) };
  if (bytes.length >= 30 && ascii(0,4) === "RIFF" && ascii(8,4) === "WEBP" && view.getUint32(4,true) + 8 === bytes.length) {
    let width, height, raster = false;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset+4,true), kind = ascii(offset,4), pos = offset+8;
      if (pos + size > bytes.length) throw new Error("فایل WebP ناقص است.");
      if (kind === "ANIM" || kind === "ANMF") throw new Error("تصویر متحرک پشتیبانی نمی‌شود.");
      if (kind === "VP8X" && size >= 10) { width = 1 + bytes[pos+4] + (bytes[pos+5]<<8) + (bytes[pos+6]<<16); height = 1 + bytes[pos+7] + (bytes[pos+8]<<8) + (bytes[pos+9]<<16); }
      if (kind === "VP8 " && size >= 10 && ascii(pos+3,3) === "\x9d\x01\x2a") { width ||= view.getUint16(pos+6,true)&16383; height ||= view.getUint16(pos+8,true)&16383; raster = true; }
      if (kind === "VP8L" && size >= 5 && bytes[pos] === 47) { const bits = view.getUint32(pos+1,true); width ||= (bits&16383)+1; height ||= ((bits>>>14)&16383)+1; raster = true; }
      offset = pos + size + (size % 2);
    }
    if (width && height && raster) return { mime:"image/webp", width, height };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let pos = 2;
    while (pos + 8 < bytes.length) {
      if (bytes[pos++] !== 255) break;
      const marker = bytes[pos++];
      if (marker === 217 || marker === 218) break;
      const size = view.getUint16(pos);
      if (size < 2 || pos + size > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return { mime:"image/jpeg", width:view.getUint16(pos+5), height:view.getUint16(pos+3) };
      pos += size;
    }
  }
  throw new Error("ساختار تصویر PNG، JPEG یا WebP معتبر نیست.");
}
