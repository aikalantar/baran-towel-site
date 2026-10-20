import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseHTML } from "linkedom";
import { chromium } from "@playwright/test";
import { BLOCKS, BLOCK_KINDS, BLOCK_TYPES, createBlock, renderBlockNode, blockTag, BLOCK_CSS } from "../public/admin/builder/blocks.js";

function render(nodes, language = "fa") {
  const { document } = parseHTML(`<html lang="${language}" dir="${language === "en" ? "ltr" : "rtl"}"><head></head><body><main data-builder-anchor="section-1"></main></body></html>`);
  const rendered = new Map(), root = document.querySelector("main");
  for (const element of nodes) rendered.set(element.id, renderBlockNode(document, element));
  for (const element of nodes) (rendered.get(element.parentId) || root).append(rendered.get(element.id));
  return document;
}
const nodesFor = (kind, language = "fa") => createBlock(kind, { anchor: "section-1", language });

test("all 16 core blocks form editable, ordered, stable subtrees in both languages", () => {
  assert.equal(BLOCKS.length, 16);
  for (const language of ["fa", "en"]) for (const block of BLOCKS) {
    const nodes = nodesFor(block.id, language), ids = new Set(nodes.map(node => node.id));
    assert.equal(ids.size, nodes.length, block.id);
    assert.equal(nodes.filter(node => node.parentId === "section-1").length, 1, block.id);
    for (const node of nodes) {
      assert.ok(BLOCK_TYPES.includes(node.type));
      assert.equal(node.anchor, "section-1");
      assert.ok(node.parentId === "section-1" || ids.has(node.parentId));
      assert.equal(node.order, nodes.filter(item => item.parentId === node.parentId).indexOf(node));
      assert.deepEqual(node.layouts, { desktop: {}, tablet: {}, mobile: {} });
      assert.equal(node.layoutMode, "flow");
      assert.equal(node.tag, blockTag(node));
      if (node.type === "container") assert.ok(BLOCK_KINDS.includes(node.kind));
      if (node.type === "image") assert.ok(node.content.alt.length > 0);
    }
    const document = render(nodes, language);
    assert.equal(document.querySelectorAll("[data-builder-id]").length, nodes.length);
    assert.equal(document.querySelectorAll("script,iframe,object,embed").length, 0);
    assert.equal(document.documentElement.dir, language === "en" ? "ltr" : "rtl");
    assert.ok(block.description && block.preview && block.category);
  }
});

test("block IDs cannot collide or become selectors and unknown blocks fail closed", () => {
  let i = 0;
  const block = createBlock("hero", { anchor: "section-1", idFactory: () => `new-fixture-${++i}` });
  assert.equal(block[0].id, "new-fixture-1");
  assert.throws(() => createBlock("hero", { anchor: "section-1", idFactory: () => "new-repeated" }));
  assert.throws(() => createBlock("hero", { anchor: "section-1", idFactory: () => 'new-evil"]{}' }));
  assert.throws(() => createBlock("html", { anchor: "section-1" }));
  assert.throws(() => createBlock("section"));
});

test("FAQ uses accessible native disclosure structure and gallery contains real replaceable images", async () => {
  const faq = render(nodesFor("faq"));
  assert.equal(faq.querySelectorAll("details").length, 3);
  for (const details of faq.querySelectorAll("details")) {
    assert.equal(details.firstElementChild.localName, "summary");
    assert.ok(details.querySelector("p").textContent.length > 0);
  }
  const gallery = render(nodesFor("gallery"));
  assert.equal(gallery.querySelectorAll("[data-builder-kind=gallery] img").length, 3);
  for (const image of gallery.querySelectorAll("img")) {
    assert.equal(image.getAttribute("loading"), "lazy");
    const binary = await fs.readFile(`public${image.getAttribute("src")}`);
    assert.ok(binary.byteLength > 100);
  }
});

test("rich text preserves safe emphasis and links without accepting markup or event handlers", () => {
  const [element] = nodesFor("richtext");
  element.tag = "script";
  element.content.runs = [
    { text: '<img src=x onerror="alert(1)">', bold: true, italic: true, underline: true, href: "javascript:alert(1)", onclick: "alert(1)" },
    { text: "راهنما", href: "/blog/", bold: true },
  ];
  const document = render([element]);
  assert.equal(document.querySelectorAll("script,img,[onclick],[onerror]").length, 0);
  assert.equal(document.querySelectorAll("p strong em, p em strong").length, 1);
  assert.ok(document.querySelector("p").textContent.includes("<img src=x"));
  assert.equal(document.querySelectorAll("a").length, 1);
  assert.equal(document.querySelector("a").getAttribute("href"), "/blog/");
  const plain = { ...element, content: { text: "<script>window.x=1</script>" } };
  assert.equal(render([plain]).querySelectorAll("script").length, 0);
});

