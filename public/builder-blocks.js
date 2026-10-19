// Trusted, progressive enhancement for static Builder gallery blocks.
// Native <details>/<summary> FAQ blocks work without JavaScript.
(() => {
  function initialize() {
    const galleries = [...document.querySelectorAll('[data-builder-created][data-builder-kind="gallery"]')];
    if (!galleries.length) return;
    const fa = !document.documentElement.lang.startsWith("en"), label = (persian, english) => fa ? persian : english;
    let dialog, display, count, close, previous, next, images = [], index = 0, source;
    const update = () => {
      const image = images[index];
      if (!image) return;
      display.src = image.currentSrc || image.src;
      display.alt = image.alt || "";
      count.textContent = label(`تصویر ${index + 1} از ${images.length}`, `Image ${index + 1} of ${images.length}`);
      previous.disabled = next.disabled = images.length < 2;
    };
    const move = direction => { index = (index + direction + images.length) % images.length; update(); };
    const build = () => {
      dialog = document.createElement("dialog");
      dialog.className = "builder-gallery-dialog";
      dialog.setAttribute("aria-label", label("نمایش بزرگ تصویر", "Image viewer"));
      const header = document.createElement("header"), navigation = document.createElement("nav");
      navigation.setAttribute("aria-label", label("انتخاب تصویر", "Image navigation"));
      count = document.createElement("span"); count.setAttribute("role", "status"); count.setAttribute("aria-live", "polite");
      close = document.createElement("button"); close.type = "button"; close.textContent = label("بستن", "Close");
      previous = document.createElement("button"); previous.type = "button"; previous.textContent = label("قبلی", "Previous");
      next = document.createElement("button"); next.type = "button"; next.textContent = label("بعدی", "Next");
      display = document.createElement("img"); display.decoding = "async";
      header.append(count, close); navigation.append(previous, next); dialog.append(header, display, navigation); document.body.append(dialog);
      close.addEventListener("click", () => dialog.close());
      previous.addEventListener("click", () => move(-1)); next.addEventListener("click", () => move(1));
      dialog.addEventListener("close", () => { if (source?.isConnected) source.focus(); display.removeAttribute("src"); });
      dialog.addEventListener("click", event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
      dialog.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") { index = 0; update(); }
        else if (event.key === "End") { index = images.length - 1; update(); }
        else move((event.key === "ArrowRight" ? 1 : -1) * (document.documentElement.dir === "rtl" ? -1 : 1));
      });
    };
    for (const gallery of galleries) {
      for (const image of gallery.querySelectorAll("img[data-builder-created]")) {
        // Avoid changing links a site owner already supplied around an image.
        if (image.closest("a,button") || image.dataset.builderGalleryReady) continue;
        image.dataset.builderGalleryReady = "true";
        image.tabIndex = 0; image.setAttribute("role", "button"); image.setAttribute("aria-haspopup", "dialog");
        image.setAttribute("aria-label", label(`نمایش بزرگ: ${image.alt || "تصویر"}`, `Enlarge: ${image.alt || "image"}`));
        const open = () => {
          if (!dialog) build();
          images = [...gallery.querySelectorAll("img[data-builder-created]")]; index = images.indexOf(image); source = image;
          if (index < 0 || typeof dialog.showModal !== "function") return;
          update(); if (!dialog.open) dialog.showModal(); close.focus();
        };
        image.addEventListener("click", open);
        image.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})();
