const header = document.querySelector("[data-header]");
const nav = document.querySelector("[data-nav]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const filterButtons = document.querySelectorAll("[data-filter]");
const products = document.querySelectorAll("[data-category]");
const lightbox = document.querySelector("[data-lightbox]");
const lightboxImg = document.querySelector("[data-lightbox-img]");
const lightboxClose = document.querySelector("[data-lightbox-close]");
const whatsappBase = "https://wa.me/989192531804";

const setHeaderState = () => {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 18 || document.body.classList.contains("catalog-body"));
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

if (menuToggle && nav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    products.forEach((product) => {
      const shouldShow = filter === "all" || product.dataset.category === filter;
      product.classList.toggle("is-hidden", !shouldShow);
    });
  });
});

document.querySelectorAll(".thumbs").forEach((thumbs) => {
  thumbs.querySelector("button")?.classList.add("is-active");
});

document.querySelectorAll("img").forEach((image, index) => {
  image.decoding = "async";
  if (index > 3 && !image.closest(".hero-lux")) {
    image.loading = "lazy";
  }
});

document.querySelectorAll(".lux-card").forEach((card) => {
  if (card.querySelector(".card-order")) return;

  const model = card.querySelector("h3")?.textContent?.trim() || "مدل باران";
  const tag = card.querySelector(".tag")?.textContent?.trim() || "سرویس حوله";
  const message = `سلام، برای استعلام و سفارش مدل ${model} (${tag}) از سایت حوله باران پیام می‌دهم.`;
  const link = document.createElement("a");
  link.className = "card-order";
  link.href = `${whatsappBase}?text=${encodeURIComponent(message)}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "استعلام این مدل";
  card.append(link);
});

const openLightbox = (image) => {
  if (!lightbox || !lightboxImg || !image) return;
  lightboxImg.src = image.currentSrc || image.src;
  lightboxImg.alt = image.alt || "";
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
};

const closeLightbox = () => {
  if (!lightbox || !lightboxImg) return;
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImg.removeAttribute("src");
  document.body.style.overflow = "";
};

document.addEventListener("click", (event) => {
  if (event.target.closest(".card-order")) {
    return;
  }

  const thumbButton = event.target.closest(".thumbs button");

  if (thumbButton) {
    event.preventDefault();
    event.stopPropagation();

    const card = thumbButton.closest(".lux-card, .design-gallery article");
    const thumbImage = thumbButton.querySelector("img");
    const mainImage = card?.querySelector(":scope > img.zoomable, :scope > img.card-main");

    if (thumbImage && mainImage) {
      mainImage.src = thumbImage.src;
      thumbButton.parentElement.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-active", button === thumbButton);
      });
    }

    return;
  }

  const zoomable = event.target.closest("img.zoomable");
  if (zoomable && !zoomable.closest(".thumbs")) {
    openLightbox(zoomable);
  }
});

lightboxClose?.addEventListener("click", closeLightbox);

lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLightbox();
  }
});
