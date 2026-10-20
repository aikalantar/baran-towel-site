// Deliberately no service worker, Cache Storage or offline content. Installation
// is a branded launch shortcut to the same online, authenticated CMS routes.
let pendingPrompt = null;
let installedThisSession = false;
const standalone = matchMedia('(display-mode: standalone)');
const installed = () => installedThisSession || standalone.matches || navigator.standalone === true;
function update() {
  for (const button of document.querySelectorAll('[data-cms-install]')) {
    button.hidden = installed();
    button.textContent = 'نصب پنل مدیریت';
  }
}
export function mountInstall(container) {
  if (!container || container.querySelector('[data-cms-install]')) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'cms-install'; button.dataset.cmsInstall = '';
  container.append(button); update();
}
function guidance(message) {
  let dialog = document.querySelector('#cms-install-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'cms-install-dialog';
    dialog.setAttribute('aria-labelledby', 'cms-install-title');
    dialog.innerHTML = '<h2 id="cms-install-title">نصب پنل مدیریت</h2><p data-install-help></p><p>پنل به اینترنت و ورود به حساب نیاز دارد؛ ویرایش آفلاین پشتیبانی نمی‌شود. پس از نصب، صفحه‌ساز بصری از منوی پنل در دسترس است.</p><form method="dialog"><button>متوجه شدم</button></form>';
    document.body.append(dialog);
  }
  dialog.querySelector('[data-install-help]').textContent = message;
  if (!dialog.open) dialog.showModal();
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); pendingPrompt = event; update();
});
window.addEventListener('appinstalled', () => {
  installedThisSession = true;
  pendingPrompt = null;
  for (const button of document.querySelectorAll('[data-cms-install]')) button.hidden = true;
  document.querySelector('#cms-install-dialog')?.close();
});
standalone.addEventListener('change', update);
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-cms-install]');
  if (!button || installed()) return;
  if (pendingPrompt) {
    const prompt = pendingPrompt; pendingPrompt = null; button.disabled = true;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { guidance('نصب در این مرورگر اکنون در دسترس نیست. از منوی مرورگر، گزینهٔ نصب برنامه یا افزودن به صفحهٔ اصلی را بررسی کنید.'); }
    finally { button.disabled = false; update(); }
    return;
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  guidance(ios
    ? 'در Safari پنل را باز کنید؛ از منوی اشتراک‌گذاری (Share)، «افزودن به صفحهٔ اصلی» (Add to Home Screen) و سپس Add را انتخاب کنید. اگر «Open as Web App» نمایش داده شد، آن را روشن بگذارید. بسته به نسخهٔ iOS محل این گزینه متفاوت است؛ در صورت نیاز «Edit Actions» را بررسی کنید.'
    : 'از منوی مرورگر، «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را انتخاب کنید. در Chrome و در صورت فراهم‌بودن شرایط، همین دکمه پنجرهٔ نصب مرورگر را باز می‌کند. نمایش این پنجره در همهٔ مرورگرها تضمین‌شده نیست.');
});