test("unsafe URLs and container/tag injections never become active DOM", () => {
  for (const value of ["javascript:alert(1)", "//evil.invalid/image.webp", "data:image/svg+xml;base64,PHN2Zz4=", "/assets/../escape.webp"]) {
    const [image] = nodesFor("image"); image.content.src = value;
    image.content.variants = [{ src: value, width: 640 }];
    const node = render([image]).querySelector("img");
    assert.equal(node.hasAttribute("src"), false);
    assert.equal(node.hasAttribute("srcset"), false);
  }
  const [button] = nodesFor("button"); button.tag = "iframe"; button.content.href = "javascript:alert(1)";
  assert.equal(render([button]).querySelector("a").getAttribute("href"), "#");
  const [container] = nodesFor("section"); container.kind = 'section" onclick="alert(1)';
  assert.throws(() => render([container]));
  assert.throws(() => render([{ ...button, type: "script" }]));
});

test("image variants and dimensions retain responsive metadata", () => {
  const [image] = nodesFor("image");
  image.content = { ...image.content, width: 900, height: 1200, variants: [{ src: "/assets-v3/gallery/nilo-01.webp", width: 640, height: 853 }] };
  const node = render([image]).querySelector("img");
  assert.equal(node.getAttribute("width"), "900");
  assert.equal(node.getAttribute("height"), "1200");
  assert.match(node.getAttribute("srcset"), /nilo-01\.webp 640w/);
  assert.match(node.getAttribute("sizes"), /640px/);
});

test("public block rendering works at 1440, 768, 390 and 320 with RTL/LTR and real gallery/FAQ interaction", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    // Every block's real image comes from public/. Never let the fictional
    // hostname hit DNS/the network while testing local responsive rendering.
    await page.route("**/*", async route => {
      const url = new URL(route.request().url()), relative = url.pathname;
      if (url.origin !== 'https://blocks.invalid' || !/^\/(?:assets-v3|assets)\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|svg)$/.test(relative)) return route.abort();
      const body = await fs.readFile(`public${relative}`).catch(()=>null);
      if (!body) return route.abort();
      const contentType = relative.endsWith('.svg') ? 'image/svg+xml' : relative.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(relative) ? 'image/jpeg' : 'image/webp';
      return route.fulfill({ contentType, body });
    });
    const runtime = await fs.readFile("public/builder-blocks.js", "utf8");
    for (const language of ["fa", "en"]) {
      const document = render(BLOCKS.flatMap(block => nodesFor(block.id, language)), language);
      const base = document.createElement("base"); base.href = "https://blocks.invalid/"; document.head.append(base);
      const style = document.createElement("style"); style.textContent = `body{margin:0;padding:16px;font-family:sans-serif}main{max-width:1200px;margin:auto;display:grid;gap:32px}${BLOCK_CSS}`; document.head.append(style);
      await page.setContent(document.toString()); await page.addScriptTag({ content: runtime });
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} ${width} horizontal overflow`);
        const section = page.locator("[data-builder-kind=section]").first();
        assert.ok((await section.boundingBox()).width <= width);
        const gallery = page.locator("[data-builder-kind=gallery]");
        const images = gallery.locator("img");
        assert.equal(await images.count(), 3);
        await images.first().focus(); await page.keyboard.press("Enter");
        const dialog = page.locator("dialog.builder-gallery-dialog");
        assert.ok(await dialog.evaluate(node => node.open));
        assert.equal(await dialog.locator("img").getAttribute("alt"), await images.first().getAttribute("alt"));
        await page.keyboard.press(language === "fa" ? "ArrowLeft" : "ArrowRight");
        assert.equal(await dialog.locator("img").getAttribute("alt"), await images.nth(1).getAttribute("alt"));
        await page.keyboard.press("End");
        assert.equal(await dialog.locator("img").getAttribute("alt"), await images.nth(2).getAttribute("alt"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.ok(await images.first().evaluate(node => document.activeElement === node));
        const details = page.locator("details").first();
        await details.locator("summary").click(); assert.equal(await details.evaluate(node => node.open), true);
        assert.ok(await details.locator("p").isVisible());
        await details.locator("summary").click(); assert.equal(await details.evaluate(node => node.open), false);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
