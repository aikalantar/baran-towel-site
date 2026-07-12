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
    title: document.title
  }))()`);
  metrics.menuAtLogicalStart = await evalValue(`(()=>{const r=document.querySelector('[data-menu-toggle]').getBoundingClientRect();return document.documentElement.dir==='rtl'?r.left>innerWidth/2:r.right<innerWidth/2})()`);
  if (screenshots.has(`${route}-${width}`)) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const safe = route === '/' ? 'home' : route.replaceAll('/', '-').replace(/^-|-$/g, '');
    fs.mkdirSync('test/screenshots', { recursive: true });
    fs.writeFileSync(`test/screenshots/${safe}-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  if (route === '/') {
    await evalValue(`document.querySelector('[data-menu-toggle]').click()`);
    metrics.menuOpened = await evalValue(`document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded')==='true' && document.querySelector('[data-drawer]').classList.contains('is-open')`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    metrics.menuClosed = await evalValue(`document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded')==='false'`);
    await evalValue(`document.querySelector('[data-zoom]').click()`);
    metrics.lightboxOpened = await evalValue(`document.querySelector('[data-lightbox]').open`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    metrics.lightboxClosed = await evalValue(`!document.querySelector('[data-lightbox]').open`);
  }
  results.push({ width, ...metrics });
}

console.log(JSON.stringify({ results, consoleErrors }, null, 2));
const failed = results.some((item) => item.h1 !== 1 || item.overflow || item.broken.length || !item.menuAtLogicalStart || item.menuOpened === false || item.menuClosed === false || item.lightboxOpened === false || item.lightboxClosed === false) || consoleErrors.length;
page.socket.close();
if (failed) process.exitCode = 1;
