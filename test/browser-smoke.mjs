import fs from 'node:fs';

const endpoint = 'http://127.0.0.1:9223';
const base = 'http://127.0.0.1:4175';
const screenshots = new Set(['/-1440', '/-375', '/catalog/-375', '/en/blog/how-to-choose-luxury-towels/-1024']);

async function createPage() {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' });
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
    (listeners.get(message.method) || []).forEach((fn) => fn(message.params));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  const once = (method) => new Promise((resolve) => {
    const handler = (params) => {
      listeners.set(method, (listeners.get(method) || []).filter((fn) => fn !== handler));
      resolve(params);
    };
    listeners.set(method, [...(listeners.get(method) || []), handler]);
  });
  return { socket, send, once, listeners };
}

const page = await createPage();
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Log.enable');
const consoleErrors = [];
page.listeners.set('Runtime.exceptionThrown', [({ exceptionDetails }) => consoleErrors.push(exceptionDetails.text)]);
page.listeners.set('Log.entryAdded', [({ entry }) => entry.level === 'error' && consoleErrors.push(entry.text)]);

const evalValue = async (expression) => {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.result.value;
};

const cases = [
  ['/', 320], ['/', 375], ['/', 768], ['/', 1024], ['/', 1440],
  ['/catalog/', 375], ['/catalog/', 1440], ['/blog/', 320],
  ['/blog/rahnamaye-kharid-hole-luxury/', 375], ['/en/', 375],
  ['/en/catalog/', 768], ['/en/blog/', 1024], ['/en/blog/how-to-choose-luxury-towels/', 1024]
];
const results = [];

