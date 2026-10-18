import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseHTML } from "linkedom";
import { startLocal } from "../scripts/cms-local.mjs";
import { describePage, applyChanges } from "../src/content.js";

const exec = promisify(execFile), root = process.cwd();
const realHome = await fs.readFile("public/index.html");
await fs.mkdir(".cms-local",{recursive:true});
const sandbox = await fs.mkdtemp(path.resolve(".cms-local/publishing-"));
await fs.cp("public",path.join(sandbox,"public"),{recursive:true});
for (const args of [["init","-q"],["config","user.name","Builder Fixture"],["config","user.email","fixture@example.invalid"],["add","public"],["commit","-qm","Isolated publication fixture"]]) await exec("git",args,{cwd:sandbox});
const server = await startLocal(sandbox,0), origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:"chrome",headless:true});
const context = await browser.newContext({viewport:{width:1600,height:1050}}), page = await context.newPage(), errors = [];
page.setDefaultTimeout(30000); page.on("pageerror",e => errors.push(e.message));
const frame = () => page.frameLocator("#page");
const saved = () => page.getByText("پیش‌نویس در این مرورگر ذخیره شد",{exact:true}).waitFor();
let count = 0, posts = [];
page.on("request",req=>{if(req.url().endsWith("/builder/publish")) posts.push(req.postDataJSON());});
try {
  await page.goto(origin+"/admin/builder/"); await frame().locator("#hero-title").waitFor();
  assert.equal(await page.locator("#page-selector option").count(),9);
  await page.locator("#page-selector").selectOption("public/en/index.html");
  await frame().locator('html[lang="en"]').waitFor();
  await frame().locator("#hero-title").click(); await page.locator("#text").fill("Independent English draft"); await saved();
  await page.reload(); await frame().getByRole("heading",{name:"Independent English draft"}).waitFor();
  assert.equal(await frame().locator("html").getAttribute("dir"),"ltr"); count++;
  await page.locator("#page-selector").selectOption("public/index.html"); await frame().locator('html[lang="fa"]').waitFor();
  await frame().locator("#hero-title").click(); const titleID = await page.locator("#element-id").innerText();
  await page.locator("#text").fill("عنوان ثبت‌شده با صفحه‌ساز"); await saved();
  await page.locator("#x").fill("3"); await page.locator("#x").press("Tab"); await saved();
  await page.locator("#width").fill("50"); await page.locator("#width").press("Tab"); await saved();
  await page.locator('[data-device="mobile"]').click();
  await page.locator("#x").fill("1"); await page.locator("#x").press("Tab"); await saved();
  await page.locator('[data-device="desktop"]').click(); count++;
  // Select actual LCP image then compress, convert and generate a 640px variant.
  await frame().locator(".hero-media").click({position:{x:100,y:100}});
  await page.locator("#upload").setInputFiles(path.resolve("public/assets/images/home/baran-hero.webp"));
  await page.waitForFunction(()=>document.querySelector("#page").contentDocument.querySelector(".hero-media").getAttribute("src").startsWith("data:image/webp"));
  await saved();
  await page.locator("#alt").fill("تصویر اصلی بهینه باران"); await saved(); count++;
  // Move an existing real heading structurally; both undo and redo restore parents.
  await frame().locator("#intro-title").click();
  await page.locator("#move-anchor").selectOption("section-1"); await page.locator("#move-section").click(); await saved();
  assert.equal(await frame().locator("#intro-title").evaluate(n=>n.parentElement.dataset.builderAnchor),"section-1");
  await page.locator("#undo").click(); await saved();
  assert.equal(await frame().locator("#intro-title").evaluate(n=>n.parentElement.dataset.builderAnchor),"section-2");
  await page.locator("#redo").click(); await saved();
  assert.equal(await frame().locator("#intro-title").evaluate(n=>n.parentElement.dataset.builderAnchor),"section-1"); count++;
  await page.locator("#anchor").selectOption("section-1"); await page.locator('[data-add="text"]').click(); await saved();
  await page.locator("#text").fill("متن جدید ماندگار"); await saved();
  const addedID = await page.locator("#element-id").innerText();
  // A real pointer drop across section bounds changes the actual DOM parent.
  await page.locator("#y").fill("85"); await page.locator("#y").press("Tab"); await saved();
  await frame().locator(".hero").evaluate(n=>window.scrollTo(0,n.offsetTop+n.offsetHeight-180));
  const dragged = frame().locator(`[data-builder-id="${addedID}"]`), box = await dragged.boundingBox();
  const iframeBox = await page.locator("#page").boundingBox();
  const destination = await frame().locator('.intro').evaluate(n=>({x:n.getBoundingClientRect().left+100,y:n.getBoundingClientRect().top+50}));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(iframeBox.x+destination.x,iframeBox.y+destination.y,{steps:12}); await page.mouse.up(); await saved();
  assert.equal(await dragged.evaluate(n=>n.parentElement.dataset.builderAnchor),"section-2"); count++;
  await page.locator("#duplicate").click(); await saved(); const removedID = await page.locator("#element-id").innerText();
  await page.locator("#delete").click(); await saved(); count++;
  // First response fails, keeping the exact draft and request identifier recoverable.
  await page.route("**/api/cms/builder/publish",route=>route.fulfill({status:502,json:{error:"خطای آزمایشی؛ ثبت انجام نشد."}}),{times:1});
  await page.locator("#publish").click(); await page.locator("#publish-confirm").click();
  await page.locator("#publication-status").filter({hasText:"پیش‌نویس و تاریخچه حفظ شدند"}).waitFor();
  assert.ok((await fs.readFile(path.join(sandbox,"public/index.html"))).equals(realHome));
  assert.equal(await frame().locator("#hero-title").innerText(),"عنوان ثبت‌شده با صفحه‌ساز"); count++;
  await page.locator("#publish").click(); await page.locator("#publish-confirm").click();
  await page.locator("#publication-status").filter({hasText:"در فایل‌های محلی ثبت شد"}).waitFor();
  assert.equal(posts.length,2); assert.ok(posts[0].requestId === posts[1].requestId);
  const published = await fs.readFile(path.join(sandbox,"public/index.html"),"utf8"), document = parseHTML(published).document;
  assert.equal(document.querySelector("#hero-title").textContent,"عنوان ثبت‌شده با صفحه‌ساز");
  assert.equal(document.querySelector("#intro-title").parentElement.getAttribute("data-builder-anchor"),"section-1");
  assert.equal(document.querySelector(`[data-builder-id="${addedID}"]`).textContent,"متن جدید ماندگار");
  assert.equal(document.querySelector(`[data-builder-id="${removedID}"]`),null);
  const hero = document.querySelector(".hero-media");
  assert.ok(hero.getAttribute("src").startsWith("/assets/uploads/")); assert.ok(hero.getAttribute("srcset").includes("640w"));
  assert.equal(hero.getAttribute("loading"),"eager"); assert.equal(hero.getAttribute("fetchpriority"),"high");
  assert.equal(hero.getAttribute("alt"),"تصویر اصلی بهینه باران");
  for (const variant of hero.getAttribute("srcset").split(",")) { const url = variant.trim().split(" ")[0]; assert.equal((await fetch(origin+url)).status,200); }
  assert.equal(await page.locator("#publish").isDisabled(),true); assert.equal(await page.locator("#check-publication").isHidden(),true); count++;
  // Published static output renders with its real scripts, geometry and responsive assets.
  const site = await context.newPage(); site.on("pageerror",e=>errors.push(e.message));
  await site.route("https://www.googletagmanager.com/**",route=>route.fulfill({status:204,body:""}));
  await site.goto(origin+"/"); await site.locator("#hero-title").waitFor();
  assert.ok(await site.locator("#hero-title").evaluate(n=>Math.abs(parseFloat(getComputedStyle(n).translate) - n.closest("[data-builder-anchor]").clientWidth*.03) < .1));
  await site.screenshot({path:".cms-local/builder-published-desktop.png"});
  await site.setViewportSize({width:390,height:844});
  await site.waitForFunction(()=>getComputedStyle(document.querySelector("#hero-title")).translate.split(" ")[0] === "3.9px");
  await site.screenshot({path:".cms-local/builder-published-mobile.png"});
  assert.ok(await site.locator(".hero-media").evaluate(n=>n.complete && n.naturalWidth > 0)); count++;
  // Existing CMS can edit the published HTML without losing scripts or layout data.
  const cms = describePage(published,"public/index.html","fixture-revision");
  const field = cms.fields.find(f=>f.kind==="text" && f.value==="عنوان ثبت‌شده با صفحه‌ساز");
  const cmsOutput = applyChanges(published,[{id:field.id,value:"CMS compatibility"}],[]);
  assert.ok(cmsOutput.includes('id="builder-state"')); assert.ok(cmsOutput.includes("CMS compatibility")); count++;
  await page.locator("#continue-editing").click();
  // The toolbar remains visible while the new base/history are loading. Wait
  // for the editing workspace, rather than accidentally probing the old frame.
  await page.waitForFunction(()=>!document.querySelector('.workspace').inert&&!document.querySelector('#page').hidden,{},{timeout:60000});
  await frame().locator("#hero-title").waitFor();
  await page.locator(`[data-select="${titleID}"]`).click();
  assert.equal(await page.locator("#x").inputValue(),"3");
  assert.equal(await page.locator("#text").inputValue(),"عنوان ثبت‌شده با صفحه‌ساز"); count++;
  // Independent English draft is still untouched by homepage publication.
  await page.locator("#page-selector").selectOption("public/en/index.html"); await frame().getByRole("heading",{name:"Independent English draft"}).waitFor(); count++;
  // The server commits, but the response is deliberately lost. Refresh recovers
  // the receipt and archives the old draft instead of silently discarding it.
  await page.route("**/api/cms/builder/publish",async route=>{ await route.fetch(); await route.abort("failed"); },{times:1});
  await page.locator("#publish").click(); await page.locator("#publish-confirm").click();
  await page.locator("#publication-status").filter({hasText:"پیش‌نویس و تاریخچه حفظ شدند"}).waitFor();
  await page.reload(); await page.getByRole("button",{name:"باز کردن نسخه ثبت‌شده"}).waitFor();
  await page.getByRole("button",{name:"باز کردن نسخه ثبت‌شده"}).click();
  await frame().getByRole("heading",{name:"Independent English draft"}).waitFor();
  assert.ok(await page.locator("#archives option").count()>0); count++;
  await page.locator("#page-selector").selectOption("public/index.html"); await frame().locator('html[lang="fa"]').waitFor();
  const originalRevision=await page.locator('#revisions option').filter({hasText:'Isolated publication fixture'}).getAttribute('value');
  await page.locator('#revisions').selectOption(originalRevision);
  await page.locator("#load-revision").click(); await frame().getByRole("heading",{name:"باران؛ فراتر از حوله",exact:true}).waitFor();
  assert.equal(parseHTML(await fs.readFile(path.join(sandbox,"public/index.html"),"utf8")).document.querySelector("h1").textContent,"عنوان ثبت‌شده با صفحه‌ساز"); count++;
  assert.ok((await fs.readFile(path.join(root,"public/index.html"))).equals(realHome));
  assert.equal(errors.length,0);
  console.log(JSON.stringify({passed:count,isolatedLocalPublication:true,realOnlinePublication:false,publicWorkspaceUnchanged:true,browserErrors:errors.length}));
} catch(error) {
  await page.screenshot({path:'.cms-local/builder-publish-failure.png',fullPage:true}).catch(()=>{});
  console.log(JSON.stringify({failedAt:count,error:error.message,url:page.url(),title:await page.title().catch(()=>''),errors}));
  throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
