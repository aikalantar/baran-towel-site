// Trusted static runtime: supply responsive section dimensions to generated CSS.
// It neither accepts markup nor writes content or sends network requests.
const pending = new Set();
let scheduled = false;
function updateNestedGeometry(){
  for(const node of document.querySelectorAll('[data-builder-parent]')){
    const id=node.getAttribute('data-builder-parent');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))continue;
    const parent=id==='page'?document.querySelector('main'):document.querySelector(`[data-builder-id="${id}"]`)||document.querySelector(`[data-builder-anchor="${id}"]`);
    if(!parent)continue;const rect=parent.getBoundingClientRect();
    for(const [key,value] of [['--builder-w',`${rect.width}px`],['--builder-h',`${Math.max(1,rect.height)}px`]])if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);
  }
}
const observer = new ResizeObserver(entries => {
  for (const {target} of entries) pending.add(target);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const target of pending) {
      const width = `${target.clientWidth}px`, height = `${target.clientHeight}px`;
      if (target.style.getPropertyValue("--builder-w") !== width) target.style.setProperty("--builder-w", width);
      if (target.style.getPropertyValue("--builder-h") !== height) target.style.setProperty("--builder-h", height);
    }
    pending.clear();
    updateNestedGeometry();
  });
});
for (const anchor of document.querySelectorAll("[data-builder-anchor],[data-builder-type=container],main")) {
  if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
  anchor.style.setProperty("--builder-w", `${anchor.clientWidth}px`);
  anchor.style.setProperty("--builder-h", `${anchor.clientHeight}px`);
  observer.observe(anchor);
}
updateNestedGeometry();
for (const node of document.querySelectorAll("[data-builder-geometry]")) {
  if (getComputedStyle(node).display === "inline") node.style.display = "inline-block";
  if (getComputedStyle(node).position === "static" && getComputedStyle(node).zIndex !== "auto") node.style.position = "relative";
}