for (const [route, width] of cases) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url: `${base}${route}` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await evalValue(`(async()=>{for(const image of [...document.images].filter(i=>!i.matches('[data-lightbox-image]'))){image.scrollIntoView({block:'center'});if(!image.complete){await Promise.race([new Promise(r=>image.addEventListener('load',r,{once:true})),new Promise(r=>image.addEventListener('error',r,{once:true})),new Promise(r=>setTimeout(r,1500))])}}scrollTo(0,0);await new Promise(r=>setTimeout(r,200));return true})()`);
  const metrics = await evalValue(`(()=>({
    route: location.pathname,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    h1: document.querySelectorAll('h1').length,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    broken: [...document.images].filter(i => !i.matches('[data-lightbox-image]') && (!i.complete || !i.naturalWidth)).map(i => i.src),
    title: document.title,
    footerColumns: document.querySelectorAll('.global-footer .footer-column').length,
    telegramLinks: document.querySelectorAll('a[href^="https://t.me/baran_bathrobe"]').length,
    telegramOnlyInFooter: [...document.querySelectorAll('a[href^="https://t.me/baran_bathrobe"]')].every(a => a.closest('.global-footer')),
    unavailableAnchors: document.querySelectorAll('.is-unavailable a, a[href="#"]').length,
    goldenLabels: document.querySelectorAll('.eyebrow').length,
    transparentLogo: document.querySelectorAll('.site-header img[src*="baran-logo-transparent-v2.png"]').length === 1,
    hashedAssets: !!document.querySelector('link[href*="styles.d3f246a045.css"]') && !!document.querySelector('script[src*="script.62a2e3d69f.js"]')
  }))()`);
  metrics.menuAtLogicalStart = await evalValue(`(()=>{const r=document.querySelector('[data-menu-toggle]').getBoundingClientRect();return document.documentElement.dir==='rtl'?r.left>innerWidth/2:r.right<innerWidth/2})()`);
  if (screenshots.has(`${route}-${width}`)) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const safe = route === '/' ? 'home' : route.replaceAll('/', '-').replace(/^-|-$/g, '');
    fs.mkdirSync('test/screenshots', { recursive: true });
    fs.writeFileSync(`test/screenshots/${safe}-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  if (route === '/' || route === '/en/') {
    Object.assign(metrics, await evalValue(`(()=>{
      const header=document.querySelector('.site-header');
      const hero=document.querySelector('.hero');
      const image=document.querySelector('.hero-media');
      const title=document.querySelector('.hero h1');
      const editorial=document.querySelector('.editorial');
      const partnership=document.querySelector('.partnership');
      const actions=[...partnership.querySelectorAll('.partnership-action')];
      const expected=document.documentElement.lang==='fa' ? [
        'سلام.\\nوب‌سایت باران را مشاهده کردم و مایل به دریافت اطلاعات محصولات، قیمت و نحوه ثبت سفارش هستم.\\nلطفاً راهنمایی بفرمایید.\\nسپاسگزارم.',
        'سلام.\\nوب‌سایت باران را مشاهده کردم و مایل هستم درباره فرصت همکاری تجاری با برند باران اطلاعات بیشتری دریافت کنم.\\nلطفاً شرایط همکاری را برای من ارسال بفرمایید.\\nسپاسگزارم.',
        'سلام.\\nوب‌سایت باران را مشاهده کردم و مایل هستم با مجموعه باران در ارتباط باشم.\\nلطفاً راهنمایی بفرمایید.\\nسپاسگزارم.'
      ] : [
        'Hello.\\nI visited the Baran website and would like information about the products, pricing and how to place an order.\\nPlease guide me.\\nThank you.',
        'Hello.\\nI visited the Baran website and would like to learn more about commercial partnership opportunities with Baran.\\nPlease send me the partnership details.\\nThank you.',
        'Hello.\\nI visited the Baran website and would like to get in touch with the Baran team.\\nPlease guide me.\\nThank you.'
      ];
      return {
        headerSeparate: header.getBoundingClientRect().bottom <= hero.getBoundingClientRect().top + 1,
        heroImageBlurred: getComputedStyle(image).filter.includes('blur(2px)'),
        heroTextSharp: getComputedStyle(title).filter === 'none',
        heroTextGrey: getComputedStyle(title).color === 'rgb(89, 94, 91)',
        editorialCaptions: [...document.querySelectorAll('.editorial figcaption')].map(x=>x.textContent.trim()),
        editorialResponsive: innerWidth <= 640 ? editorial.scrollWidth > editorial.clientWidth && getComputedStyle(editorial).scrollSnapType.includes('mandatory') : getComputedStyle(editorial).gridTemplateColumns.split(' ').length === 3,
        partnershipBeforeFooter: document.querySelector('main').lastElementChild === partnership && document.querySelector('main').nextElementSibling?.matches('.global-footer'),
        partnershipLinks: actions.length === 3 && actions.every(a=>a.href.startsWith('https://wa.me/989192531804?text=') && a.target==='_blank' && a.rel.includes('noopener')),
        whatsappMessages: actions.length === 3 && actions.every((a,i)=>new URL(a.href).searchParams.get('text')===expected[i]),
        partnershipHasTelegram: !!partnership.querySelector('a[href*="t.me"]'),
        visiblePhone: document.body.innerText.includes('+98 919 253 1804') || document.body.innerText.includes('+989192531804'),
        introBold: parseInt(getComputedStyle(document.querySelector('.intro h2')).fontWeight,10) >= 700,
        introJustified: getComputedStyle(document.querySelector('.intro p')).textAlign === 'justify'
      };
    })()`));
    await evalValue(`document.querySelector('[data-menu-toggle]').click()`);
    metrics.menuOpened = await evalValue(`document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded')==='true' && document.querySelector('[data-drawer]').classList.contains('is-open')`);
    metrics.menuFocusManaged = await evalValue(`document.activeElement===document.querySelector('[data-menu-close]') && document.body.classList.contains('menu-open')`);
    await evalValue(`document.querySelector('[data-menu-backdrop]').click()`);
    metrics.overlayClosedMenu = await evalValue(`document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded')==='false' && !document.body.classList.contains('menu-open')`);
    await evalValue(`document.querySelector('[data-menu-toggle]').click()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    metrics.menuClosed = await evalValue(`document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded')==='false'`);
    await evalValue(`(()=>{const i=document.querySelector('[data-zoom]');i.focus();i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
    metrics.lightboxOpened = await evalValue(`document.querySelector('[data-lightbox]').open`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    metrics.lightboxClosed = await evalValue(`!document.querySelector('[data-lightbox]').open`);
  }
  results.push({ width, ...metrics });
}

await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const reducedLoaded = page.once('Page.loadEventFired');
await page.send('Page.navigate', { url: `${base}/` });
await reducedLoaded;
const reducedMotion = await evalValue(`(()=>{const r=document.querySelector('.reveal');const s=getComputedStyle(r);return s.opacity==='1' && (s.transform==='none' || s.transform.includes('matrix(1, 0, 0, 1, 0, 0)'))})()`);

console.log(JSON.stringify({ results, consoleErrors, reducedMotion }, null, 2));
const failed = results.some((item) => item.h1 !== 1 || item.overflow || item.broken.length || !item.menuAtLogicalStart || item.footerColumns !== 4 || item.telegramLinks !== 1 || !item.telegramOnlyInFooter || item.unavailableAnchors || item.goldenLabels || !item.transparentLogo || !item.hashedAssets || ((item.route === '/' || item.route === '/en/') && (!item.headerSeparate || !item.heroImageBlurred || !item.heroTextSharp || !item.heroTextGrey || !item.editorialResponsive || !item.partnershipBeforeFooter || !item.partnershipLinks || !item.whatsappMessages || item.partnershipHasTelegram || item.visiblePhone || !item.introBold || !item.introJustified || !item.menuOpened || !item.menuFocusManaged || !item.overlayClosedMenu || !item.menuClosed || !item.lightboxOpened || !item.lightboxClosed))) || consoleErrors.length || !reducedMotion;
page.socket.close();
if (failed) process.exitCode = 1;
