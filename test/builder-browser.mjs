import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startLocal } from "../scripts/cms-local.mjs";

// Uses the real working-tree homepage. The builder must never issue mutations.
const originalPaths = ["public/index.html", "public/styles.600f8d5159.css", "public/script.df5cebe557.js", "public/sitemap.xml", "src/auth.js", "src/content.js", "src/github.js"];
const before = new Map(await Promise.all(originalPaths.map(async name => [name, await fs.readFile(name)])));
const server = await startLocal(process.cwd(), 0);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], mutations = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", req => { if (req.method() !== "GET") mutations.push(req.url().replace(origin, "")); });
await fs.mkdir(".cms-local", { recursive: true });
let count = 0;
const current = () => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open("baran-visual-builder", 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
  const raw = await new Promise(resolve => { const r = db.transaction("drafts").objectStore("drafts").get("local:public/index.html"); r.onsuccess = () => resolve(r.result); });
  db.close(); return raw ? JSON.parse(raw) : null;
});
const saved = async () => page.getByText("پیش‌نویس در این مرورگر ذخیره شد", { exact: true }).waitFor();
const frame = () => page.frameLocator("#page");
const idOfSelection = () => page.locator("#element-id").innerText();
const layoutOf = async id => (await current()).history.present.elements.find(e => e.id === id);
try {
  await page.goto(origin + "/admin/builder/");
  await frame().locator("#hero-title").waitFor();
  const originalHeroText = await frame().locator("#hero-title").innerText();
  const originalPromoSource = await frame().locator(".bridal-promo-home img").getAttribute("src");
  assert.ok(originalPromoSource, "The real homepage must provide the initial image source");
  await frame().locator("#hero-title").click();
  const hero = await idOfSelection();
  await page.locator("#text").fill("عنوان بصری آزمایشی باران");
  await saved();
  assert.equal(await frame().locator("#hero-title").innerText(), "عنوان بصری آزمایشی باران");
  assert.equal((await layoutOf(hero)).content.text, "عنوان بصری آزمایشی باران"); count++;

  // Direct image selection and responsive picture source replacement.
  await frame().locator(".bridal-promo-home img").click();
  const imageID = await idOfSelection();
  await page.locator("#image-library").selectOption("/assets/products/mozhan.webp");
  await page.locator("#alt").fill("تصویر تازه آزمایشی"); await saved();
  assert.equal(await frame().locator(".bridal-promo-home img").getAttribute("src"), "/assets/products/mozhan.webp"); count++;

  // Real pointer dragging and corner resizing, each recorded as one operation.
  await page.locator(`[data-select="${hero}"]`).click();
  const heading = frame().locator("#hero-title");
  let box = await heading.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 - 35, { steps: 9 }); await page.mouse.up(); await saved();
  assert.ok((await layoutOf(hero)).layouts.desktop.x > 2);
  assert.ok((await layoutOf(hero)).layouts.desktop.y < 0); count++;
  const handle = frame().locator('[data-resize="nw"]');
  box = await handle.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 6); await page.mouse.down(); await page.mouse.move(box.x - 55, box.y - 20, { steps: 8 }); await page.mouse.up(); await saved();
  assert.ok((await layoutOf(hero)).layouts.desktop.width > 0);
  assert.ok((await layoutOf(hero)).layouts.desktop.height > 0); count++;

  await page.locator("#x").fill("6.25"); await page.locator("#x").press("Tab"); await saved();
  assert.equal((await layoutOf(hero)).layouts.desktop.x, 6.25); count++;
  await page.locator("#anchor").selectOption("section-1");
  const newIDs = [];
  for (const type of ["text", "heading", "image", "button"]) {
    await page.locator(`[data-add="${type}"]`).click(); await saved();
    const id = await idOfSelection(); newIDs.push(id);
    assert.equal((await layoutOf(id)).type, type);
    assert.equal(await frame().locator(`[data-builder-id="${id}"]`).count(), 1);
  } count++;
  const buttonID = newIDs.at(-1);
  await page.locator("#href").fill("/blog/"); await saved();
  assert.equal(await frame().locator(`[data-builder-id="${buttonID}"]`).getAttribute("href"), "/blog/");
  await page.locator("#duplicate").click(); await saved();
  const duplicateID = await idOfSelection(); assert.notEqual(duplicateID, buttonID);
  await page.locator("#delete").click(); await saved();
  assert.equal((await layoutOf(duplicateID)).deleted, true);
  await page.keyboard.press("Control+z"); await saved(); assert.equal((await layoutOf(duplicateID)).deleted, false);
  await page.keyboard.press("Control+y"); await saved(); assert.equal((await layoutOf(duplicateID)).deleted, true); count++;

  // Multiple selection and a combined operation.
  await page.locator(`[data-select="${newIDs[0]}"]`).click();
  await page.locator(`[data-select="${newIDs[1]}"]`).click({ modifiers: ["Shift"] });
  assert.match(await page.locator("#selection-label").innerText(), /2/);
  await page.locator("#delete").click(); await saved();
  for (const id of newIDs.slice(0, 2)) assert.equal((await layoutOf(id)).deleted, true);
  await page.locator("#undo").click(); await saved();
  for (const id of newIDs.slice(0, 2)) assert.equal((await layoutOf(id)).deleted, false); count++;

  // Local file upload, refresh persistence including history and raster data.
  await page.locator(`[data-select="${imageID}"]`).click();
  await page.locator("#upload").setInputFiles("public/favicon-32x32-v2.png"); await saved();
  await page.waitForFunction(async () => document.querySelector("#page").contentDocument.querySelector(".bridal-promo-home img").src.startsWith("data:image/webp"));
  await saved();
  const snapshot = await current();
  await page.reload(); await frame().locator("#hero-title").waitFor();
  assert.equal(await frame().locator("#hero-title").innerText(), "عنوان بصری آزمایشی باران");
  assert.equal((await current()).history.past.length, snapshot.history.past.length);
  assert.ok((await frame().locator(".bridal-promo-home img").getAttribute("src")).startsWith("data:image/webp")); count++;

  // Mobile has independent geometry and uses the homepage responsive stylesheet.
  await page.locator('[data-device="mobile"]').click();
  await frame().locator("#hero-title").click();
  assert.equal(await page.locator("#x").inputValue(), "0");
  await page.locator("#x").fill("2"); await page.locator("#x").press("Tab"); await saved();
  const mobile = await layoutOf(hero);
  assert.equal(mobile.layouts.mobile.x, 2); assert.equal(mobile.layouts.desktop.x, 6.25);
  assert.equal(await frame().locator("html").evaluate(n => n.clientWidth), 390);
  await page.locator("#preview").click();
  assert.equal(await frame().locator("[data-builder-overlay]").count(), 0);
  await page.screenshot({ path: ".cms-local/builder-mobile.png" });
  await page.locator("#preview").click();
  await page.locator('[data-device="desktop"]').click();
  await page.screenshot({ path: ".cms-local/builder-desktop.png" }); count++;

  // Export and import are concrete, validated and undoable.
  const downloadEvent = page.waitForEvent("download"); await page.locator("#export").click();
  const download = await downloadEvent; const exportFile = path.resolve(".cms-local/builder-export.json"); await download.saveAs(exportFile);
  const exported = await fs.readFile(exportFile, "utf8"); assert.equal(JSON.parse(exported).version, 2);
  await page.locator("#text").fill("متن پس از خروجی"); await saved();
  await page.locator("#import").setInputFiles(exportFile); await saved();
  assert.equal(await frame().locator("#hero-title").innerText(), "عنوان بصری آزمایشی باران");
  await page.locator("#undo").click(); await saved(); assert.equal(await frame().locator("#hero-title").innerText(), "متن پس از خروجی"); count++;

  // Undo and redo the complete mixed editing session, including pointer geometry,
  // content, asset uploads, additions, duplicates, deletion and imported data.
  const mixed = await current(), operations = mixed.history.past.length;
  for (let i = 0; i < operations; i++) await page.locator("#undo").click();
  await saved();
  assert.equal(await frame().locator("#hero-title").innerText(), originalHeroText);
  assert.equal(await frame().locator("[data-builder-added]").count(), 0);
  assert.equal(await frame().locator(".bridal-promo-home img").getAttribute("src"), originalPromoSource);
  for (let i = 0; i < operations; i++) await page.locator("#redo").click();
  await saved();
  assert.deepEqual((await current()).history.present, mixed.history.present); count++;

  await page.locator('[data-device="mobile"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: ".cms-local/builder-mobile-shell.png", fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1050 }); count++;

  // A changed base never silently overwrites or applies a previous draft.
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("baran-visual-builder", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => {
      const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts"), read = store.get("local:public/index.html");
      read.onsuccess = () => { const value = JSON.parse(read.result); value.history.present.base.revision = "obsolete-fixture"; store.put(JSON.stringify(value), "local:public/index.html"); };
      tx.oncomplete = resolve;
    }); db.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "دانلود پیش‌نویس قبلی" }).waitFor();
  assert.equal(await page.locator("#builder").isVisible(), false);
  assert.equal((await current()).history.present.base.revision, "obsolete-fixture");
  await page.getByRole("button", { name: "شروع پیش‌نویس تازه از صفحه فعلی" }).click();
  await frame().locator("#hero-title").waitFor();
  assert.equal(await frame().locator("#hero-title").innerText(), originalHeroText); count++;

  // Access gate and expired session do not expose a frame or editing controls.
  const denied = await context.newPage();
  await denied.route("**/api/cms/session", route => route.fulfill({ json: { user: null, configured: true } }));
  await denied.goto(origin + "/admin/builder/");
  await denied.getByText(/برای ویرایش صفحه، با حساب/).waitFor();
  assert.equal(await denied.locator("#builder").isVisible(), false);
  assert.equal(await denied.locator("#page").getAttribute("srcdoc"), null); await denied.close(); count++;
  await page.route("**/api/cms/session", route => route.fulfill({ json: { user: null, configured: true } }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.getByText(/نشست شما پایان یافته است/).waitFor();
  assert.equal(await page.locator("#builder").isVisible(), false); count++;

  for (const [name, bytes] of before) assert.deepEqual(await fs.readFile(name), bytes);
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []); count++;
  console.log(JSON.stringify({ passed: count, browserErrors: errors.length, mutationRequests: mutations.length, publicFilesUnchanged: true, screenshots: ".cms-local/builder-{desktop,mobile}.png" }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
