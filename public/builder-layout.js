// Trusted static runtime: supply responsive section dimensions to generated CSS.
// It neither accepts markup nor writes content or sends network requests.
const pending = new Set();
let scheduled = false;
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
  });
});
for (const anchor of document.querySelectorAll("[data-builder-anchor]")) {
  if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
  anchor.style.setProperty("--builder-w", `${anchor.clientWidth}px`);
  anchor.style.setProperty("--builder-h", `${anchor.clientHeight}px`);
  observer.observe(anchor);
}
for (const node of document.querySelectorAll("[data-builder-geometry]")) {
  if (getComputedStyle(node).display === "inline") node.style.display = "inline-block";
  if (getComputedStyle(node).position === "static" && getComputedStyle(node).zIndex !== "auto") node.style.position = "relative";
}
