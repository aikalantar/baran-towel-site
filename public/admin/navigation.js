const mobile = matchMedia('(max-width: 760px)');
const $ = selector => document.querySelector(selector);
let opened = false;
function controls() {
  return [...($('#cms-sidebar')?.querySelectorAll('a[href],button:not([disabled])') || [])].filter(el => el.getClientRects().length);
}
export function closeNavigation(restoreFocus = true) {
  const wasOpen = opened;
  opened = false;
  document.body.classList.remove('cms-menu-open');
  const sidebar = $('#cms-sidebar');
  if (sidebar) {
    sidebar.inert = mobile.matches;
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
  }
  if ($('#content')) $('#content').inert = false;
  $('#cms-menu-toggle')?.setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus) $('#cms-menu-toggle')?.focus();
}
export function mountNavigation() {
  closeNavigation(false);
}
function openNavigation() {
  if (!mobile.matches || !$('#cms-sidebar')) return;
  opened = true;
  document.body.classList.add('cms-menu-open');
  const sidebar = $('#cms-sidebar');
  sidebar.inert = false;
  sidebar.setAttribute('role', 'dialog');
  sidebar.setAttribute('aria-modal', 'true');
  $('#content').inert = true;
  $('#cms-menu-toggle').setAttribute('aria-expanded', 'true');
  controls()[0]?.focus();
}
document.addEventListener('click', event => {
  if (event.target.closest('#cms-menu-toggle')) return opened ? closeNavigation() : openNavigation();
  if (event.target.closest('[data-menu-close]')) return closeNavigation();
  if (opened && event.target.closest('#cms-sidebar .nav button, #cms-sidebar a, #cms-sidebar .logout, #cms-sidebar [data-cms-install]')) closeNavigation();
});
document.addEventListener('keydown', event => {
  if (!opened) return;
  if (event.key === 'Escape') { event.preventDefault(); closeNavigation(); }
  if (event.key === 'Tab') {
    const items = controls(), first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
mobile.addEventListener('change', () => {
  const inside = $('#cms-sidebar')?.contains(document.activeElement);
  closeNavigation(false);
  if (inside) {
    const target = mobile.matches ? $('#cms-menu-toggle') : $('#cms-sidebar [aria-current="page"]');
    target?.focus();
  }
});
