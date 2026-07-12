(() => {
  const body = document.body;
  const menuButton = document.querySelector('[data-menu-toggle]');
  const drawer = document.querySelector('[data-drawer]');
  const backdrop = document.querySelector('[data-menu-backdrop]');
  const closeButton = document.querySelector('[data-menu-close]');
  let menuReturnFocus = null;

  const focusable = (root) =>
    [...root.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];

  const closeMenu = () => {
    if (!drawer || !menuButton) return;
    drawer.classList.remove('is-open');
    backdrop?.classList.remove('is-visible');
    menuButton.setAttribute('aria-expanded', 'false');
    body.classList.remove('menu-open');
    menuReturnFocus?.focus();
  };

  const openMenu = () => {
    if (!drawer || !menuButton) return;
    menuReturnFocus = document.activeElement;
    drawer.classList.add('is-open');
    backdrop?.classList.add('is-visible');
    menuButton.setAttribute('aria-expanded', 'true');
    body.classList.add('menu-open');
    closeButton?.focus();
  };

  menuButton?.addEventListener('click', () => {
    menuButton.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
  });
  closeButton?.addEventListener('click', closeMenu);
  backdrop?.addEventListener('click', closeMenu);
  drawer?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  drawer?.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = focusable(drawer);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const lightbox = document.querySelector('[data-lightbox]');
  const lightboxImage = lightbox?.querySelector('[data-lightbox-image]');
  const lightboxCaption = lightbox?.querySelector('[data-lightbox-caption]');
  const lightboxClose = lightbox?.querySelector('[data-lightbox-close]');
  const previousButton = lightbox?.querySelector('[data-lightbox-prev]');
  const nextButton = lightbox?.querySelector('[data-lightbox-next]');
  const zoomables = [...document.querySelectorAll('[data-zoom]')];
  let currentIndex = 0;
  let lightboxReturnFocus = null;

  const showImage = (index) => {
    if (!lightboxImage || !zoomables.length) return;
    currentIndex = (index + zoomables.length) % zoomables.length;
    const source = zoomables[currentIndex];
    lightboxImage.src = source.currentSrc || source.src;
    lightboxImage.alt = source.alt;
    if (lightboxCaption) lightboxCaption.textContent = source.alt;
  };

  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.close();
    body.classList.remove('lightbox-open');
    lightboxReturnFocus?.focus();
  };

  const openLightbox = (index) => {
    if (!lightbox) return;
    lightboxReturnFocus = document.activeElement;
    showImage(index);
    lightbox.showModal();
    body.classList.add('lightbox-open');
    lightboxClose?.focus();
  };

  zoomables.forEach((image, index) => {
    const trigger = image.closest('button') || image;
    if (trigger === image) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `${image.alt}؛ نمایش تصویر بزرگ`);
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openLightbox(index);
        }
      });
    }
    trigger.addEventListener('click', () => openLightbox(index));
  });

  lightboxClose?.addEventListener('click', closeLightbox);
  previousButton?.addEventListener('click', () => showImage(currentIndex - 1));
  nextButton?.addEventListener('click', () => showImage(currentIndex + 1));
  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (lightbox?.open) closeLightbox();
      else closeMenu();
    }
    if (!lightbox?.open) return;
    if (event.key === 'ArrowLeft') showImage(currentIndex - 1);
    if (event.key === 'ArrowRight') showImage(currentIndex + 1);
  });
})();
