let crcTable;
function crc32(bytes, start, end) {
  crcTable ||= Uint32Array.from({length:256}, (_, index) => { let value=index; for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0; });
  let value=0xffffffff;for(let index=start;index<end;index++)value=crcTable[(value^bytes[index])&255]^(value>>>8);return (value^0xffffffff)>>>0;
}
export function imageInfo(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("دادهٔ تصویر معتبر نیست.");
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    let width, height, offset=8, imageData=0, ended=false, dataEnded=false, palette=false, color;
    while(offset+12<=bytes.length){
      const size=view.getUint32(offset),kind=ascii(offset+4,4),pos=offset+8,end=pos+size;
      if(end+4>bytes.length||!/[A-Za-z]{4}/.test(kind)||crc32(bytes,offset+4,end)!==view.getUint32(end))throw new Error("فایل PNG ناقص یا خراب است.");
      if(offset===8&&kind!=="IHDR")throw new Error("سرآیند PNG معتبر نیست.");
      if(kind==="IHDR"){
        if(width||offset!==8||size!==13)throw new Error("سرآیند PNG معتبر نیست.");
        width=view.getUint32(pos);height=view.getUint32(pos+4);const depth=bytes[pos+8];color=bytes[pos+9];
        if(!width||!height||!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[color]?.includes(depth)||bytes[pos+10]!==0||bytes[pos+11]!==0||bytes[pos+12]>1)throw new Error("سرآیند PNG معتبر نیست.");
      }else if(kind==="PLTE"){
        if(imageData||palette||!size||size%3||size>768)throw new Error("پالت PNG معتبر نیست.");palette=true;
      }else if(kind==="IDAT"){
        if(dataEnded||color===3&&!palette)throw new Error("دادهٔ PNG معتبر نیست.");
        if(!imageData&&size>=2&&((bytes[pos]&15)!==8||(bytes[pos]>>4)>7||((bytes[pos]<<8)+bytes[pos+1])%31||bytes[pos+1]&32))throw new Error("فشرده‌سازی PNG معتبر نیست.");
        imageData+=size;
      }else if(kind==="IEND"){
        if(size||imageData<7||end+4!==bytes.length)throw new Error("فایل PNG ناقص است.");ended=true;offset=end+4;break;
      }else{
        if(kind==="acTL"||kind==="fcTL"||kind==="fdAT")throw new Error("تصویر متحرک پشتیبانی نمی‌شود.");
        if(kind[0]===kind[0].toUpperCase())throw new Error("بخش ناشناختهٔ PNG پشتیبانی نمی‌شود.");
        if(imageData)dataEnded=true;
      }
      offset=end+4;
    }
    if(ended&&offset===bytes.length)return {mime:"image/png",width,height};
    throw new Error("فایل PNG ناقص است.");
  }
  if (bytes.length >= 30 && ascii(0,4) === "RIFF" && ascii(8,4) === "WEBP" && view.getUint32(4,true) + 8 === bytes.length) {
    let width, height, raster = false;
    let offset=12;
    for (; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset+4,true), kind = ascii(offset,4), pos = offset+8;
      if (pos + size > bytes.length) throw new Error("فایل WebP ناقص است.");
      if (kind === "ANIM" || kind === "ANMF") throw new Error("تصویر متحرک پشتیبانی نمی‌شود.");
      if (kind === "VP8X") {if(size!==10||width||raster)throw new Error('سرآیند WebP معتبر نیست.');width = 1 + bytes[pos+4] + (bytes[pos+5]<<8) + (bytes[pos+6]<<16); height = 1 + bytes[pos+7] + (bytes[pos+8]<<8) + (bytes[pos+9]<<16); }
      if (kind === "VP8 " || kind === "VP8L") {
        let rasterWidth,rasterHeight;
        if(kind==='VP8 '){if(size<=10||(bytes[pos]&1)||ascii(pos+3,3)!=="\x9d\x01\x2a")throw new Error('ساختار WebP معتبر نیست.');rasterWidth=view.getUint16(pos+6,true)&16383;rasterHeight=view.getUint16(pos+8,true)&16383;}
        else{if(size<=5||bytes[pos]!==47)throw new Error('ساختار WebP معتبر نیست.');const bits=view.getUint32(pos+1,true);if(bits>>>29)throw new Error('نسخهٔ WebP معتبر نیست.');rasterWidth=(bits&16383)+1;rasterHeight=((bits>>>14)&16383)+1;}
        if(raster||!rasterWidth||!rasterHeight||width&&(width!==rasterWidth||height!==rasterHeight))throw new Error('ابعاد WebP با دادهٔ تصویر هماهنگ نیست.');
        width=rasterWidth;height=rasterHeight;raster=true;
      }
      offset = pos + size + (size % 2);
    }
    if (width && height && raster && offset===bytes.length) return { mime:"image/webp", width, height };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let pos=2,width,height,scan=false,entropy=false;
    while(pos+1<bytes.length){
      if(bytes[pos++]!==255)break;
      while(bytes[pos]===255)pos++;
      const marker=bytes[pos++];
      if(marker===217){if(width&&height&&scan&&entropy&&pos===bytes.length)return {mime:"image/jpeg",width,height};break;}
      if(marker===216||marker===0||marker>=208&&marker<=215||pos+2>bytes.length)break;
      const size=view.getUint16(pos);if(size<2||pos+size>bytes.length)break;
      if([192,193,194].includes(marker)){
        if(size<11||width||bytes[pos+2]!==8||![1,3,4].includes(bytes[pos+7])||size!==8+3*bytes[pos+7])break;
        width=view.getUint16(pos+5);height=view.getUint16(pos+3);
      }
      if(marker===218){
        if(!width||!height||size<8||size!==6+2*bytes[pos+2])break;
        scan=true;pos+=size;
        while(pos<bytes.length){
          if(bytes[pos]!==255){entropy=true;pos++;continue;}
          if(bytes[pos+1]===0){entropy=true;pos+=2;continue;}
          if(bytes[pos+1]>=208&&bytes[pos+1]<=215){pos+=2;continue;}
          if(bytes[pos+1]===255){pos++;continue;}
          break;
        }
      }else pos+=size;
    }
  }
  throw new Error("ساختار تصویر PNG، JPEG یا WebP معتبر نیست.");
}
