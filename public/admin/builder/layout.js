// Shared, validated model -> static CSS. No user-provided CSS is interpreted.
export const isFree = e => !e.source || e.free === true;
export const CREATED_CSS = `[data-builder-created]{margin:0;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere}[data-builder-created][data-builder-type=button]{display:flex;align-items:center;justify-content:center;background:#ba9555;color:white;padding:12px;border-radius:6px;text-decoration:none}[data-builder-created][data-builder-type=image]{object-fit:cover}`;
export function layoutCSS(elements) {
  const common = [], desktop = [], mobile = [];
  for (const e of elements.filter(e => !e.deleted)) {
    const selector = `[data-builder-id="${e.id}"]`, unit = e.type === "image" ? `:is([data-builder-unit="${e.id}"],[data-builder-id="${e.id}"]:not(picture > img))` : selector;
    const shared = [];
    if (e.z != null) common.push(`${unit}{z-index:${e.z}}`);
    for (const [key, value] of Object.entries(e.style)) shared.push(`${({fontSize:"font-size",color:"color",textAlign:"text-align"})[key]}:${key === "fontSize" ? value + "px" : value}`);
    if (shared.length) common.push(`${selector}{${shared.join(";")}}`);
    for (const [device, output] of [["desktop", desktop], ["mobile", mobile]]) {
      const l = e.layouts[device], rules = [];
      if (isFree(e)) rules.push(`position:absolute!important;left:${l.x ?? 10}%;top:${l.y ?? 10}%`);
      else if (l.x != null || l.y != null) rules.push(`translate:calc(var(--builder-w,100vw) * ${(l.x || 0) / 100}) calc(var(--builder-h,0px) * ${(l.y || 0) / 100})`);
      if (l.width != null) rules.push(`width:calc(var(--builder-w,100vw) * ${l.width / 100})!important;max-width:none!important;min-width:0!important`);
      if (l.height != null) rules.push(`height:calc(var(--builder-h,0px) * ${l.height / 100})!important;min-height:0!important`);
      if (rules.length) output.push(`${unit}{${rules.join(";")}}`);
      if (e.type === "image" && isFree(e)) output.push(`[data-builder-unit="${e.id}"]>img{width:100%!important;height:100%!important;object-fit:cover}`);
    }
  }
  return CREATED_CSS + common.join("") + `@media(min-width:641px){${desktop.join("")}}@media(max-width:640px){${mobile.join("")}}`;
}
