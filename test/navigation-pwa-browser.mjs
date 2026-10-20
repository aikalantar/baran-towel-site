import { chromium, webkit, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { passwordHash } from '../src/auth.js';
import { githubSimulation } from './github-simulation.mjs';

// Real local workerd login/session/authorization; GitHub is explicitly isolated.
const folder = path.resolve('.cms-local/task12-qa'); await fs.mkdir(folder,{recursive:true});
const {repo} = await githubSimulation();
const password = randomBytes(24).toString('hex'), salt = randomBytes(24).toString('base64');
const account = {username:'task12-test',name:'آزمون محلی',role:'admin',salt,hash:await passwordHash(password,salt)};
const workerOptions = {
  name:'navigation-pwa-tests',modules:true,scriptPath:'.wrangler/dry-run/cms-worker.js',compatibilityDate:'2026-07-09',
  assets:{directory:'public',binding:'ASSETS',run_worker_first:['/api/cms/*'],routerConfig:{has_user_worker:true}},
  durableObjects:{CMS_GUARD:{className:'CMSLoginGuard',useSQLite:true}},
  bindings:{CMS_USERS:JSON.stringify([account]),CMS_SESSION_SECRET:randomBytes(48).toString('base64'),CMS_GITHUB_TOKEN:'isolated-fixture-only',CMS_REPOSITORY:'fixture/isolated',CMS_BRANCH:'main'},
  outboundService:async request=>{
    const url=new URL(request.url); assert.equal(url.origin,'https://api.github.com');
    if (url.pathname === '/repos/fixture/isolated/commits' && request.method === 'GET') return Response.json([]);
    try { return Response.json(await repo.call(url.pathname.replace('/repos/fixture/isolated/','')+url.search,request.method,['GET','HEAD'].includes(request.method)?undefined:await request.json())); }
    catch(error) { return Response.json({message:'isolated fixture'}, {status:error.status||500}); }
  },
};
const mf = new Miniflare(convertV4MiniflareOptions(workerOptions));
const origin=(await mf.ready).origin;
const browser=await chromium.launch({channel:'chrome',headless:true});
// Incognito cannot install PWAs: use an isolated persistent profile for native
// installability evidence, while separate incognito device cases test UI only.
const profile=await fs.mkdtemp(path.join(folder,'navigation-profile-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:950}}),page=await context.newPage();
await context.addInitScript(()=>window.addEventListener('beforeinstallprompt',event=>{if(event.isTrusted)window.__nativeInstallEvent=true;}));
page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(45000);
const errors=[],results=[],notes={origin,realLocalWorker:true,realMobileOS:false,githubFixture:true};
page.on('pageerror',error=>errors.push(error.message));
const ok=name=>{results.push(name);console.log('PASS '+name);};
const home=()=>page.getByRole('heading',{name:'اینجا، باران را به‌روز نگه دارید.'}).waitFor();
const login=async p=>{await p.locator('#username').fill(account.username);await p.locator('#password').fill(password);await p.locator('#login-form button[type=submit]').click();};
const session=()=>page.evaluate(async()=>{const r=await fetch('/api/cms/session');return r.json();});
const cacheSafety=async p=>{
  const state=await p.evaluate(async()=>({cacheKeys:await caches.keys(),workers:(await navigator.serviceWorker.getRegistrations()).map(x=>x.scope)}));
  assert.deepEqual(state,{cacheKeys:[],workers:[]});
};
try {
  await page.goto(origin+'/admin/builder/?path=public%2Fen%2Findex.html');
  await page.getByText('برای ویرایش صفحه وارد حساب مدیر یا ویرایشگر شوید؛ پس از ورود به همین صفحه برمی‌گردید.',{exact:true}).waitFor();
  assert.equal(await page.locator('#builder').isVisible(),false);
  await page.locator('#builder-login').click(); await page.locator('#login-form').waitFor();
  await page.locator('#password').fill('invalid-password'); await page.locator('#username').fill(account.username);await page.locator('#login-form button[type=submit]').click();await page.locator('#login-error').filter({hasText:'درست نیست'}).waitFor();assert.equal((await session()).user,null);
  ok('Anonymous Builder is gated; wrong password does not bypass real Worker authentication');
  await login(page);await page.locator('#builder:not([hidden])').waitFor();await page.frameLocator('#page').locator('main h1').waitFor();
  assert.equal(new URL(page.url()).pathname,'/admin/builder/');assert.equal(new URL(page.url()).searchParams.get('path'),'public/en/index.html');
  const cookie=(await context.cookies()).find(c=>c.name==='__Host-luxcms');assert.ok(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
  ok('Real login restores intended English Builder page and issues unchanged secure HttpOnly session');
  await page.goto(origin+'/admin/');await home();assert.equal(new URL(page.url()).pathname,'/admin/');
  assert.deepEqual(await page.locator('.nav > *').evaluateAll(items=>items.slice(0,2).map(x=>x.textContent.trim())),['پیشخوان','صفحه‌ساز بصری']);
  await page.locator('.dashboard-builder').click();await page.locator('#builder:not([hidden])').waitFor();await page.goto(origin+'/admin/');await home();
  ok('Independent dashboard/Builder routes, navigation order and obvious dashboard shortcut work');
  await page.setViewportSize({width:1200,height:460});
  const scroll=await page.locator('.sidebar-scroll').evaluate(el=>{el.scrollTop=0;const over=el.scrollHeight>el.clientHeight;el.scrollTop=el.scrollHeight;return {over,top:el.scrollTop};});assert.ok(scroll.over&&scroll.top>0);assert.equal(await page.evaluate(()=>window.scrollY),0);
  await page.locator('.nav [data-nav=help]').click();await page.locator('.nav [data-nav=help][aria-current=page]').waitFor();
  ok('Short desktop sidebar scrolls independently and bottom navigation stays reachable');
  for(const [width,height] of [[390,844],[320,568],[768,800],[760,390]]) {
    await page.setViewportSize({width,height});await page.goto(origin+'/admin/');await home();
    if(width<=760){
      assert.equal(await page.locator('#cms-sidebar').evaluate(el=>el.inert),true);
      await page.locator('#cms-menu-toggle').click();assert.equal(await page.locator('#content').evaluate(el=>el.inert),true);
      const dimensions=await page.locator('.nav > *').evaluateAll(els=>els.map(el=>({height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize)})));assert.ok(dimensions.every(x=>x.height>=44&&x.font>=14));
      await page.locator('.sidebar-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);await page.locator('[data-cms-install]').scrollIntoViewIfNeeded();
      const installRect=await page.locator('[data-cms-install]').boundingBox();assert.ok(installRect.y>=0&&installRect.y+installRect.height<=height);await page.keyboard.press('Escape');
      await page.locator('#cms-menu-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#cms-menu-toggle').evaluate(el=>el===document.activeElement),true);
      await page.locator('#cms-menu-toggle').click();await page.locator('.sidebar [data-cms-install]').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('.cms-menu-close').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[data-cms-install]').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    ok(`RTL navigation ${width}×${height}: reachable controls, touch targets, focus trap, Escape and no overflow`);
  }
  await page.setViewportSize({width:390,height:844});
  for(const id of ['pages','catalog','blog','media','contacts','history','help','home']){
    await page.locator('#cms-menu-toggle').click();await page.locator(`.nav [data-nav=${id}]`).click();
    await page.waitForFunction(()=>!document.body.classList.contains('cms-menu-open'));
    await page.locator(`.nav [data-nav=${id}][aria-current=page]`).waitFor({state:'attached'});
    await page.waitForFunction(()=>document.activeElement===document.querySelector('#content h1'));
  }
  await page.locator('#cms-menu-toggle').click();await page.screenshot({path:path.join(folder,'cms-mobile-drawer.png')});await page.locator('.nav a[href="/admin/builder/"]').click();await page.locator('#builder:not([hidden])').waitFor();
  ok('Every mobile CMS menu destination and prominent Builder link works using actual navigation');
  await page.goto(origin+'/admin/');await home();await page.locator('#cms-menu-toggle').click();await page.setViewportSize({width:1440,height:950});assert.equal(await page.locator('#content').evaluate(el=>el.inert),false);assert.equal(await page.locator('#cms-sidebar').evaluate(el=>el.inert),false);await page.screenshot({path:path.join(folder,'cms-desktop.png')});
  ok('Resize releases drawer modality and desktop navigation remains operable');
  const cdp=await context.newCDPSession(page);const manifest=await cdp.send('Page.getAppManifest');assert.deepEqual(manifest.errors,[]);const data=JSON.parse(manifest.data);assert.equal(data.scope,'/admin/');assert.equal(data.start_url,'/admin/');
  const eligibility=await cdp.send('Page.getInstallabilityErrors');notes.chromeInstallability=eligibility;assert.deepEqual(eligibility.installabilityErrors,[]);
  ok('Actual Chrome parses scoped CMS manifest with zero installability errors (localhost secure context)');
  await cacheSafety(page);const response=await context.request.get(origin+'/api/cms/library');assert.equal(response.headers()['cache-control'],'no-store');const admin=await context.request.get(origin+'/admin/');assert.equal(admin.headers()['cache-control'],'no-store');
  await page.reload();await home();assert.equal((await session()).user.username,account.username);await cacheSafety(page);
  ok('Refresh preserves legitimate session; admin/API no-store and Cache Storage/service-worker registrations stay empty');
  const offlinePage=await context.newPage();await offlinePage.goto(origin+'/admin/');await offlinePage.getByRole('heading',{name:'اینجا، باران را به‌روز نگه دارید.'}).waitFor();
  await context.setOffline(true);
  try {assert.equal(await offlinePage.evaluate(async()=>{try{await fetch('/api/cms/library');return true;}catch{return false;}}),false);await assert.rejects(()=>offlinePage.reload({timeout:10000}));}
  finally {await context.setOffline(false);await offlinePage.close();}
  await page.reload();await home();await cacheSafety(page);
  ok('Offline request and reload fail instead of serving cached private CMS/API content; online session recovers');
  // Explicit event fixture tests our event handler, not an actual OS install prompt.
  notes.nativeBeforeInstallPromptObserved=await page.evaluate(()=>window.__nativeInstallEvent===true);
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.__promptCalls=(window.__promptCalls||0)+1;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
  await page.locator('[data-cms-install]').click();assert.equal(await page.evaluate(()=>window.__promptCalls),1);assert.equal(await page.locator('#cms-install-dialog[open]').count(),0);
  await page.locator('[data-cms-install]').click();await page.locator('#cms-install-dialog[open]').waitFor();await page.locator('#cms-install-dialog button').click();
  await page.evaluate(()=>dispatchEvent(new Event('appinstalled')));assert.equal(await page.locator('[data-cms-install]').isHidden(),true);
  ok('Explicit install-event fixture invokes native prompt once, handles dismissal, fallback and installed state');
  await page.goto(origin+'/admin/?next='+encodeURIComponent('/admin/builder/?path=public%2Fcatalog%2Findex.html'));await page.locator('#builder:not([hidden])').waitFor();assert.equal(new URL(page.url()).searchParams.get('path'),'public/catalog/index.html');
  ok('Authorized existing session follows safe return target without a second login');
  for(const next of ['https://evil.invalid/','//evil.invalid/','/api/cms/publish','/admin/other/']){await page.goto(origin+'/admin/?next='+encodeURIComponent(next));await home();assert.equal(page.url(),origin+'/admin/');}
  ok('Actual browser rejects open redirects and non-allowlisted authentication destinations');
  await page.locator('[data-action=logout]').click();await page.locator('#login-form').waitFor();assert.equal((await session()).user,null);assert.equal((await context.request.get(origin+'/api/cms/library')).status(),401);
  await login(page);await home();await page.setViewportSize({width:390,height:844});await page.locator('#cms-menu-toggle').click();await page.locator('.logout').click();await page.locator('#login-form').waitFor();await login(page);await home();
  ok('Desktop and mobile logout/login use real Worker and protected API remains blocked after logout');
  const ios=await browser.newContext({...devices['iPhone 13']}),ip=await ios.newPage();await ip.goto(origin+'/admin/');await login(ip);await ip.getByRole('heading',{name:'اینجا، باران را به‌روز نگه دارید.'}).waitFor();await ip.locator('#cms-menu-toggle').click();await ip.locator('[data-cms-install]').click();await ip.locator('#cms-install-dialog[open]').waitFor();assert.ok((await ip.locator('[data-install-help]').textContent()).includes('Add to Home Screen'));await ip.screenshot({path:path.join(folder,'ios-install-guidance.png')});await cacheSafety(ip);await ios.close();
  ok('iPhone UA/touch emulation shows Safari Share/Add to Home Screen instructions without automatic prompt claim');
  const standaloneContext=await browser.newContext({...devices['Pixel 7']}),sp=await standaloneContext.newPage();
  await standaloneContext.addInitScript(()=>{const original=matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true,addEventListener(){},removeEventListener(){}}:original(query);});
  await sp.goto(origin+data.start_url);await login(sp);await sp.getByRole('heading',{name:'اینجا، باران را به‌روز نگه دارید.'}).waitFor();await sp.locator('#cms-menu-toggle').click();assert.equal(await sp.locator('[data-cms-install]').isHidden(),true);await sp.locator('.nav a').click();await sp.locator('#builder:not([hidden])').waitFor();await cacheSafety(sp);await standaloneContext.close();
  ok('Explicit standalone display fixture launches manifest start_url, requires login, hides guidance and keeps Builder accessible');
  const androidProfile=await fs.mkdtemp(path.join(folder,'android-profile-'));const android=await chromium.launchPersistentContext(androidProfile,{channel:'chrome',headless:true,...devices['Pixel 7']}),ap=await android.newPage();await ap.goto(origin+'/admin/');const ac=await android.newCDPSession(ap);const installability=await ac.send('Page.getInstallabilityErrors');assert.deepEqual(installability.installabilityErrors,[]);notes.androidEmulatedInstallability=installability;await android.close();
  ok('Android Chrome device emulation passes native installability diagnostics; real Android WebAPK not claimed');
  await cacheSafety(page);
  const wm=new Miniflare(convertV4MiniflareOptions({...workerOptions,https:true})),wo=(await wm.ready).origin;
  const wc=await webkit.launch({headless:true});
  try{
    const wx=await wc.newContext({...devices['iPhone 13'],ignoreHTTPSErrors:true}),wp=await wx.newPage();
    await wp.goto(wo+'/admin/');await wp.locator('#login-form').waitFor();await login(wp);await wp.getByRole('heading',{name:'اینجا، باران را به‌روز نگه دارید.'}).waitFor();
    await wp.locator('#cms-menu-toggle').click();await wp.locator('[data-cms-install]').click();await wp.locator('#cms-install-dialog[open]').waitFor();assert.ok((await wp.locator('[data-install-help]').textContent()).includes('Add to Home Screen'));await wp.screenshot({path:path.join(folder,'ios-webkit-guidance.png')});await wp.locator('#cms-install-dialog button').click();
    await wp.locator('#cms-menu-toggle').click();await wp.locator('.nav a').click();await wp.locator('#builder:not([hidden])').waitFor();await wp.reload();await wp.locator('#builder:not([hidden])').waitFor();await cacheSafety(wp);await wx.close();
    ok('Real Playwright WebKit engine: HTTPS local Worker login, iPhone install guidance, Builder and refresh (self-signed test certificate)');
  }finally{await wc.close();await wm.dispose();}
  // Chrome installs only this ephemeral localhost app/profile. Always uninstall.
  const manifestId=origin+'/admin/';let nativeInstalled=false;
  try {
    await page.goto(manifestId);await home();
    await cdp.send('PWA.install',{manifestId,installUrlOrBundleUrl:manifestId});nativeInstalled=true;
    await cdp.send('PWA.changeAppUserSettings',{manifestId,displayMode:'standalone'});
    const launched=await cdp.send('PWA.launch',{manifestId});
    const target=await context.waitForEvent('page',{timeout:1000}).catch(()=>context.pages().find(p=>p!==page&&p.url().startsWith(origin)));
    assert.ok(target);await target.waitForLoadState();await target.getByRole('heading',{name:'اینجا، باران را به‌روز نگه دارید.'}).waitFor();
    assert.equal(target.url(),manifestId);assert.equal(await target.evaluate(()=>matchMedia('(display-mode: standalone)').matches),true);assert.equal(await target.locator('[data-cms-install]').isHidden(),true);
    assert.equal(await target.evaluate(async()=>(await(await fetch('/api/cms/session')).json()).user.username),account.username);
    await target.locator('.dashboard-builder').click();await target.locator('#builder:not([hidden])').waitFor();await target.reload();await target.locator('#builder:not([hidden])').waitFor();await cacheSafety(target);
    notes.nativeChromePWA={installed:true,standalone:true,sessionPreserved:true,builderAccessible:true,launchTarget:launched.targetId};await target.close();
    ok('Actual local Chrome PWA install and standalone launch preserve secure session, open dashboard/Builder and refresh safely');
  } finally {if(nativeInstalled){await cdp.send('PWA.uninstall',{manifestId});notes.nativeChromePWA={...notes.nativeChromePWA,uninstalled:true};}}
  assert.deepEqual(errors,[]);
} catch(error) {
  notes.failure = String(error); await page.screenshot({path:path.join(folder,'navigation-failure.png')}).catch(()=>{}); throw error;
} finally {
  await fs.writeFile(path.join(folder,'navigation-pwa-browser.json'),JSON.stringify({passed:results.length,results,errors,notes},null,2));
  await context.close();await browser.close();await mf.dispose();
}
console.log(JSON.stringify({passed:results.length,errors}));
